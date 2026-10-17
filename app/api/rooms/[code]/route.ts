import { env } from "cloudflare:workers";
import { allowed, authenticate, body, json, normalizeCode, ROOM_PATTERN, validOrigin } from "../../../../lib/room-service";

async function session(request:Request, context:{params:Promise<{code:string}>}) {
  const code=normalizeCode((await context.params).code);
  if(!env.DB || !ROOM_PATTERN.test(code)) return null;
  return authenticate(env.DB,code,request);
}
export async function GET(request:Request,context:{params:Promise<{code:string}>}) {
  try {
    if(!env.DB) return json({error:"Serviço indisponível."},503);
    if(!await allowed(env.DB,request,"poll",100)) return json({error:"Aguarde alguns instantes."},429);
    const auth=await session(request,context);
    if(!auth) return json({error:"Sala expirada ou acesso inválido."},401);
    const {row,role}=auth;
    return json({peerName:role==="host"?row.guest_name:row.host_name,joined:!!row.guest_token,description:role==="host"?row.answer:row.offer,expiresAt:row.expires_at});
  } catch {return json({error:"Conexão temporariamente indisponível."},503);}
}
export async function POST(request:Request,context:{params:Promise<{code:string}>}) {
  if(!validOrigin(request)) return json({error:"Origem não permitida."},403);
  try {
    if(!env.DB) return json({error:"Serviço indisponível."},503);
    if(!await allowed(env.DB,request,"signal",20)) return json({error:"Muitas tentativas."},429);
    const auth=await session(request,context);
    if(!auth) return json({error:"Sala expirada ou acesso inválido."},401);
    const data=await body(request);
    if(typeof data.description!=="string" || data.description.length>40000) return json({error:"Conexão inválida."},400);
    const desc=JSON.parse(data.description);
    if(desc.type!==(auth.role==="host"?"offer":"answer")||typeof desc.sdp!=="string"||!desc.sdp.includes("m=application")||desc.sdp.includes("m=audio")||desc.sdp.includes("m=video")) return json({error:"Conexão inválida."},400);
    const field=auth.role==="host"?"offer":"answer";
    await env.DB.prepare(`UPDATE rooms SET ${field}=? WHERE code=? AND expires_at>?`).bind(JSON.stringify({type:desc.type,sdp:desc.sdp}),auth.row.code,Date.now()).run();
    return json({ok:true});
  } catch {return json({error:"Não foi possível conectar os aparelhos."},400);}
}
export async function DELETE(request:Request,context:{params:Promise<{code:string}>}) {
  if(!validOrigin(request)) return json({error:"Origem não permitida."},403);
  const auth=await session(request,context);
  if(!auth || !env.DB) return json({error:"Sala inválida."},401);
  await env.DB.prepare("DELETE FROM rooms WHERE code=?").bind(auth.row.code).run();
  return json({ok:true});
}
