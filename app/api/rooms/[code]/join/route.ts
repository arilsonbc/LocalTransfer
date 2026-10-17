import { getRoomStore } from "../../../../../lib/room-store";
import { allowed, body, deviceName, hash, json, makeToken, normalizeCode, ROOM_PATTERN, validOrigin } from "../../../../../lib/room-service";

export async function POST(request:Request, context:{params:Promise<{code:string}>}) {
  if(!validOrigin(request)) return json({error:"Origem não permitida."},403);
  try {
    const store=getRoomStore();
    if(!await allowed(store,request,"join",15)) return json({error:"Muitas tentativas. Aguarde um minuto."},429);
    const code=normalizeCode((await context.params).code);
    if(!ROOM_PATTERN.test(code)) return json({error:"Use o código de 8 caracteres."},400);
    const data=await body(request);
    const token=makeToken();
    const result=await store.join(code,await hash(token),deviceName(data.name));
    if(!result) return json({error:"Sala indisponível, expirada ou já conectada. Confira o código ou crie outra sala."},404);
    return json({code,token,role:"guest",expiresAt:result.expires_at,peerName:result.host_name});
  } catch {return json({error:"Não foi possível entrar. Confira o código e tente novamente."},400);}
}
