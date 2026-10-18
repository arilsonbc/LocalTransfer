import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function source(file, replacements={}) {
  let text=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  for(const [from,to] of Object.entries(replacements))text=text.split(from).join(to);
  const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const serviceUrl=source('lib/room-service.ts');
const service=await import(serviceUrl);
const transfer=await import(source('lib/transfer.ts'));
const records=new Map(),counts=new Map();
const db={
  async create(row){if(records.has(row.code))return false;records.set(row.code,structuredClone(row));return true;},
  async get(code){const row=records.get(code);return row&&row.expires_at>Date.now()?structuredClone(row):null;},
  async join(code,token,name){const row=records.get(code);if(!row||row.expires_at<=Date.now()||row.guest_token)return null;row.guest_token=token;row.guest_name=name;return structuredClone(row);},
  async signal(code,role,digest,description){const row=records.get(code);if(!row||row.expires_at<=Date.now()||row[role+'_token']!==digest)return false;row[role==='host'?'offer':'answer']=description;return true;},
  async remove(code,digest){const row=records.get(code);if(!row||![row.host_token,row.guest_token].includes(digest))return false;return records.delete(code);},
  async allow(key,max){const count=(counts.get(key)||0)+1;counts.set(key,count);return count<=max;},
};
globalThis.__testStore=db;
const storeUrl='data:text/javascript,export const getRoomStore=()=>globalThis.__testStore';
const create=await import(source('app/api/rooms/route.ts',{'../../../lib/room-store':storeUrl,'../../../lib/room-service':serviceUrl}));
const join=await import(source('app/api/rooms/[code]/join/route.ts',{'../../../../../lib/room-store':storeUrl,'../../../../../lib/room-service':serviceUrl}));
const room=await import(source('app/api/rooms/[code]/route.ts',{'../../../../lib/room-store':storeUrl,'../../../../lib/room-service':serviceUrl}));
const turnUrl=source('lib/turn.ts');
const turn=await import(turnUrl);
const ice=await import(source('app/api/rooms/[code]/ice/route.ts',{'../../../../../lib/room-store':storeUrl,'../../../../../lib/room-service':serviceUrl,'../../../../../lib/turn':turnUrl}));
const request=(path,method='GET',body,token,origin='https://localtransfer.test')=>new Request(`https://localtransfer.test${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json','x-forwarded-for':crypto.randomUUID(),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
const context=code=>({params:Promise.resolve({code})});
async function newRoom(){const response=await create.POST(request('/api/rooms','POST',{name:'Computador'}));assert.equal(response.status,201);return response.json();}

test('códigos aleatórios, normalização e tokens',async()=>{
  for(let i=0;i<100;i++)assert.match(service.makeCode(),service.ROOM_PATTERN);
  assert.equal(service.normalizeCode('abcd-efgh'),'ABCDEFGH');
  assert.equal(service.makeToken().length,64);
  assert.notEqual(await service.hash('a'),await service.hash('b'));
});
test('validação rejeita lotes grandes, tamanhos inválidos e IDs duplicados',()=>{
  const file={id:'1',name:'foto.jpg',type:'image/jpeg',size:100};
  assert.equal(transfer.validateOffer({id:'batch',files:[file]}),true);
  for(const bad of [NaN,-1,Infinity,0.5,transfer.MAX_BATCH+1])assert.equal(transfer.validateOffer({id:'batch',files:[{...file,size:bad}]}),false);
  assert.equal(transfer.validateOffer({id:'batch',files:[file,file]}),false);
  assert.equal(transfer.validateOffer({id:'batch',files:[]}),false);
  assert.equal(transfer.safeFilename('../../foto.jpg'),'__.._foto.jpg');
});
test('criação, convite exclusivo, troca de SDP e autorização',async()=>{
  const host=await newRoom();
  assert.equal((await room.GET(request('/','GET'),context(host.code))).status,401);
  const results=await Promise.all([join.POST(request('/','POST',{name:'iPhone'}),context(host.code)),join.POST(request('/','POST',{name:'Android'}),context(host.code))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,404]);
  const guest=await results.find(r=>r.status===200).json();
  const fakeSdp={type:'offer',sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'};
  assert.equal((await room.POST(request('/','POST',{description:JSON.stringify(fakeSdp)},host.token),context(host.code))).status,200);
  const polled=await (await room.GET(request('/','GET',undefined,guest.token),context(host.code))).json();
  assert.deepEqual(JSON.parse(polled.description),fakeSdp);
  assert.equal(polled.peerName,'Computador');
  assert.equal((await room.POST(request('/','POST',{description:JSON.stringify(fakeSdp)},guest.token),context(host.code))).status,400);
  const persisted=records.get(host.code);
  assert.notEqual(persisted.host_token,host.token);
  assert.notEqual(persisted.guest_token,guest.token);
  assert.equal((await room.DELETE(request('/','DELETE',undefined,host.token),context(host.code))).status,200);
  assert.equal((await room.GET(request('/','GET',undefined,guest.token),context(host.code))).status,401);
});
test('salas expiradas e origem externa são rejeitadas',async()=>{
  const host=await newRoom();
  records.get(host.code).expires_at=0;
  assert.equal((await room.GET(request('/','GET',undefined,host.token),context(host.code))).status,401);
  assert.equal((await join.POST(request('/','POST',{name:'celular'}),context(host.code))).status,404);
  assert.equal((await create.POST(request('/','POST',{name:'x'},undefined,'https://outro.test'))).status,403);
});
test('limite de tentativas é aplicado',async()=>{
  const req=new Request('https://localtransfer.test',{headers:{'x-forwarded-for':'test-fixed-ip'}});
  assert.equal(await service.allowed(db,req,'limited',2),true);
  assert.equal(await service.allowed(db,req,'limited',2),true);
  assert.equal(await service.allowed(db,req,'limited',2),false);
});

test('TURN exige sala autenticada, gera credenciais temporárias e protege o segredo',async()=>{
  const host=await newRoom();
  const originalFetch=globalThis.fetch;
  const originalKey=process.env.CLOUDFLARE_TURN_KEY_ID;
  const originalToken=process.env.CLOUDFLARE_TURN_API_TOKEN;
  try {
    process.env.CLOUDFLARE_TURN_KEY_ID='test-key';
    process.env.CLOUDFLARE_TURN_API_TOKEN='server-secret';
    let calls=0;
    globalThis.fetch=async(url,options)=>{
      calls++;
      assert.equal(url,'https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers');
      assert.equal(options.headers.Authorization,'Bearer server-secret');
      assert.deepEqual(JSON.parse(options.body),{ttl:3600});
      return Response.json({iceServers:[{urls:['turn:turn.cloudflare.com:53','turns:turn.cloudflare.com:443?transport=tcp'],username:'temporary-user',credential:'temporary-password'}]}, {status:201});
    };
    assert.equal((await ice.POST(request('/','POST'),context(host.code))).status,401);
    assert.equal(calls,0);
    const response=await ice.POST(request('/','POST',{},host.token),context(host.code));
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const data=await response.json();
    assert.deepEqual(data.iceServers[0].urls,['turns:turn.cloudflare.com:443?transport=tcp']);
    assert.equal(JSON.stringify(data).includes('server-secret'),false);
    const fixed=()=>new Request('https://localtransfer.test/',{method:'POST',headers:{Authorization:`Bearer ${host.token}`,'x-forwarded-for':'ice-limit'}});
    for(let i=0;i<3;i++) assert.equal((await ice.POST(fixed(),context(host.code))).status,200);
    assert.equal((await ice.POST(fixed(),context(host.code))).status,429);
    globalThis.fetch=async()=>new Response('upstream-secret-error',{status:500});
    const failure=await ice.POST(request('/','POST',{},host.token),context(host.code));
    assert.equal(failure.status,503);
    assert.equal((await failure.text()).includes('upstream-secret-error'),false);
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
    await assert.rejects(()=>turn.generateIceServers(),/incomplete/);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.CLOUDFLARE_TURN_KEY_ID;else process.env.CLOUDFLARE_TURN_KEY_ID=originalKey;
    if(originalToken===undefined)delete process.env.CLOUDFLARE_TURN_API_TOKEN;else process.env.CLOUDFLARE_TURN_API_TOKEN=originalToken;
  }
});

// Transport simulation exercises framing and backpressure independently of
// network conditions. Real WebRTC is additionally verified in two browser tabs.
test('credenciais TURN são carregadas antes da criação da conexão WebRTC',async()=>{
  const originalFetch=globalThis.fetch;
  const originalPeer=globalThis.RTCPeerConnection;
  const configs=[],errors=[];
  const servers=[{urls:'turns:turn.cloudflare.com:443?transport=tcp',username:'temporary-user',credential:'temporary-password'}];
  globalThis.RTCPeerConnection=class {
    connectionState='new';
    constructor(config){configs.push(config);}
    close(){}
  };
  globalThis.fetch=async path=>Response.json(path.endsWith('/ice')?{iceServers:servers}:{joined:false,description:null});
  const hooks={state(){},peer(){},offer(){},progress(){},file(){},complete(){},error(e){errors.push(e);}};
  const session={code:'ABCDEFGH',token:'a'.repeat(64),role:'guest',expiresAt:Date.now()+10000};
  const connection=new transfer.TransferConnection(session,hooks);
  try {
    assert.equal(configs.length,0);
    await connection.start();
    assert.deepEqual(configs,[{iceServers:servers}]);
    assert.deepEqual(errors,[]);
  } finally {connection.close();globalThis.fetch=originalFetch;globalThis.RTCPeerConnection=originalPeer;}
});

class MockPeer {close(){};}
class MockChannel extends EventTarget {
  readyState='open';bufferedAmount=0;bufferedAmountLowThreshold=65536;peer=null;
  send(value){
    const copy=typeof value==='string'?value:value.slice(0);
    const bytes=typeof value==='string'?value.length:value.byteLength;
    this.bufferedAmount+=bytes;
    setTimeout(()=>{
      this.peer?.onmessage?.({data:copy});
      const before=this.bufferedAmount;this.bufferedAmount-=bytes;
      if(before>this.bufferedAmountLowThreshold&&this.bufferedAmount<=this.bufferedAmountLowThreshold)this.dispatchEvent(new Event('bufferedamountlow'));
    },0);
  }
  close(){this.readyState='closed';this.dispatchEvent(new Event('close'));}
}
function pair(accept=true){
  globalThis.RTCPeerConnection=MockPeer;
  const blobs=[],errors=[],completions=[];
  const hooks={state(){},peer(){},offer(){},progress(){},file(info,blob){blobs.push({info,blob});},complete(direction,count){completions.push({direction,count});},error(e){errors.push(e);}};
  const session={code:'ABCDEFGH',token:'a'.repeat(64),role:'host',expiresAt:Date.now()+10000};
  const left=new transfer.TransferConnection(session,hooks);
  const right=new transfer.TransferConnection({...session,role:'guest'},{...hooks,offer(value){if(value)queueMicrotask(()=>accept?right.accept():right.reject());}});
  const lc=new MockChannel(),rc=new MockChannel();lc.peer=rc;rc.peer=lc;
  left.bind(lc);right.bind(rc);
  return {left,right,blobs,errors,completions};
}
test('transferência em blocos preserva bytes, arquivos vazios e confirmação',async()=>{
  const p=pair();const bytes=new Uint8Array(1024*1024+37);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  const files=[new File([bytes],'foto-teste.bin',{type:'application/octet-stream'}),new File([],'vazio.txt')];
  await p.left.send(files);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(p.blobs.length,2);
  assert.deepEqual(new Uint8Array(await p.blobs[0].blob.arrayBuffer()),bytes);
  assert.equal(p.blobs[1].blob.size,0);
  assert.equal(p.errors.length,0);
  assert.ok(p.completions.some(c=>c.direction==='send'&&c.count===2));
  assert.ok(p.completions.some(c=>c.direction==='receive'&&c.count===2));
  p.left.close();p.right.close();
});
test('recusa do receptor impede envio dos dados',async()=>{
  const p=pair(false);
  await assert.rejects(()=>p.left.send([new File(['teste'],'arquivo.txt')]),/recusado/);
  assert.equal(p.blobs.length,0);assert.equal(p.left.busy,false);
  p.left.close();p.right.close();
});
test('blocos não autorizados são recusados',async()=>{
  const p=pair();
  await assert.rejects(()=>p.right.message(new ArrayBuffer(10)),/sem autorização/);
  assert.equal(p.blobs.length,0);p.left.close();p.right.close();
});
