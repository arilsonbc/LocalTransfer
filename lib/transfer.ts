import {ProgressMeter,type TransferStats} from "./progress";
import {newSha256,digestHex,SendingIntegrity} from "./integrity";
export const MAX_BATCH = 100_000_000_000;
export const MAX_MEMORY = 200 * 1024 * 1024;
export const MAX_FILES = 500;
export const CHUNK_SIZE = 16 * 1024;
export const FLOW_WINDOW = 1024 * 1024;
export type ReceiveSink = {write:(chunk:ArrayBuffer)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>;preview?:()=>Promise<Blob|null>};
export type SinkFactory = (file:FileInfo,index:number)=>Promise<ReceiveSink>;
export type FileInfo = {id:string;name:string;size:number;type:string;integrity?:"verified"|"unavailable"};
export type Offer = {id:string;files:FileInfo[];selectable?:boolean};
type ResumePoint={index:number;offset:number;selected?:unknown};
export type Session = {code:string;token:string;role:"host"|"guest";expiresAt:number;peerName?:string};
export type ConnectionDiagnostics={version:string;mode:string;connection:string;ice:string;gathering:string;relayCandidates:number;serverErrors:number[]};
type Hooks = {
  pause?:(local:boolean,remote:boolean,supported:boolean)=>void;
  notice?:(message:string)=>void;
  integrity?:(id:string,verified:boolean)=>void;
  selection?:(count:number)=>void;
  state:(state:string,message:string)=>void;
  peer:(name:string)=>void;
  offer:(offer:Offer|null)=>void;
  progress:(name:string,current:number,total:number,direction:"send"|"receive",stats?:TransferStats)=>void;
  file:(file:FileInfo,blob:Blob|null,preview?:Blob|null)=>void;
  complete:(direction:"send"|"receive",count:number)=>void;
  error:(message:string)=>void;
};
export function validateOffer(value:unknown): value is Offer {
  const offer=value as Offer;
  return !!offer && typeof offer.id==="string" && offer.id.length<80 && Array.isArray(offer.files) && offer.files.length>0 && offer.files.length<=MAX_FILES && offer.files.every(f=>f && typeof f.id==="string" && f.id.length<80 && typeof f.name==="string" && f.name.length>0 && f.name.length<=512 && typeof f.type==="string" && f.type.length<=128 && Number.isSafeInteger(f.size) && f.size>=0 && f.size<=MAX_BATCH) && new Set(offer.files.map(f=>f.id)).size===offer.files.length && offer.files.reduce((n,f)=>n+f.size,0)<=MAX_BATCH;
}
export function safeFilename(name:string) {
  return name.replace(/[\\/\u0000-\u001f<>:"|?*]/g,"_").replace(/^\.+/,"_").slice(0,240)||"arquivo";
}
export async function api<T=Record<string,unknown>>(path:string,method="GET",data?:unknown,token?:string):Promise<T> {
  const res=await fetch(path,{method,cache:"no-store",signal:AbortSignal.timeout(15000),headers:{...(data?{"Content-Type":"application/json"}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
  const result=await res.json() as {error?:string};
  if(!res.ok) throw new Error(result.error||"Não foi possível comunicar com o serviço.");
  return result as T;
}
class TransportInterrupted extends Error {}
type PendingWait={resolve:(value?:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>|undefined;remaining:number;started:number;arm:()=>void};

export class TransferConnection {
  private pc!:RTCPeerConnection;
  private channel:RTCDataChannel|null=null;
  private stopped=false;
  private pollTimer:ReturnType<typeof setTimeout>|null=null;
  private connectTimer:ReturnType<typeof setTimeout>|null=null;
  private incoming:Offer|null=null;
  private incomingSelectable=false;
  private incomingSelected:string[]|null=null;
  private outgoingSelected:string[]|null=null;
  private accepted=false;
  private receiving:{info:FileInfo;chunks:ArrayBuffer[];bytes:number;sink:ReceiveSink|null;hash:ReturnType<typeof newSha256>}|null=null;
  private sinkFactory:SinkFactory|null=null;
  private transferEpoch=0;
  private peerFlow=false;
  private incomingFlow=false;
  private incomingResume=false;
  private peerResume=false;
  private incomingIntegrity=false;
  private peerIntegrity=false;
  private sendingHash:{index:number;hash:SendingIntegrity}|null=null;
  private localPaused=false;
  private remotePaused=false;
  private peerPause=false;
  private incomingPause=false;
  private completedOffer:Offer|null=null;
  private completedAt=0;
  private receiveIndex=0;
  private outgoing=false;
  private cancelled=false;
  private pending=new Map<string,PendingWait>();
  private queue=Promise.resolve();
  private queuedBytes=0;
  private lastProgressAt=0;
  private latestProgress:{name:string;current:number;total:number;direction:"send"|"receive"}|null=null;
  private requiresRelay=false;
  private serverErrors:number[]=[];
  private failureDiagnostics:ConnectionDiagnostics|null=null;
  private meter=new ProgressMeter();
  private outgoingOffer:Offer|null=null;
  private sendIndex=0;
  private iceServers:RTCIceServer[]=[];
  private revision=0;
  private transportGeneration=0;
  private lastRemote="";
  private negotiating=false;
  private polling=false;
  private recovering=false;
  private completed=false;
  private retries=0;
  private retryTimer:ReturnType<typeof setTimeout>|null=null;
  private disconnectTimer:ReturnType<typeof setTimeout>|null=null;
  constructor(private session:Session,private hooks:Hooks,private relayOnly=false) {}
  private createPeer(iceServers:RTCIceServer[]) {
    const generation=++this.transportGeneration;
    const oldChannel=this.channel;this.channel=null;
    oldChannel?.close();this.pc?.close();
    this.requiresRelay=iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)));
    this.pc=new RTCPeerConnection({iceServers,...(this.relayOnly?{iceTransportPolicy:"relay" as const}:{})});
    this.pc.onicecandidateerror=event=>{if(!this.serverErrors.includes(event.errorCode))this.serverErrors.push(event.errorCode);};
    this.pc.ondatachannel=e=>{if(generation===this.transportGeneration)this.bind(e.channel);};
    this.pc.onconnectionstatechange=()=>{
      if(this.stopped || generation!==this.transportGeneration || this.completed) return;
      if(this.pc.connectionState==="failed")this.retry();
      if(this.pc.connectionState==="disconnected"){
        this.hooks.state("reconnecting","A internet oscilou. Mantenha as páginas abertas; vamos reconectar.");
        if(!this.disconnectTimer)this.disconnectTimer=setTimeout(()=>{this.disconnectTimer=null;this.retry();},4000);
      }
      if(this.pc.connectionState==="connected" && this.channel?.readyState==="open"){
        if(this.disconnectTimer)clearTimeout(this.disconnectTimer);this.disconnectTimer=null;
        this.hooks.state("connected","Aparelhos conectados");
      }
    };
  }
  get busy() {return this.outgoing || !!this.incoming;}
  private receivedFiles(){return this.incoming?.files.filter(f=>!this.incomingSelected||this.incomingSelected.includes(f.id))||[];}
  private showOffer(){if(this.incoming)this.hooks.offer({...this.incoming,selectable:this.incomingSelectable});}
  get paused(){return this.localPaused||this.remotePaused;}
  get pauseSupported(){return this.outgoing?this.peerPause:this.incomingPause&&this.accepted;}
  private updatePause(local=this.localPaused,remote=this.remotePaused){
    const was=this.paused;this.localPaused=local;this.remotePaused=remote;
    if(was!==this.paused){
      this.meter.reset();
      for(const p of this.pending.values()){
        if(this.paused && p.timer!==undefined){clearTimeout(p.timer);p.timer=undefined;p.remaining=Math.max(1,p.remaining-(Date.now()-p.started));}
        else if(!this.paused && p.timer===undefined)p.arm();
      }
      if(!this.paused)this.resolve("unpaused");
      if(this.latestProgress){const p=this.latestProgress;this.lastProgressAt=0;this.progress(p.name,p.current,p.total,p.direction);}
    }
    this.hooks.pause?.(this.localPaused,this.remotePaused,this.pauseSupported);
  }
  setPaused(value:boolean){
    if(!this.busy||!this.pauseSupported||this.stopped)return;
    this.updatePause(value);
    if(!this.recovering&&this.channel?.readyState==="open")this.control({type:"pause",id:(this.outgoingOffer||this.incoming)?.id,paused:value});
  }
  private async waitIfPaused(){
    if(this.paused)await this.wait("unpaused",172800000);
    if(this.stopped||this.cancelled)throw new Error("Transferência cancelada.");
  }
  get reconnecting(){return this.recovering || (!this.completed && ["failed","disconnected"].includes(this.pc?.connectionState));}
  get diagnostics():ConnectionDiagnostics {
    return this.failureDiagnostics||{version:"recovery-v3",mode:this.relayOnly?"relay":"auto",connection:this.pc?.connectionState||"new",ice:this.pc?.iceConnectionState||"new",gathering:this.pc?.iceGatheringState||"new",relayCandidates:(this.pc?.localDescription?.sdp.match(/ typ relay(?: |\r?$)/gm)||[]).length,serverErrors:[...this.serverErrors]};
  }
  private progress(name:string,current:number,total:number,direction:"send"|"receive") {
    this.latestProgress={name,current,total,direction};
    const now=Date.now();
    if(current===0 || current===total || now-this.lastProgressAt>=100){
      this.lastProgressAt=now;
      const batch=direction==="receive"&&this.incoming?{...this.incoming,files:this.receivedFiles()}:this.outgoingOffer;
      const index=direction==="receive"?this.receiveIndex:this.sendIndex;
      const batchTotal=batch?.files.reduce((n,file)=>n+file.size,0)||total;
      const completed=batch?.files.slice(0,index).reduce((n,file)=>n+file.size,0)||0;
      this.hooks.progress(name,current,total,direction,this.meter.sample(completed+current,batchTotal,index+1,batch?.files.length||1));
    }
  }
  async start() {
    try {
      this.hooks.state("connecting","Preparando conexão segura…");
      const config=await api<{iceServers:RTCIceServer[];turn?:{status:string;notice:string}}>(`/api/rooms/${this.session.code}/ice`,"POST",{},this.session.token);
      this.hooks.notice?.(config.turn?.notice||"");
      if(this.relayOnly&&!config.iceServers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>/^turns?:/.test(u))))
        throw new Error(config.turn?.notice||"A retransmissão está indisponível. Tente uma conexão direta na mesma rede Wi-Fi.");
      if(this.stopped) return;
      this.iceServers=config.iceServers;
      if(this.session.role==="host") {
        await this.hostOffer();
        this.hooks.state("waiting","Sala pronta. Conecte o outro aparelho.");
      } else {this.createPeer(this.iceServers);this.hooks.state("connecting","Estabelecendo conexão segura…");}
      void this.poll();
    } catch(e) {if(!this.stopped) this.fail(e instanceof Error?e.message:"Não foi possível conectar.");}
  }
  private deadline(){
    if(!this.connectTimer)this.connectTimer=setTimeout(()=>this.fail("Não conseguimos recuperar a conexão em dois minutos. Crie outra sala e mantenha os aparelhos ativos."),120000);
  }
  private pauseTransport(){
    this.recovering=true;this.meter.reset();this.deadline();
    this.rejectAll(new TransportInterrupted("Reconectando…"));
    this.hooks.state("reconnecting","Reconectando automaticamente. Os dados já recebidos serão preservados enquanto as páginas estiverem abertas.");
  }
  retry(){
    if(this.stopped || this.completed || this.negotiating || this.retryTimer)return;
    if(this.completedOffer && !this.incoming && !this.outgoing)return;
    if(this.retries>=5){this.fail("Não foi possível recuperar a conexão. Confira a internet nos dois aparelhos e crie outra sala.");return;}
    this.retries++;this.pauseTransport();
    this.retryTimer=setTimeout(()=>{
      this.retryTimer=null;
      if(this.stopped)return;
      if(this.session.role==="host")void this.hostOffer(true).catch(()=>this.retry());
      else if(this.revision)void api(`/api/rooms/${this.session.code}`,"POST",{description:JSON.stringify({type:"restart",revision:this.revision})},this.session.token).catch(()=>this.retry());
      void this.poll();
    },[1000,5000,15000,30000,45000][this.retries-1]);
  }
  private async hostOffer(relay=this.relayOnly){
    if(this.negotiating || this.stopped)return;
    this.negotiating=true;this.relayOnly=relay;this.revision++;
    try{
      this.createPeer(this.iceServers);
      const generation=this.transportGeneration;
      this.bind(this.pc.createDataChannel("localtransfer-files",{ordered:true}));
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this.gather();
      if(this.stopped || generation!==this.transportGeneration)return;
      await this.signal();
    }finally{this.negotiating=false;}
  }
  private async gather() {
    const relayReady=()=>!!this.pc.localDescription?.sdp.includes(" typ relay");
    const ready=()=>this.pc.iceGatheringState==="complete" || (this.requiresRelay && relayReady());
    if(!ready()) {
    await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);this.pc.removeEventListener("icegatheringstatechange",changed);this.pc.removeEventListener("icecandidate",changed);resolve();};
      const changed=()=>{if(ready() || this.stopped)done();};
      const timer=setTimeout(done,45000);
      this.pc.addEventListener("icegatheringstatechange",changed);
      this.pc.addEventListener("icecandidate",changed);
      changed();
    });
    }
    if(!this.stopped && this.requiresRelay && this.relayOnly && !relayReady())throw new Error("Não foi possível acessar o servidor de conexão segura. Copie o diagnóstico abaixo para verificarmos esta rede. Código: TURN-SEM-ROTA.");
  }
  private signal() {
    return api(`/api/rooms/${this.session.code}`,"POST",{description:JSON.stringify({type:this.pc.localDescription?.type,sdp:this.pc.localDescription?.sdp,revision:this.revision,relay:this.relayOnly})},this.session.token);
  }
  private async poll() {
    if(this.stopped || this.completed || this.polling)return;
    if(this.completedAt && Date.now()-this.completedAt>120000 && !this.incoming && !this.outgoing){this.completed=true;return;}
    this.polling=true;
    let negotiatingHere=false;
    try {
      const state=await api<{peerName:string|null;joined:boolean;description:string|null}>(`/api/rooms/${this.session.code}`,"GET",undefined,this.session.token);
      if(this.stopped) return;
      if(state.peerName) this.hooks.peer(state.peerName);
      if(state.joined && this.channel?.readyState!=="open")this.deadline();
      if(state.description && !this.negotiating) {
        const description=JSON.parse(state.description);
        const revision=description.revision||0;
        if(this.session.role==="host" && description.type==="restart" && revision===this.revision){this.retry();return;}
        const matchingAnswer=revision===this.revision || (revision===0 && this.revision===1 && !this.recovering);
        if(this.session.role==="host" && (description.type!=="answer" || !matchingAnswer || this.pc.remoteDescription))return;
        if(this.session.role==="guest" && (description.type!=="offer" || revision<this.revision || state.description===this.lastRemote))return;
        this.lastRemote=state.description;
        this.negotiating=true;negotiatingHere=true;
        if(this.session.role==="guest"){
          if(this.channel)this.pauseTransport();
          this.revision=revision;this.relayOnly=this.relayOnly||description.relay===true;
          this.createPeer(this.iceServers);
        }
        this.hooks.state("connecting","Estabelecendo conexão segura…");
        await this.pc.setRemoteDescription({type:description.type,sdp:description.sdp});
        if(this.session.role==="guest") {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          await this.gather();
          if(this.stopped)return;
          await this.signal();
        }
      }
    } catch(e) {
      if(!this.stopped && this.channel?.readyState!=="open" && (!this.negotiating || negotiatingHere)){this.negotiating=false;this.retry();}
    } finally {
      if(negotiatingHere)this.negotiating=false;this.polling=false;
      if(!this.stopped && !this.completed){
        if(this.pollTimer)clearTimeout(this.pollTimer);
        this.pollTimer=setTimeout(()=>void this.poll(),this.channel?.readyState==="open"?5000:1500);
      }
    }
  }
  private bind(channel:RTCDataChannel) {
    this.channel=channel;
    channel.binaryType="arraybuffer";
    channel.bufferedAmountLowThreshold=65536;
    channel.onopen=()=>{
      void this.queue.then(()=>{
        if(this.stopped || this.channel!==channel)return;
        if(this.connectTimer)clearTimeout(this.connectTimer);this.connectTimer=null;
        if(this.retryTimer)clearTimeout(this.retryTimer);this.retryTimer=null;
        this.recovering=false;this.retries=0;this.resolve("ready");
        this.hooks.state("connected","Aparelhos conectados");
      });
    };
    channel.onclose=()=>{if(!this.stopped && this.channel===channel && !this.completed)this.retry();};
    channel.onerror=()=>{if(!this.stopped && this.channel===channel && !this.completed)this.retry();};
    channel.onmessage=event=>{
      if(this.stopped || this.channel!==channel)return;
      const bytes=typeof event.data==="string"?event.data.length*2:event.data instanceof Blob?event.data.size:event.data.byteLength;
      this.queuedBytes+=bytes;
      if(this.queuedBytes>4*FLOW_WINDOW){this.fail("O envio excedeu a velocidade de gravação. Tente novamente.");return;}
      this.queue=this.queue.then(()=>{if(!this.stopped && this.channel===channel)return this.message(event.data);}).catch(e=>{if(e instanceof TransportInterrupted)return;this.cancel();this.hooks.error(e instanceof Error?e.message:"Dados inválidos recebidos.");}).finally(()=>{this.queuedBytes-=bytes;});
    };
  }
  private control(value:unknown) {
    if(this.stopped)throw new Error("Transferência encerrada.");
    if(this.recovering || this.channel?.readyState!=="open") throw new TransportInterrupted("Reconectando…");
    this.channel.send(JSON.stringify(value));
  }
  private wait<T=void>(key:string,timeout=120000) {
    const promise=new Promise<T>((resolve,reject)=>{
      const pending:PendingWait={resolve:value=>resolve(value as T),reject,timer:undefined,remaining:timeout,started:Date.now(),arm:()=>{
        pending.started=Date.now();pending.timer=setTimeout(()=>{this.pending.delete(key);reject(new Error("O outro aparelho não respondeu. Tente novamente."));},pending.remaining);
      }};
      this.pending.set(key,pending);if(!this.paused)pending.arm();
    });
    // A transport can close between registering a response and sending its request.
    void promise.catch(()=>{});
    return promise;
  }
  private resolve(key:string,value?:unknown) {const p=this.pending.get(key);if(p){clearTimeout(p.timer);p.resolve(value);this.pending.delete(key);}}
  private rejectAll(message:string|Error) {for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(typeof message==="string"?new Error(message):message);}this.pending.clear();}
  private async message(data:string|ArrayBuffer|Blob) {
    if(typeof data!=="string") {
      const r=this.receiving;
      if(!r || !this.accepted)throw new Error("Arquivo recebido sem autorização.");
      const chunk=data instanceof Blob?await data.arrayBuffer():data;
      if(chunk.byteLength>CHUNK_SIZE || r.bytes+chunk.byteLength>r.info.size)throw new Error("Tamanho de arquivo inválido.");
      if(r.sink)await r.sink.write(chunk);else r.chunks.push(chunk);
      if(this.receiving!==r)return;
      r.hash.update(new Uint8Array(chunk));
      r.bytes+=chunk.byteLength;
      this.progress(r.info.name,r.bytes,r.info.size,"receive");
      if(this.incomingFlow && (r.bytes%FLOW_WINDOW===0 || r.bytes===r.info.size))this.control({type:"flow",id:r.info.id,bytes:r.bytes});
      return;
    }
    if(data.length>350000)throw new Error("Solicitação muito grande.");
    const msg=JSON.parse(data);
    switch(msg.type) {
      case "offer": {
        if(!validateOffer(msg.offer)){this.control({type:"reject",reason:"Lote inválido ou maior que 100 GB."});return;}
        if(this.completedOffer?.id===msg.offer.id && JSON.stringify(this.completedOffer)===JSON.stringify(msg.offer)){
          this.control({type:"accept",flowControl:1,resume:1,selected:this.incomingSelectable?this.incomingSelected:undefined,pause:this.incomingPause?1:0,paused:this.localPaused,integrity:this.incomingIntegrity?"sha256":undefined,index:this.incomingSelected?.length??msg.offer.files.length,offset:0});return;
        }
        if(this.incoming?.id===msg.offer.id && JSON.stringify(this.incoming)===JSON.stringify(msg.offer)){
          if(this.incomingPause)this.updatePause(undefined,msg.paused===true);
          if(this.accepted)this.sendAcceptance();else this.showOffer();
          return;
        }
        if(this.busy){this.control({type:"reject",reason:"O aparelho está ocupado."});return;}
        this.incoming=msg.offer;this.incomingFlow=msg.flowControl===1;this.incomingResume=msg.resume===1 && this.incomingFlow;this.incomingIntegrity=msg.integrity==="sha256";this.accepted=false;this.receiveIndex=0;this.meter.reset();this.completed=false;
        this.incomingPause=msg.pause===1;this.updatePause(false,false);
        this.incomingSelectable=msg.selection===1;this.incomingSelected=null;this.showOffer();return;
      }
      case "accept": this.peerFlow=msg.flowControl===1;this.peerResume=msg.resume===1;this.peerIntegrity=msg.integrity==="sha256";this.peerPause=msg.pause===1;this.updatePause(undefined,this.peerPause&&msg.paused===true);this.resolve("accept",{...(this.peerResume?{index:msg.index,offset:msg.offset}:{index:0,offset:0}),selected:msg.selected});return;
      case "pause": if(this.busy&&this.pauseSupported&&msg.id===(this.outgoingOffer||this.incoming)?.id&&typeof msg.paused==="boolean")this.updatePause(undefined,msg.paused);return;
      case "reject": this.rejectAll(typeof msg.reason==="string"?msg.reason:"O recebimento foi recusado.");return;
      case "file": {
        const info=this.receivedFiles()[this.receiveIndex];
        if(!this.accepted || !info || msg.id!==info.id)throw new Error("Sequência de arquivos inválida.");
        const offset=msg.offset??0;
        if(this.receiving && this.incomingResume && this.receiving.info.id===info.id && offset===this.receiving.bytes){this.progress(info.name,offset,info.size,"receive");return;}
        if(this.receiving || offset!==0)throw new Error("Ponto de retomada inválido.");
        const epoch=this.transferEpoch;
        const sink=this.sinkFactory?await this.sinkFactory(info,this.receiveIndex):null;
        if(this.stopped || epoch!==this.transferEpoch){await sink?.abort().catch(()=>{});return;}
        this.receiving={info,chunks:[],bytes:0,sink,hash:newSha256()};this.progress(info.name,0,info.size,"receive");return;
      }
      case "file-end": {
        const r=this.receiving;
        if(!r || msg.id!==r.info.id || r.bytes!==r.info.size)throw new Error("Arquivo incompleto. Envie novamente.");
        if(this.incomingIntegrity && (typeof msg.sha256!=="string" || !/^[a-f0-9]{64}$/.test(msg.sha256) || digestHex(r.hash)!==msg.sha256))
          throw new Error("A verificação de integridade falhou. O arquivo não foi concluído; envie-o novamente.");
        if(r.sink)await r.sink.close();
        if(this.receiving!==r)return;
        // A failed preview must never turn a successfully verified file into a failed transfer.
        const preview=r.sink?.preview?await r.sink.preview().catch(()=>null):null;
        if(this.receiving!==r)return;
        this.hooks.file({...r.info,integrity:this.incomingIntegrity?"verified":"unavailable"},r.sink?null:new Blob(r.chunks,{type:r.info.type||"application/octet-stream"}),preview);
        this.receiving=null;this.receiveIndex++;this.control({type:"ack",id:msg.id,integrity:this.incomingIntegrity?"sha256":undefined});return;
      }
      case "ack": this.resolve(`ack:${msg.id}`,msg.integrity==="sha256");return;
      case "flow": if(typeof msg.id==="string" && Number.isSafeInteger(msg.bytes))this.resolve(`flow:${msg.id}:${msg.bytes}`);return;
      case "done-ack": if(this.outgoingOffer?.id===msg.id)this.resolve("done");return;
      case "done-confirm": if(this.completedOffer?.id===msg.id)this.completed=true;return;
      case "done": {
        if(this.completedOffer?.id===msg.id){this.control({type:"done-ack",id:msg.id});return;}
        if(!this.incoming || !this.accepted || this.receiving || this.receiveIndex!==this.receivedFiles().length)throw new Error("Transferência incompleta.");
        const count=this.receivedFiles().length;
        const acknowledge=this.incomingResume;
        const completedId=this.incoming.id;
        if(acknowledge){
          if(msg.id!==this.incoming.id)throw new Error("Confirmação de lote inválida.");
          this.completedOffer=this.incoming;this.completedAt=Date.now();
        }else this.completed=true;
        this.incoming=null;this.accepted=false;this.sinkFactory=null;this.updatePause(false,false);this.hooks.offer(null);this.hooks.complete("receive",count);
        if(acknowledge)this.control({type:"done-ack",id:completedId});
        return;
      }
      case "cancel": this.resetTransfer();this.hooks.error("Transferência cancelada pelo outro aparelho.");return;
    }
  }
  accept(sinkFactory?:SinkFactory,offerId?:string,selectedIds?:string[]) {
    if(!this.incoming || this.accepted || (offerId && this.incoming.id!==offerId))return;
    const ids=selectedIds??this.incoming.files.map(f=>f.id);
    if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!this.incoming!.files.some(f=>f.id===id))){this.hooks.error("Escolha pelo menos um arquivo válido para receber.");return;}
    if(!this.incomingSelectable&&ids.length!==this.incoming.files.length){this.hooks.error("Atualize o site no aparelho que envia para escolher apenas alguns arquivos.");return;}
    this.incomingSelected=this.incoming.files.filter(f=>ids.includes(f.id)).map(f=>f.id);
    const total=this.receivedFiles().reduce((n,file)=>n+file.size,0);
    if(total>MAX_MEMORY && (!sinkFactory || !this.incomingFlow)){
      const message=!sinkFactory?"Para receber mais de 200 MB, escolha uma pasta usando Chrome ou Edge no computador.":"Atualize o site no aparelho que envia para transferir arquivos grandes.";
      this.reject();this.hooks.error(message);return;
    }
    this.sinkFactory=sinkFactory||null;
    this.accepted=true;this.updatePause(false,false);this.hooks.offer(null);this.sendAcceptance();
  }
  private sendAcceptance(){this.control({type:"accept",selected:this.incomingSelectable?this.incomingSelected:undefined,flowControl:this.incomingFlow?1:0,resume:this.incomingResume?1:0,pause:this.incomingPause?1:0,paused:this.localPaused,integrity:this.incomingIntegrity?"sha256":undefined,index:this.receiveIndex,offset:this.receiving?.bytes||0});}
  reject() {
    this.incoming=null;this.accepted=false;this.hooks.offer(null);this.control({type:"reject",reason:"O recebimento foi recusado."});
  }
  private async drain() {
    const c=this.channel;
    if(this.stopped || this.cancelled)throw new Error("Transferência interrompida.");
    if(!c || this.recovering || c.readyState!=="open")throw new TransportInterrupted("Reconectando…");
    if(c.bufferedAmount<=262144)return;
    await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);c.removeEventListener("bufferedamountlow",low);c.removeEventListener("close",closed);};
      const low=()=>{cleanup();resolve();};const closed=()=>{cleanup();reject(new TransportInterrupted("Reconectando…"));};
      const timer=setTimeout(()=>{cleanup();reject(new Error("O envio demorou demais. Tente novamente."));},30000);
      c.addEventListener("bufferedamountlow",low,{once:true});c.addEventListener("close",closed,{once:true});
      if(c.bufferedAmount<=65536)low();
    });
  }
  async send(files:File[]) {
    if(this.busy)throw new Error("Aguarde a transferência atual terminar.");
    const offer:Offer={id:crypto.randomUUID(),files:files.map(f=>({id:crypto.randomUUID(),name:f.name,size:f.size,type:f.type||"application/octet-stream"}))};
    if(!validateOffer(offer))throw new Error("Selecione até 500 arquivos e 100 GB por lote.");
    this.outgoing=true;this.cancelled=false;this.completed=false;this.peerFlow=false;this.outgoingOffer=offer;this.meter.reset();
    this.outgoingSelected=null;
    this.peerPause=false;this.updatePause(false,false);
    try {
      for(let attempt=0;;attempt++){
        try{await this.sendAttempt(files,offer);break;}
        catch(error){
          if(!(error instanceof TransportInterrupted) || this.stopped || this.cancelled || attempt>=5)throw error;
          if(!this.recovering)this.retry();
          await this.waitForChannel();
        }
      }
      this.completed=true;this.hooks.complete("send",this.outgoingSelected?.length??files.length);
    } catch(e) {
      if(!this.stopped && !this.recovering && this.channel?.readyState==="open")this.control({type:"cancel"});
      throw e;
    } finally {this.outgoing=false;this.outgoingOffer=null;this.sendingHash=null;this.updatePause(false,false);}
  }
  private async waitForChannel(){
    while(true){
      if(this.stopped || this.cancelled)throw new Error("Transferência encerrada.");
      if(this.channel?.readyState==="open" && !this.recovering)return;
      try{await this.wait("ready",120000);}catch(error){if(!(error instanceof TransportInterrupted))throw error;}
    }
  }
  private checkTransport(generation:number){
    if(this.stopped || this.cancelled)throw new Error("Transferência cancelada.");
    if(generation!==this.transportGeneration || this.recovering || this.channel?.readyState!=="open")throw new TransportInterrupted("Reconectando…");
  }
  private async sendAttempt(sourceFiles:File[],offer:Offer){
      await this.waitForChannel();
      const generation=this.transportGeneration;
      const accept=this.wait<ResumePoint>("accept",600000);
      this.control({type:"offer",offer,selection:1,flowControl:1,resume:1,pause:1,paused:this.localPaused,integrity:"sha256"});
      const point=await accept;
      this.checkTransport(generation);
      const requested=point?.selected===undefined?offer.files.map(f=>f.id):point.selected;
      if(!Array.isArray(requested)||!requested.length||requested.length>offer.files.length||requested.some(id=>typeof id!=="string"||!offer.files.some(f=>f.id===id))||new Set(requested).size!==requested.length)throw new Error("Seleção de arquivos inválida recebida.");
      const chosen=offer.files.filter(f=>requested.includes(f.id));
      const selected=chosen.map(f=>f.id);
      if(this.outgoingSelected&&JSON.stringify(this.outgoingSelected)!==JSON.stringify(selected))throw new Error("A seleção mudou durante a retomada. Crie outra sala.");
      this.outgoingSelected=selected;this.outgoingOffer={...offer,files:chosen};this.hooks.selection?.(chosen.length);
      const files=chosen.map(f=>sourceFiles[offer.files.findIndex(original=>original.id===f.id)]);
      if(!point || !Number.isSafeInteger(point.index) || point.index<0 || point.index>files.length || !Number.isSafeInteger(point.offset) || point.offset<0 || point.offset>(files[point.index]?.size||0))throw new Error("O outro aparelho informou um ponto de retomada inválido.");
      for(const info of chosen.slice(0,point.index))this.hooks.integrity?.(info.id,this.peerIntegrity);
      for(let i=point.index;i<files.length;i++) {
        this.sendIndex=i;
        const file=files[i],info=chosen[i];
        this.checkTransport(generation);
        const start=i===point.index?point.offset:0;
        if(this.sendingHash?.index!==i)this.sendingHash={index:i,hash:new SendingIntegrity()};
        const hash=this.sendingHash.hash;
        if(this.peerIntegrity)await hash.seek(file,start,async()=>{await this.waitIfPaused();this.checkTransport(generation);});
        await this.waitIfPaused();this.checkTransport(generation);
        this.control({type:"file",id:info.id,offset:start});
        this.progress(file.name,start,file.size,"send");
        for(let offset=start;offset<file.size;offset+=CHUNK_SIZE) {
          await this.waitIfPaused();this.checkTransport(generation);
          const chunk=await file.slice(offset,offset+CHUNK_SIZE).arrayBuffer();
          await this.drain();
          await this.waitIfPaused();
          this.checkTransport(generation);
          if(this.peerIntegrity)hash.update(chunk);
          const current=Math.min(offset+chunk.byteLength,file.size);
          const confirmation=this.peerFlow && (current%FLOW_WINDOW===0 || current===file.size)?this.wait(`flow:${info.id}:${current}`,120000):null;
          this.channel!.send(chunk);
          if(confirmation)await confirmation;
          this.progress(file.name,current,file.size,"send");
        }
        await this.waitIfPaused();this.checkTransport(generation);
        const ack=this.wait<boolean>(`ack:${info.id}`,60000);this.control({type:"file-end",id:info.id,sha256:this.peerIntegrity?hash.digest():undefined});
        const verified=await ack;
        if(this.peerIntegrity&&!verified)throw new Error("O outro aparelho não confirmou a integridade do arquivo. Atualize as duas páginas e tente novamente.");
        this.hooks.integrity?.(info.id,this.peerIntegrity&&verified);
      }
      await this.waitIfPaused();this.checkTransport(generation);
      const done=this.peerResume?this.wait("done",60000):null;
      this.control({type:"done",id:offer.id});
      if(done){await done;this.checkTransport(generation);this.control({type:"done-confirm",id:offer.id});}
  }
  private resetTransfer() {
    this.latestProgress=null;
    this.updatePause(false,false);
    this.transferEpoch++;
    this.cancelled=true;void this.receiving?.sink?.abort().catch(()=>{});this.receiving=null;this.incoming=null;this.accepted=false;this.sinkFactory=null;this.hooks.offer(null);this.rejectAll("Transferência cancelada.");
  }
  cancel() {if(!this.recovering && this.channel?.readyState==="open")this.control({type:"cancel"});this.resetTransfer();}
  private fail(message:string) {if(this.stopped)return;this.failureDiagnostics=this.diagnostics;this.close();this.hooks.state("error",message);this.hooks.error(message);}
  close() {
    this.stopped=true;
    if(this.retryTimer)clearTimeout(this.retryTimer);
    if(this.disconnectTimer)clearTimeout(this.disconnectTimer);
    if(this.pollTimer)clearTimeout(this.pollTimer);
    if(this.connectTimer)clearTimeout(this.connectTimer);
    this.resetTransfer();this.channel?.close();this.pc?.close();
  }
}
