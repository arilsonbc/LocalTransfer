import { env } from "cloudflare:workers";
import { allowed, body, deviceName, hash, json, makeCode, makeToken, ROOM_TTL, validOrigin } from "../../../lib/room-service";

export async function POST(request: Request) {
  if (!validOrigin(request)) return json({error:"Origem não permitida."},403);
  const db = env.DB;
  if (!db) return json({error:"Serviço de conexão indisponível."},503);
  try {
    if (!await allowed(db,request,"create",10)) return json({error:"Aguarde um minuto antes de criar outra sala."},429);
    const data = await body(request);
    const token = makeToken();
    const tokenHash = await hash(token);
    const expiresAt = Date.now() + ROOM_TTL;
    await db.batch([
      db.prepare("DELETE FROM rooms WHERE expires_at<?").bind(Date.now()),
      db.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(Date.now()),
    ]);
    for (let i=0;i<4;i++) {
      const code = makeCode();
      const result = await db.prepare("INSERT OR IGNORE INTO rooms (code,host_token,host_name,expires_at) VALUES (?,?,?,?)").bind(code,tokenHash,deviceName(data.name),expiresAt).run();
      if(result.meta.changes) return json({code,token,role:"host",expiresAt},201);
    }
    return json({error:"Não foi possível criar a sala. Tente novamente."},503);
  } catch { return json({error:"Não foi possível criar a sala. Verifique sua conexão e tente novamente."},400); }
}
