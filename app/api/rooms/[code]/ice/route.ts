import {getRoomStore} from "../../../../../lib/room-store";
import {allowed, authenticate, json, normalizeCode, ROOM_PATTERN, validOrigin} from "../../../../../lib/room-service";
import {generateIceServers} from "../../../../../lib/turn";

export async function POST(request:Request, context:{params:Promise<{code:string}>}) {
  if (!validOrigin(request)) return json({error:"Origem não permitida."},403);
  try {
    const code = normalizeCode((await context.params).code);
    if (!ROOM_PATTERN.test(code)) return json({error:"Sala inválida."},401);
    const store = getRoomStore();
    const auth = await authenticate(store,code,request);
    if (!auth) return json({error:"Sala expirada ou acesso inválido."},401);
    if (!await allowed(store,request,`ice:${code}:${auth.role}`,3)) return json({error:"Aguarde um minuto antes de tentar novamente."},429);
    return json({iceServers:await generateIceServers()});
  } catch {
    return json({error:"Não foi possível preparar a conexão. Tente novamente em instantes."},503);
  }
}
