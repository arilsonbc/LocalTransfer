import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';

function source(file, replacements={}) {
  let text=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  for(const [from,to] of Object.entries(replacements))text=text.split(from).join(to);
  const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const serviceUrl=source('lib/room-service.ts');
const service=await import(serviceUrl);
const progressUrl=source('lib/progress.ts');
const transferUrl=source('lib/transfer.ts',{'./progress':progressUrl});
const transfer=await import(transferUrl);
const disk=await import(source('lib/disk-receiver.ts',{'./transfer':transferUrl}));
const invite=await import(source('lib/invite.ts'));
const progress=await import(progressUrl);
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

test('convites aceitam código ou link e não incluem tokens ou parâmetros extras',()=>{
  const url=invite.makeInvite('https://localtransfer.test/?relay=1&token=segredo#anterior','abcd-efgh');
  assert.equal(url,'https://localtransfer.test/?relay=1#sala=ABCDEFGH');
  assert.equal(invite.readInvite(url),'ABCDEFGH');
  assert.equal(invite.readInvite('abcd efgh'),'ABCDEFGH');
  assert.equal(invite.readInvite('https://outro.test/#sala=ABCDEFGH'),'ABCDEFGH');
  assert.equal(invite.readInvite('https://localtransfer.test/#token=segredo'),null);
  assert.equal(invite.readInvite('<script>'),null);
  assert.throws(()=>invite.makeInvite('https://localtransfer.test','invalid'));
});

test('estimativa de velocidade usa o lote inteiro e reinicia depois de uma retomada',()=>{
  const meter=new progress.ProgressMeter();
  assert.equal(meter.sample(0,10000,1,2,100).secondsRemaining,null);
  const measured=meter.sample(2000,10000,1,2,1100);
  assert.equal(measured.bytesPerSecond,2000);assert.equal(measured.percent,20);assert.equal(measured.secondsRemaining,4);
  assert.equal(meter.sample(1000,10000,1,2,1600).secondsRemaining,null);
  assert.equal(meter.sample(10000,10000,2,2,2100).percent,100);
  assert.equal(progress.formatRemaining(null),'Calculando tempo restante…');
  assert.match(progress.formatRemaining(120),/2 min/);
  assert.match(progress.formatRemaining(7200),/2 h/);
});

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
      assert.deepEqual(JSON.parse(options.body),{ttl:172800});
      return Response.json({iceServers:[{urls:['turn:turn.cloudflare.com:53','turns:turn.cloudflare.com:443?transport=tcp'],username:'temporary-user',credential:'temporary-password'}]}, {status:201});
    };
    assert.equal((await ice.POST(request('/','POST'),context(host.code))).status,401);
    assert.equal(calls,0);
    const response=await ice.POST(request('/','POST',{},host.token),context(host.code));
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    const data=await response.json();
    assert.equal(data.iceServers[1].urls,'turns:turn.cloudflare.com:443?transport=tcp');
    assert.equal(data.iceServers[1].username,'temporary-user');
    assert.equal(data.iceServers[1].credential,'temporary-password');
    assert.ok(!JSON.stringify(data).includes(':53'));
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

test('pareamento espera a rota TURN estar no SDP antes de sinalizar',async()=>{
  const originalPeer=globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection=class extends EventTarget {
    connectionState='new';iceConnectionState='new';iceGatheringState='gathering';
    localDescription={type:'offer',sdp:'v=0\r\na=candidate:1 1 udp 1 192.0.2.1 9999 typ host\r\n'};
    close(){}
  };
  const hooks={state(){},peer(){},offer(){},progress(){},file(){},complete(){},error(){}};
  const conn=new transfer.TransferConnection({code:'ABCDEFGH',token:'a'.repeat(64),role:'host'},hooks,true);
  try {
    conn.createPeer([{urls:'turns:turn.cloudflare.com:443?transport=tcp',username:'temporary',credential:'password'}]);
    let finished=false;
    const gathering=conn.gather().then(()=>{finished=true;});
    await Promise.resolve();assert.equal(finished,false);
    conn.pc.localDescription.sdp+='a=candidate:2 1 udp 1 192.0.2.2 9999 typ relay\r\n';
    conn.pc.dispatchEvent(new Event('icecandidate'));
    await gathering;
    assert.equal(conn.diagnostics.relayCandidates,1);
    assert.equal(conn.diagnostics.mode,'relay');
    assert.equal(JSON.stringify(conn.diagnostics).includes('192.0.2'),false);
  } finally {conn.close();globalThis.RTCPeerConnection=originalPeer;}
});

test('ausência de rota TURN não é tratada como pareamento pronto',async()=>{
  const originalPeer=globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection=class extends EventTarget {
    connectionState='new';iceConnectionState='new';iceGatheringState='complete';
    localDescription={sdp:'v=0\r\na=candidate:1 1 udp 1 192.0.2.1 9999 typ host\r\n'};
    close(){}
  };
  const hooks={state(){},peer(){},offer(){},progress(){},file(){},complete(){},error(){}};
  const conn=new transfer.TransferConnection({code:'ABCDEFGH',token:'a'.repeat(64),role:'host'},hooks);
  try {
    conn.createPeer([{urls:'turns:turn.cloudflare.com:443?transport=tcp',username:'temporary',credential:'password'}]);
    await assert.rejects(()=>conn.gather(),/TURN-SEM-ROTA/);
  } finally {conn.close();globalThis.RTCPeerConnection=originalPeer;}
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
function pair(accept=true,sink){
  globalThis.RTCPeerConnection=MockPeer;
  const blobs=[],errors=[],completions=[];
  const hooks={state(){},peer(){},offer(){},progress(){},file(info,blob){blobs.push({info,blob});},complete(direction,count){completions.push({direction,count});},error(e){errors.push(e);}};
  const session={code:'ABCDEFGH',token:'a'.repeat(64),role:'host',expiresAt:Date.now()+10000};
  const left=new transfer.TransferConnection(session,hooks);
  const right=new transfer.TransferConnection({...session,role:'guest'},{...hooks,offer(value){if(value)queueMicrotask(()=>accept?right.accept(sink):right.reject());}});
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

test('limite de 100 GB é exato por arquivo e pelo total do lote',()=>{
  assert.equal(transfer.MAX_BATCH,100_000_000_000);
  const file={id:'1',name:'grande.bin',size:transfer.MAX_BATCH,type:''};
  assert.equal(transfer.validateOffer({id:'batch',files:[file]}),true);
  assert.equal(transfer.validateOffer({id:'batch',files:[{...file,size:file.size+1}]}),false);
  assert.equal(transfer.validateOffer({id:'batch',files:[file,{...file,id:'2',size:1}]}),false);
});

test('arquivo acima de 200 MB é gravado em fluxo com memória limitada e confirmação do disco',async()=>{
  const size=transfer.MAX_MEMORY+37;
  let bytes=0,closed=false,writes=0,maxQueued=0;
  const sentHash=createHash('sha256'),receivedHash=createHash('sha256');
  const p=pair(true,async()=>({
    async write(chunk){receivedHash.update(new Uint8Array(chunk));bytes+=chunk.byteLength;writes++;assert.ok(chunk.byteLength<=transfer.CHUNK_SIZE);assert.equal(p.right.receiving.chunks.length,0);maxQueued=Math.max(maxQueued,p.right.queuedBytes);},
    async close(){closed=true;assert.equal(bytes,size);},
    async abort(){},
  }));
  // Generate each block lazily: no 200 MB test buffer is allocated.
  const file={name:'grande.bin',size,type:'application/octet-stream',slice(start,end){return {async arrayBuffer(){const chunk=new Uint8Array(Math.min(end,size)-start).fill((start/transfer.CHUNK_SIZE)%251);sentHash.update(chunk);return chunk.buffer;}};}};
  try {
    await p.left.send([file]);await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(bytes,size);assert.ok(closed);assert.ok(writes>1000);
    assert.equal(sentHash.digest('hex'),receivedHash.digest('hex'));
    assert.equal(p.blobs[0].blob,null);
    assert.ok(maxQueued<=transfer.FLOW_WINDOW+1024);
    assert.ok(p.completions.some(c=>c.direction==='receive'));
  } finally {p.left.close();p.right.close();}
});

test('destino em disco cria subpasta e nomes seguros sem sobrescrever arquivos existentes',async()=>{
  const originalWindow=globalThis.window;
  const folders=[],names=[],writes=[];
  let closed=false,aborted=false;
  globalThis.window={async showDirectoryPicker(options){
    assert.deepEqual(options,{mode:'readwrite'});
    return {async getDirectoryHandle(name,options){
      assert.deepEqual(options,{create:true});folders.push(name);
      return {async getFileHandle(name){names.push(name);return {async createWritable(){return {async write(value){writes.push(value.byteLength);},async close(){closed=true;},async abort(){aborted=true;}};}};}};
    }};
  }};
  try {
    assert.ok(disk.canSaveToDisk());
    const folder=await disk.chooseReceiveFolder();
    const sink=await folder.open({name:'../../foto.jpg',size:3},0);
    await sink.write(new ArrayBuffer(3));await sink.close();
    const other=await folder.open({name:'../../foto.jpg',size:3},1);await other.abort();
    assert.equal(folders.length,1);assert.match(folders[0],/^LocalTransfer-/);
    assert.deepEqual(names,['001-__.._foto.jpg','002-__.._foto.jpg']);
    assert.deepEqual(writes,[3]);assert.ok(closed&&aborted);
  } finally {globalThis.window=originalWindow;}
});

test('sem destino em disco, lote grande é recusado antes de enviar dados',async()=>{
  const p=pair();
  try {
    await assert.rejects(()=>p.left.send([{name:'grande.bin',size:transfer.MAX_MEMORY+1,type:''}]),/recusado/);
    assert.equal(p.blobs.length,0);
    assert.ok(p.errors.some(e=>e.includes('Chrome ou Edge')));
  } finally {p.left.close();p.right.close();}
});

test('falha de gravação cancela envio e aborta o arquivo parcial',async()=>{
  let aborted=false;
  const p=pair(true,async()=>({async write(){throw new Error('Disco cheio');},async close(){throw new Error('Não deveria concluir');},async abort(){aborted=true;}}));
  try {
    await assert.rejects(()=>p.left.send([new File([new Uint8Array(transfer.FLOW_WINDOW)],'arquivo.bin')]),/cancelada/);
    assert.ok(aborted);assert.equal(p.blobs.length,0);
    assert.ok(p.errors.some(e=>e.includes('Disco cheio')));
  } finally {p.left.close();p.right.close();}
});
