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
const integrityUrl=source('lib/integrity.ts',{'@noble/hashes/sha2.js':import.meta.resolve('@noble/hashes/sha2.js')});
const integrity=await import(integrityUrl);
const transferUrl=source('lib/transfer.ts',{'./progress':progressUrl,'./integrity':integrityUrl});
const transfer=await import(transferUrl);
const photoUrl=source('lib/photo-preview.ts');
const photo=await import(photoUrl);
const disk=await import(source('lib/disk-receiver.ts',{'./transfer':transferUrl,'./photo-preview':photoUrl}));
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
const usageUrl=source('lib/turn-usage.ts');
const usage=await import(usageUrl);
const ice=await import(source('app/api/rooms/[code]/ice/route.ts',{'../../../../../lib/room-store':storeUrl,'../../../../../lib/room-service':serviceUrl,'../../../../../lib/turn-usage':usageUrl,'../../../../../lib/turn':turnUrl}));
const request=(path,method='GET',body,token,origin='https://localtransfer.test')=>new Request(`https://localtransfer.test${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json','x-forwarded-for':crypto.randomUUID(),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
const context=code=>({params:Promise.resolve({code})});
async function newRoom(){const response=await create.POST(request('/api/rooms','POST',{name:'Computador'}));assert.equal(response.status,201);return response.json();}

test('consumo TURN usa egress da Cloudflare, cache compartilhado e orcamento atualizado',async()=>{
  const original=globalThis.fetch;const env={...process.env};const cache=new Map();let calls=0;
  const store={cached:async k=>cache.get(k)||null,cache:async(k,v)=>cache.set(k,v)};
  try{
    process.env.CLOUDFLARE_ACCOUNT_ID='test-account';process.env.CLOUDFLARE_ANALYTICS_API_TOKEN='analytics-secret';process.env.TURN_MONTHLY_BUDGET_GB='1';
    globalThis.fetch=async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.variables.from,'2026-10-01');assert.equal(body.variables.to,'2026-10-21');assert.equal(options.headers.Authorization,'Bearer analytics-secret');return Response.json({data:{viewer:{accounts:[{callsTurnUsageAdaptiveGroups:[{sum:{egressBytes:850000000,ingressBytes:900000000}}]}]}},errors:null});};
    const now=Date.parse('2026-10-21T10:00:00Z');
    assert.equal((await usage.readTurnUsage(store,now)).status,'warning');
    assert.equal((await usage.readTurnUsage(store,now+1000)).status,'warning');assert.equal(calls,1);
    process.env.TURN_MONTHLY_BUDGET_GB='0.5';assert.equal((await usage.readTurnUsage(store,now+2000)).status,'limit');assert.equal(calls,1);
    await usage.readTurnUsage(store,now+300001);assert.equal(calls,2);
  }finally{globalThis.fetch=original;process.env=env;}
});
test('erros e configuracao parcial de Analytics nunca viram consumo zero autorizado',async()=>{
  const original=globalThis.fetch;const env={...process.env};
  try{
    process.env.CLOUDFLARE_ACCOUNT_ID='test-account';process.env.CLOUDFLARE_ANALYTICS_API_TOKEN='analytics-secret';
    for(const data of [{errors:[{message:'secret upstream failure'}]},{data:{viewer:{accounts:[]}}},{data:{viewer:{accounts:[{callsTurnUsageAdaptiveGroups:[{sum:{egressBytes:-1,ingressBytes:0}}]}]}}}]){
      globalThis.fetch=async()=>Response.json(data);assert.equal((await usage.readTurnUsage({})).status,'unavailable');
    }
    delete process.env.CLOUDFLARE_ANALYTICS_API_TOKEN;assert.equal((await usage.readTurnUsage({})).status,'unavailable');
    delete process.env.CLOUDFLARE_ACCOUNT_ID;assert.equal((await usage.readTurnUsage({})).status,'disabled');
    process.env.TURN_MONTHLY_BUDGET_GB='invalid';await assert.rejects(()=>usage.readTurnUsage({}),/Invalid TURN budget/);
  }finally{globalThis.fetch=original;process.env=env;}
});
test('limite de consumo impede emitir credenciais sem impedir tentativa direta',async()=>{
  const original=globalThis.fetch;const env={...process.env};
  try{
    const host=await newRoom();let calls=0;
    process.env.CLOUDFLARE_ACCOUNT_ID='test-account';process.env.CLOUDFLARE_ANALYTICS_API_TOKEN='analytics-secret';process.env.TURN_MONTHLY_BUDGET_GB='1';
    globalThis.fetch=async url=>{calls++;assert.equal(url,'https://api.cloudflare.com/client/v4/graphql');return Response.json({data:{viewer:{accounts:[{callsTurnUsageAdaptiveGroups:[{sum:{egressBytes:1000000000,ingressBytes:1500000000}}]}]}}});};
    const response=await ice.POST(request('/','POST',{},host.token),context(host.code));assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.turn.status,'limit');assert.deepEqual(data.iceServers,usage.STUN_ONLY);assert.equal(calls,1);assert.ok(!JSON.stringify(data).includes('analytics-secret'));assert.ok(!JSON.stringify(data).includes('1500000000'));
  }finally{globalThis.fetch=original;process.env=env;}
});
test('cota por participante nao pode ser contornada trocando de IP',async()=>{
  const host=await newRoom();const key=`ice-session:${host.code}:host`;counts.set(key,6);
  const response=await ice.POST(request('/','POST',{},host.token),context(host.code));assert.equal(response.status,429);
  assert.equal((await ice.POST(request('/','POST',{},host.token),context(host.code))).status,429);
});

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

test('sinalização versionada preserva revisão e só o receptor pode pedir reconexão',async()=>{
  const host=await newRoom();
  const guest=await (await join.POST(request('/','POST',{name:'Receptor'}),context(host.code))).json();
  const offer={type:'offer',sdp:'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n',revision:2,relay:true};
  assert.equal((await room.POST(request('/','POST',{description:JSON.stringify(offer)},host.token),context(host.code))).status,200);
  const state=await (await room.GET(request('/','GET',undefined,guest.token),context(host.code))).json();
  assert.deepEqual(JSON.parse(state.description),offer);
  const restart={type:'restart',revision:2};
  assert.equal((await room.POST(request('/','POST',{description:JSON.stringify(restart)},guest.token),context(host.code))).status,200);
  assert.equal((await room.POST(request('/','POST',{description:JSON.stringify(restart)},host.token),context(host.code))).status,400);
  assert.equal((await room.POST(request('/','POST',{description:JSON.stringify({...offer,revision:-1})},host.token),context(host.code))).status,400);
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
  const conn=new transfer.TransferConnection({code:'ABCDEFGH',token:'a'.repeat(64),role:'host'},hooks,true);
  try {
    conn.createPeer([{urls:'turns:turn.cloudflare.com:443?transport=tcp',username:'temporary',credential:'password'}]);
    await assert.rejects(()=>conn.gather(),/TURN-SEM-ROTA/);
  } finally {conn.close();globalThis.RTCPeerConnection=originalPeer;}
});

class MockPeer {close(){};}

test('reconexão ignora SDP de uma tentativa anterior',async()=>{
  const originalFetch=globalThis.fetch;
  const hooks={state(){},peer(){},offer(){},progress(){},file(){},complete(){},error(){}};
  const conn=new transfer.TransferConnection({code:'ABCDEFGH',token:'a'.repeat(64),role:'host'},hooks);
  let applied=0;
  conn.revision=2;
  conn.pc={close(){},async setRemoteDescription(){applied++;}};
  try {
    globalThis.fetch=async()=>Response.json({joined:true,description:JSON.stringify({type:'answer',sdp:'old',revision:1})});
    await conn.poll();assert.equal(applied,0);
    globalThis.fetch=async()=>Response.json({joined:true,description:JSON.stringify({type:'answer',sdp:'new',revision:2})});
    await conn.poll();assert.equal(applied,1);
  } finally {conn.close();globalThis.fetch=originalFetch;}
});

test('queda transitória preserva os blocos e o destino de gravação',async()=>{
  const hooks={state(){},peer(){},offer(){},progress(){},file(){},complete(){},error(){}};
  const conn=new transfer.TransferConnection({code:'ABCDEFGH',token:'a'.repeat(64),role:'host'},hooks);
  let aborted=false;
  conn.receiving={info:{id:'file'},bytes:16384,chunks:[],sink:{async abort(){aborted=true;}}};
  const waiting=assert.rejects(conn.wait('flow'),/Reconectando/);
  try {conn.pauseTransport();await waiting;assert.equal(conn.receiving.bytes,16384);assert.equal(aborted,false);}
  finally{conn.close();}
});
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
function reconnectTransport(p){
  p.left.pauseTransport();p.right.pauseTransport();
  const oldLeft=p.left.channel,oldRight=p.right.channel;
  p.left.transportGeneration++;p.right.transportGeneration++;
  p.left.channel=null;p.right.channel=null;oldLeft.close();oldRight.close();
  setTimeout(()=>{
    const left=new MockChannel(),right=new MockChannel();left.peer=right;right.peer=left;
    p.left.bind(left);p.right.bind(right);left.onopen();right.onopen();
  },5);
}
async function until(predicate,timeout=2000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw new Error('Condition timed out');await new Promise(r=>setTimeout(r,5));}}
test('selecao parcial nao le arquivos recusados e preserva selecao hash e progresso apos queda',async()=>{
  const p=pair();let dropped=false;const stats=[];
  p.right.hooks.offer=offer=>{if(offer)queueMicrotask(()=>p.right.accept(undefined,offer.id,[offer.files[1].id,offer.files[3].id]));};
  p.right.hooks.progress=(name,current,total,direction,stat)=>{stats.push(stat);if(current>=131072&&!dropped){dropped=true;setTimeout(()=>reconnectTransport(p),0);}};
  const excluded=new File(['não enviar'],'recusado.txt');excluded.slice=()=>{throw new Error('Arquivo recusado foi lido');};
  const data=Buffer.alloc(2*transfer.FLOW_WINDOW+37,123);
  try{
    await p.left.send([excluded,new File([data],'aceito.bin'),excluded,new File(['último'],'aceito.txt')]);await new Promise(r=>setTimeout(r,20));
    assert.ok(dropped);assert.deepEqual(p.blobs.map(f=>f.info.name),['aceito.bin','aceito.txt']);assert.ok(p.blobs.every(f=>f.info.integrity==='verified'));
    assert.deepEqual(Buffer.from(await p.blobs[0].blob.arrayBuffer()),data);assert.ok(stats.every(s=>s.fileCount===2&&s.total===data.length+Buffer.byteLength('último')));
    assert.ok(p.completions.every(c=>c.count===2));
  }finally{p.left.close();p.right.close();}
});
test('escolher um arquivo pequeno evita exigir pasta pelo tamanho do lote original',async()=>{
  const p=pair();
  p.right.hooks.offer=offer=>{if(offer)queueMicrotask(()=>p.right.accept(undefined,offer.id,[offer.files[1].id]));};
  const huge={name:'ignorado.bin',size:transfer.MAX_MEMORY+1,type:'',slice(){throw new Error('Não deveria ler o arquivo grande');}};
  try{await p.left.send([huge,new File(['pequeno'],'escolhido.txt')]);assert.equal(p.blobs.length,1);assert.equal(p.blobs[0].info.name,'escolhido.txt');}finally{p.left.close();p.right.close();}
});
test('aceite com IDs desconhecidos duplicados ou lista vazia nunca envia bytes',async()=>{
  for(const ids of [[],['desconhecido'],['same','same']]){
    const p=pair();p.right.hooks.offer=offer=>{if(offer)p.right.control({type:'accept',selected:ids});};
    try{await assert.rejects(()=>p.left.send([new File(['segredo'],'arquivo.txt')]),/Seleção/);assert.equal(p.blobs.length,0);}finally{p.left.close();p.right.close();}
  }
});
test('receptor rejeita arquivo fora da selecao e selecao vazia nao inicia recebimento',async()=>{
  const p=pair();p.right.hooks.offer=()=>{};
  const offer={id:'lote',files:[{id:'a',name:'a',size:1,type:''},{id:'b',name:'b',size:1,type:''}]};
  try{
    await p.right.message(JSON.stringify({type:'offer',offer,selection:1}));p.right.accept(undefined,offer.id,[]);assert.equal(p.right.accepted,false);
    p.right.accept(undefined,offer.id,['b']);await assert.rejects(()=>p.right.message(JSON.stringify({type:'file',id:'a',offset:0})),/Sequência/);
  }finally{p.left.close();p.right.close();}
});
test('perda da confirmacao final preserva selecao parcial sem duplicar arquivos',async()=>{
  const p=pair();let dropped=false;
  p.right.hooks.offer=offer=>{if(offer)queueMicrotask(()=>p.right.accept(undefined,offer.id,[offer.files[1].id]));};
  const original=p.right.channel.send.bind(p.right.channel);
  p.right.channel.send=value=>{if(typeof value==='string'&&JSON.parse(value).type==='done-ack'&&!dropped){dropped=true;setTimeout(()=>reconnectTransport(p),0);return;}original(value);};
  try{await p.left.send([new File(['ignorar'],'ignorado'),new File(['aceito'],'aceito')]);await new Promise(r=>setTimeout(r,20));assert.ok(dropped);assert.equal(p.blobs.length,1);assert.equal(p.blobs[0].info.name,'aceito');assert.ok(p.completions.every(c=>c.count===1));}finally{p.left.close();p.right.close();}
});
test('remetente antigo permite lote completo mas recusa selecao parcial',async()=>{
  const p=pair();p.right.hooks.offer=()=>{};
  const offer={id:'antigo',files:[{id:'a',name:'a',size:0,type:''},{id:'b',name:'b',size:0,type:''}]};
  try{await p.right.message(JSON.stringify({type:'offer',offer}));p.right.accept(undefined,offer.id,['a']);assert.equal(p.right.accepted,false);p.right.accept();assert.equal(p.right.accepted,true);}finally{p.left.close();p.right.close();}
});
test('pausa nos dois aparelhos preserva progresso e hash inclusive apos reconexao',async()=>{
  const p=pair();const bytes=Buffer.alloc(3*transfer.FLOW_WINDOW+37,97);let requested=false;
  const progress=p.right.hooks.progress;
  p.right.hooks.progress=(...args)=>{progress(...args);if(args[1]>=131072&&!requested){requested=true;p.right.setPaused(true);}};
  try{
    const sending=p.left.send([new File([bytes],'pausar.bin')]);
    await until(()=>p.left.remotePaused);await new Promise(r=>setTimeout(r,50));
    const received=p.right.receiving.bytes;await new Promise(r=>setTimeout(r,50));assert.equal(p.right.receiving.bytes,received);
    p.left.setPaused(true);await until(()=>p.right.remotePaused);p.right.setPaused(false);
    await until(()=>!p.left.remotePaused);assert.equal(p.left.paused,true);
    reconnectTransport(p);await new Promise(r=>setTimeout(r,50));
    assert.equal(p.right.receiving.bytes,received);assert.equal(p.completions.length,0);
    p.left.setPaused(false);await sending;await new Promise(r=>setTimeout(r,10));
    assert.equal(p.blobs.length,1);assert.equal(p.blobs[0].info.integrity,'verified');assert.deepEqual(Buffer.from(await p.blobs[0].blob.arrayBuffer()),bytes);
  }finally{p.left.close();p.right.close();}
});
test('pausa suspende timeout de confirmacoes e cancelamento libera espera',async()=>{
  const p=pair();
  try{
    p.left.updatePause(true,false);let settled=false;
    const waiting=p.left.wait('probe',30).finally(()=>{settled=true;});
    await new Promise(r=>setTimeout(r,70));assert.equal(settled,false);
    p.left.updatePause(false,false);p.left.resolve('probe');await waiting;
    p.left.updatePause(true,false);const blocked=p.left.waitIfPaused();p.left.cancel();
    await assert.rejects(()=>blocked,/cancelada/);
  }finally{p.left.close();p.right.close();}
});
test('pausar atualiza bytes mesmo antes do intervalo normal de renderizacao',()=>{
  const p=pair(),shown=[];
  try{
    p.left.outgoing=true;p.left.peerPause=true;p.left.hooks.progress=(_name,bytes)=>shown.push(bytes);
    p.left.progress('arquivo.bin',0,1048576,'send');p.left.lastProgressAt=Date.now();
    p.left.progress('arquivo.bin',16384,1048576,'send');assert.equal(shown.at(-1),0);
    p.left.setPaused(true);assert.equal(shown.at(-1),16384);
  }finally{p.left.close();p.right.close();}
});

test('retomada preserva bytes de um arquivo parcial e não repete os arquivos concluídos',async()=>{
  const received=[],opened=[];let dropped=false,resumedOffset=0;
  const p=pair(true,async(info,index)=>{
    opened.push(index);const chunks=[];
    return {async write(chunk){chunks.push(new Uint8Array(chunk));if(index===1 && !dropped && chunks.length===40){dropped=true;setTimeout(()=>reconnectTransport(p),0);}},async close(){received[index]=Buffer.concat(chunks);},async abort(){throw new Error('Uma queda transitória não deve abortar o disco');}};
  });
  const originalMessage=p.right.message.bind(p.right);
  p.right.message=async data=>{if(typeof data==='string'){const message=JSON.parse(data);if(message.type==='file'&&message.offset>0)resumedOffset=message.offset;}return originalMessage(data);};
  const bytes=Buffer.alloc(2*transfer.FLOW_WINDOW+37);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  const first=Buffer.from('arquivo já concluído');
  try {
    await p.left.send([new File([first],'primeiro.txt'),new File([bytes],'segundo.bin')]);
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(dropped);assert.ok(resumedOffset>0);assert.deepEqual(opened,[0,1]);
    assert.deepEqual(received[0],first);assert.deepEqual(received[1],bytes);
    assert.equal(p.blobs.length,2);assert.equal(p.completions.filter(c=>c.direction==='receive').length,1);
  } finally {p.left.close();p.right.close();}
});

test('perda da confirmação final reconecta sem entregar arquivos duplicados',async()=>{
  const p=pair();let dropped=false;
  const original=p.right.channel.send.bind(p.right.channel);
  p.right.channel.send=value=>{
    if(typeof value==='string' && JSON.parse(value).type==='done-ack' && !dropped){dropped=true;setTimeout(()=>reconnectTransport(p),0);return;}
    original(value);
  };
  try {
    await p.left.send([new File(['conteúdo'],'arquivo.txt')]);
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(dropped);assert.equal(p.blobs.length,1);
    assert.equal(p.completions.filter(c=>c.direction==='receive').length,1);
    assert.equal(await p.blobs[0].blob.text(),'conteúdo');
  } finally {p.left.close();p.right.close();}
});
test('SHA-256 incremental preserva digest ao voltar e avançar em checkpoints',async()=>{
  const bytes=Buffer.alloc(8*transfer.FLOW_WINDOW+37);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  const file=new Blob([bytes]);const hash=new integrity.SendingIntegrity();
  for(let i=0;i<7*transfer.FLOW_WINDOW;i+=transfer.CHUNK_SIZE)hash.update(bytes.subarray(i,i+transfer.CHUNK_SIZE).buffer.slice(bytes.byteOffset+i,bytes.byteOffset+i+transfer.CHUNK_SIZE));
  assert.ok(hash.checkpoints.size<=6);
  const offset=6*transfer.FLOW_WINDOW+32768;let reads=0;
  await hash.seek(file,offset,async()=>{reads++;});assert.ok(reads<10,'resume should not rehash the entire prefix');
  for(let i=offset;i<bytes.length;i+=transfer.CHUNK_SIZE)hash.update(await file.slice(i,i+transfer.CHUNK_SIZE).arrayBuffer());
  assert.equal(hash.digest(),createHash('sha256').update(bytes).digest('hex'));
  await hash.seek(file,0,async()=>{});assert.equal(hash.digest(),createHash('sha256').digest('hex'));
});
test('arquivo alterado no transporte falha antes de concluir ou salvar',async()=>{
  let aborted=false,closed=false;
  const p=pair(true,async()=>({async write(){},async close(){closed=true;},async abort(){aborted=true;}}));
  const send=p.left.channel.send.bind(p.left.channel);let corrupted=false;
  p.left.channel.send=value=>{if(value instanceof ArrayBuffer&&!corrupted){corrupted=true;value=value.slice(0);new Uint8Array(value)[0]^=1;}send(value);};
  try{
    await assert.rejects(()=>p.left.send([new File(['bytes originais'],'foto.jpg')]),/cancelada/);
    assert.ok(corrupted);assert.ok(aborted);assert.equal(closed,false);assert.equal(p.blobs.length,0);
    assert.ok(p.errors.some(e=>e.includes('integridade')));
  }finally{p.left.close();p.right.close();}
});
test('aparelho antigo nao recebe selo de integridade nem controle de pausa falso',async()=>{
  const p=pair();const send=p.left.channel.send.bind(p.left.channel);
  p.left.channel.send=value=>{if(typeof value==='string'){const msg=JSON.parse(value);if(msg.type==='offer'){delete msg.integrity;delete msg.pause;value=JSON.stringify(msg);}}send(value);};
  try{
    await p.left.send([new File(['compatível'],'arquivo.txt')]);await new Promise(r=>setTimeout(r,10));
    assert.equal(p.blobs[0].info.integrity,'unavailable');assert.equal(p.left.pauseSupported,false);assert.equal(p.right.pauseSupported,false);
  }finally{p.left.close();p.right.close();}
});
test('falha da miniatura em disco nao invalida arquivo verificado',async()=>{
  const p=pair(true,async()=>({async write(){},async close(){},async abort(){},async preview(){throw new Error('Formato sem prévia');}}));
  try{await p.left.send([new File(['imagem'],'foto.jpg',{type:'image/jpeg'})]);assert.equal(p.blobs[0].info.integrity,'verified');assert.equal(p.errors.length,0);}finally{p.left.close();p.right.close();}
});
test('previas limitam formatos e tamanho e nao tentam renderizar SVG ou HEIC',()=>{
  assert.equal(photo.canPreviewPhoto('image/jpeg',1024),true);assert.equal(photo.canPreviewPhoto('IMAGE/PNG',1024),true);
  for(const type of ['image/svg+xml','image/heic','text/html','application/octet-stream'])assert.equal(photo.canPreviewPhoto(type,1024),false);
  assert.equal(photo.canPreviewPhoto('image/png',photo.MAX_PHOTO_PREVIEW+1),false);assert.equal(photo.canPreviewPhoto('image/png',0),false);
});
test('transferência em blocos preserva bytes, arquivos vazios e confirmação',async()=>{
  const p=pair();const bytes=new Uint8Array(1024*1024+37);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  const files=[new File([bytes],'foto-teste.bin',{type:'application/octet-stream'}),new File([],'vazio.txt')];
  await p.left.send(files);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(p.blobs.length,2);
  assert.deepEqual(new Uint8Array(await p.blobs[0].blob.arrayBuffer()),bytes);
  assert.equal(p.blobs[1].blob.size,0);
  assert.ok(p.blobs.every(file=>file.info.integrity==='verified'));
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


test('ZIP local preserva nomes UTF-8, bytes, CRC e entradas vazias sem sobrescrever duplicados',async()=>{
  const {archiveFiles}=await import(source('lib/archive.ts'));
  const zip=Buffer.from(await (await archiveFiles([{name:'../foto ç.txt',blob:new Blob(['123456789'])},{name:'../foto ç.txt',blob:new Blob([])}])).arrayBuffer());
  assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(14),0xcbf43926);
  const nameLength=zip.readUInt16LE(26);assert.equal(zip.subarray(30,30+nameLength).toString(),'001-__foto ç.txt');
  assert.equal(zip.subarray(30+nameLength,39+nameLength).toString(),'123456789');
  const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50);assert.equal(zip.readUInt16LE(end+8),2);
  const central=zip.readUInt32LE(end+16);assert.equal(zip.readUInt32LE(central),0x02014b50);assert.equal(zip.readUInt32LE(central+16),0xcbf43926);
  assert.ok(zip.includes(Buffer.from('002-__foto ç.txt')));
  await assert.rejects(()=>archiveFiles([]),/200 MB/);
  await assert.rejects(()=>archiveFiles([{name:'grande',blob:{size:200*1024*1024+1}}]),/200 MB/);
});


test('varios lotes na mesma conexao exigem novo aceite e preservam arquivos anteriores',async()=>{
  const p=pair();let offers=0;
  p.right.hooks.offer=offer=>{if(offer){offers++;queueMicrotask(()=>p.right.accept(undefined,offer.id));}};
  const channel=p.left.channel;
  try{
    await p.left.send([new File(['primeiro'],'primeiro.txt')]);
    await p.left.send([new File(['segundo'],'segundo.txt')]);
    assert.equal(offers,2);assert.equal(p.left.channel,channel);
    assert.deepEqual(p.blobs.map(f=>f.info.name),['primeiro.txt','segundo.txt']);assert.equal(p.completions.length,4);assert.deepEqual(p.errors,[]);
  }finally{p.left.close();p.right.close();}
});


test('cancelar arquivo parcial pelo remetente ou receptor preserva os demais e aborta disco',async()=>{
  for(const side of ['left','right']){
    let aborted=0,closed=0,requested=false;const skipped=[];
    const p=pair(true,async()=>({async write(){},async close(){closed++;},async abort(){aborted++;}}));
    p.left.hooks.skipped=name=>skipped.push(name);p.right.hooks.skipped=name=>skipped.push(name);
    p.right.hooks.progress=(name,bytes)=>{if(name==='cancelar.bin'&&bytes>=65536&&!requested){requested=true;p[side].skipCurrentFile();}};
    try{
      await p.left.send([new File(['antes'],'antes.txt'),new File([Buffer.alloc(3*transfer.FLOW_WINDOW)],'cancelar.bin'),new File(['depois'],'depois.txt')]);
      assert.equal(aborted,1);assert.equal(closed,2);assert.deepEqual(p.blobs.map(f=>f.info.name),['antes.txt','depois.txt']);
      assert.deepEqual(skipped,['cancelar.bin','cancelar.bin']);assert.ok(p.completions.every(c=>c.count===2));assert.deepEqual(p.errors,[]);
    }finally{p.left.close();p.right.close();}
  }
});


test('cancelamento confirmado sobrevive a perda do ACK sem repetir nem entregar arquivo parcial',async()=>{
  const p=pair();let requested=false,dropped=false;
  p.right.hooks.progress=(name,bytes)=>{if(name==='pular.bin'&&bytes>=65536&&!requested){requested=true;p.left.skipCurrentFile();}};
  const send=p.right.channel.send.bind(p.right.channel);
  p.right.channel.send=value=>{if(typeof value==='string'&&JSON.parse(value).type==='skip-ack'&&!dropped){dropped=true;setTimeout(()=>reconnectTransport(p),0);return;}send(value);};
  try{
    await p.left.send([new File([Buffer.alloc(2*transfer.FLOW_WINDOW)],'pular.bin'),new File(['ok'],'manter.txt')]);
    assert.ok(dropped);assert.deepEqual(p.blobs.map(f=>f.info.name),['manter.txt']);assert.ok(p.completions.every(c=>c.count===1));assert.deepEqual(p.errors,[]);
  }finally{p.left.close();p.right.close();}
});

test('cancelar arquivo pausado libera somente esse arquivo e lote vazio termina com zero recebidos',async()=>{
  const p=pair();let requested=false;
  p.right.hooks.progress=(name,bytes)=>{if(bytes>=65536&&!requested){requested=true;p.left.setPaused(true);p.left.skipCurrentFile();setTimeout(()=>p.left.setPaused(false),10);}};
  try{await p.left.send([new File([Buffer.alloc(2*transfer.FLOW_WINDOW)],'unico.bin')]);assert.equal(p.blobs.length,0);assert.ok(p.completions.every(c=>c.count===0));assert.deepEqual(p.errors,[]);}finally{p.left.close();p.right.close();}
});

test('arquivo cancelado exige lote autorizado e navegador antigo nao exibe cancelamento individual',async()=>{
  const p=pair();p.right.hooks.offer=()=>{};
  try{
    await p.right.message(JSON.stringify({type:'offer',offer:{id:'lote',files:[{id:'a',name:'a',size:0,type:''}]},flowControl:1}));
    assert.equal(p.right.canSkipFile,false);
    await assert.rejects(()=>p.right.message(JSON.stringify({type:'file-skip',batch:'outro',id:'a'})),/inválido/);
    assert.equal(p.right.receiveIndex,0);
  }finally{p.left.close();p.right.close();}
});
