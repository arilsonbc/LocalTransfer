import {getRoomStore} from "../../../../../lib/room-store";
import {allowed, authenticate, json, normalizeCode, ROOM_PATTERN, validOrigin} from "../../../../../lib/room-service";
import {generateIceServers} from "../../../../../lib/turn";
import {readTurnUsage,STUN_ONLY,turnNotice} from "../../../../../lib/turn-usage";

export async function POST(request:Request, context:{params:Promise<{code:string}>}) {
  if (!validOrigin(request)) return json({error:"Origem não permitida."},403);
  try {
    const code = normalizeCode((await context.params).code);
    if (!ROOM_PATTERN.test(code)) return json({error:"Sala inválida."},401);
    const store = getRoomStore();
    const auth = await authenticate(store,code,request);
    if (!auth) return json({error:"Sala expirada ou acesso inválido."},401);
    if (!await allowed(store,request,`ice:${code}:${auth.role}`,3)) return json({error:"Aguarde um minuto antes de tentar novamente."},429);
    const hour=Math.floor(Date.now()/3600000);
    // Unlike the per-room limiter, this cannot be reset by creating another room.
    if(!await allowed(store,request,"ice:all-rooms",10))return json({error:"Muitas tentativas de conexão. Aguarde um minuto."},429);
    const usage=await readTurnUsage(store);
    const notice=turnNotice(usage);
    if(usage.status==="limit"||usage.status==="unavailable"||process.env.TURN_ENABLED==="false")
      return json({iceServers:STUN_ONLY,turn:{status:process.env.TURN_ENABLED==="false"?"paused":usage.status,notice:notice||"A retransmissão está temporariamente pausada. Tente conectar os aparelhos na mesma rede Wi-Fi."}});
    if(!await store.allow(`ice-session:${code}:${auth.role}`,6,172800)||
       !await allowed(store,request,"ice-hour",60,3600)||
       !await store.allow(`ice-global:${hour}`,600,7200))
      return json({error:"O limite de novas conexões foi atingido. Aguarde e tente novamente."},429);
    return json({iceServers:await generateIceServers(),turn:{status:usage.status,notice}});
  } catch {
    return json({error:"Não foi possível preparar a conexão. Tente novamente em instantes."},503);
  }
}
