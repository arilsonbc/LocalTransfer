import { getRoomStore, type RoomStore } from "../../../../lib/room-store";
import { allowed, authenticate, body, json, normalizeCode, ROOM_PATTERN, validOrigin } from "../../../../lib/room-service";

async function session(store:RoomStore, request:Request, context:{params:Promise<{code:string}>}) {
  const code=normalizeCode((await context.params).code);
  if(!ROOM_PATTERN.test(code)) return null;
  return authenticate(store,code,request);
}
export async function GET(request:Request,context:{params:Promise<{code:string}>}) {
  try {
    const store=getRoomStore();
    if(!await allowed(store,request,"poll",100)) return json({error:"Aguarde alguns instantes."},429);
    const auth=await session(store,request,context);
    if(!auth) return json({error:"Sala expirada ou acesso inválido."},401);
    const {row,role}=auth;
    return json({peerName:role==="host"?row.guest_name:row.host_name,joined:!!row.guest_token,description:role==="host"?row.answer:row.offer,expiresAt:row.expires_at});
  } catch {return json({error:"Conexão temporariamente indisponível."},503);}
}
export async function POST(request:Request,context:{params:Promise<{code:string}>}) {
  if(!validOrigin(request)) return json({error:"Origem não permitida."},403);
  try {
    const store=getRoomStore();
    if(!await allowed(store,request,"signal",20)) return json({error:"Muitas tentativas."},429);
    const auth=await session(store,request,context);
    if(!auth) return json({error:"Sala expirada ou acesso inválido."},401);
    const data=await body(request);
    if(typeof data.description!=="string" || data.description.length>40000) return json({error:"Conexão inválida."},400);
    const desc=JSON.parse(data.description);
    const revision=desc.revision??0;
    if(!Number.isSafeInteger(revision)||revision<0||revision>1000)return json({error:"Conexão inválida."},400);
    const restart=desc.type==="restart" && auth.role==="guest" && revision>0;
    if(!restart && (desc.type!==(auth.role==="host"?"offer":"answer")||typeof desc.sdp!=="string"||!desc.sdp.includes("m=application")||desc.sdp.includes("m=audio")||desc.sdp.includes("m=video"))) return json({error:"Conexão inválida."},400);
    const description=restart?{type:"restart",revision}:{type:desc.type,sdp:desc.sdp,...(revision?{revision,relay:desc.relay===true}:{})};
    const saved=await store.signal(auth.row.code,auth.role as "host"|"guest",auth.digest,JSON.stringify(description));
    if(!saved) return json({error:"Sala expirada."},401);
    return json({ok:true});
  } catch {return json({error:"Não foi possível conectar os aparelhos."},400);}
}
export async function DELETE(request:Request,context:{params:Promise<{code:string}>}) {
  if(!validOrigin(request)) return json({error:"Origem não permitida."},403);
  try {
    const store=getRoomStore();
    const auth=await session(store,request,context);
    if(!auth) return json({error:"Sala inválida."},401);
    await store.remove(auth.row.code,auth.digest);
    return json({ok:true});
  } catch {return json({error:"Serviço indisponível."},503);}
}
