import { getRoomStore } from "../../../lib/room-store";
import { allowed, body, deviceName, hash, json, makeCode, makeToken, ROOM_TTL, validOrigin } from "../../../lib/room-service";

export async function POST(request: Request) {
  if (!validOrigin(request)) return json({error:"Origem não permitida."},403);
  try {
    const store = getRoomStore();
    if (!await allowed(store,request,"create",10)) return json({error:"Aguarde um minuto antes de criar outra sala."},429);
    const data = await body(request);
    const token = makeToken();
    const tokenHash = await hash(token);
    const expiresAt = Date.now() + ROOM_TTL;
    for (let i=0;i<4;i++) {
      const code = makeCode();
      const created = await store.create({code,host_token:tokenHash,host_name:deviceName(data.name),guest_token:null,guest_name:null,offer:null,answer:null,expires_at:expiresAt});
      if(created) return json({code,token,role:"host",expiresAt},201);
    }
    return json({error:"Não foi possível criar a sala. Tente novamente."},503);
  } catch { return json({error:"O serviço de conexão está indisponível. Tente novamente em instantes."},503); }
}
