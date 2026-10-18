export const MAX_BATCH = 100_000_000_000;
export const MAX_MEMORY = 200 * 1024 * 1024;
export const MAX_FILES = 500;
export const CHUNK_SIZE = 16 * 1024;
export const FLOW_WINDOW = 1024 * 1024;
export type ReceiveSink = {write:(chunk:ArrayBuffer)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>};
export type SinkFactory = (file:FileInfo,index:number)=>Promise<ReceiveSink>;
export type FileInfo = {id:string;name:string;size:number;type:string};
export type Offer = {id:string;files:FileInfo[]};
export type Session = {code:string;token:string;role:"host"|"guest";expiresAt:number;peerName?:string};
export type ConnectionDiagnostics={version:string;mode:string;connection:string;ice:string;gathering:string;relayCandidates:number;serverErrors:number[]};
type Hooks = {
  state:(state:string,message:string)=>void;
  peer:(name:string)=>void;
  offer:(offer:Offer|null)=>void;
  progress:(name:string,current:number,total:number,direction:"send"|"receive")=>void;
  file:(file:FileInfo,blob:Blob|null)=>void;
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
  const res=await fetch(path,{method,cache:"no-store",headers:{...(data?{"Content-Type":"application/json"}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
  const result=await res.json() as {error?:string};
  if(!res.ok) throw new Error(result.error||"Não foi possível comunicar com o serviço.");
  return result as T;
}

export class TransferConnection {
  private pc!:RTCPeerConnection;
  private channel:RTCDataChannel|null=null;
  private stopped=false;
  private pollTimer:ReturnType<typeof setTimeout>|null=null;
  private connectTimer:ReturnType<typeof setTimeout>|null=null;
  private incoming:Offer|null=null;
  private accepted=false;
  private receiving:{info:FileInfo;chunks:ArrayBuffer[];bytes:number;sink:ReceiveSink|null}|null=null;
  private sinkFactory:SinkFactory|null=null;
  private transferEpoch=0;
  private peerFlow=false;
  private incomingFlow=false;
  private receiveIndex=0;
  private outgoing=false;
  private cancelled=false;
  private pending=new Map<string,{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private queue=Promise.resolve();
  private queuedBytes=0;
  private lastProgressAt=0;
  private requiresRelay=false;
  private serverErrors:number[]=[];
  private failureDiagnostics:ConnectionDiagnostics|null=null;
  constructor(private session:Session,private hooks:Hooks,private relayOnly=false) {}
  private createPeer(iceServers:RTCIceServer[]) {
    this.requiresRelay=iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)));
    this.pc=new RTCPeerConnection({iceServers,...(this.relayOnly?{iceTransportPolicy:"relay" as const}:{})});
    this.pc.onicecandidateerror=event=>{if(!this.serverErrors.includes(event.errorCode))this.serverErrors.push(event.errorCode);};
    this.pc.ondatachannel=e=>this.bind(e.channel);
    this.pc.onconnectionstatechange=()=>{
      if(this.stopped) return;
      if(this.pc.connectionState==="failed") this.fail("A conexão entre os aparelhos falhou. Crie outra sala e mantenha as duas páginas abertas. Se continuar, copie o diagnóstico abaixo.");
      if(this.pc.connectionState==="disconnected") this.hooks.state("reconnecting","Conexão interrompida. Tentando reconectar…");
      if(this.pc.connectionState==="connected" && this.channel?.readyState==="open") this.hooks.state("connected","Aparelhos conectados");
    };
  }
  get busy() {return this.outgoing || !!this.incoming;}
  get diagnostics():ConnectionDiagnostics {
    return this.failureDiagnostics||{version:"turn-tls443-v2",mode:this.relayOnly?"relay":"auto",connection:this.pc?.connectionState||"new",ice:this.pc?.iceConnectionState||"new",gathering:this.pc?.iceGatheringState||"new",relayCandidates:(this.pc?.localDescription?.sdp.match(/ typ relay(?: |\r?$)/gm)||[]).length,serverErrors:[...this.serverErrors]};
  }
  private progress(name:string,current:number,total:number,direction:"send"|"receive") {
    const now=Date.now();
    if(current===0 || current===total || now-this.lastProgressAt>=100){this.lastProgressAt=now;this.hooks.progress(name,current,total,direction);}
  }
  async start() {
    try {
      this.hooks.state("connecting","Preparando conexão segura…");
      const config=await api<{iceServers:RTCIceServer[]}>(`/api/rooms/${this.session.code}/ice`,"POST",{},this.session.token);
      if(this.stopped) return;
      this.createPeer(config.iceServers);
      if(this.session.role==="host") {
        this.bind(this.pc.createDataChannel("localtransfer-files",{ordered:true}));
        await this.pc.setLocalDescription(await this.pc.createOffer());
        await this.gather();
        if(this.stopped) return;
        await this.signal();
        this.hooks.state("waiting","Sala pronta. Conecte o outro aparelho.");
      } else this.hooks.state("connecting","Estabelecendo conexão segura…");
      void this.poll();
    } catch(e) {if(!this.stopped) this.fail(e instanceof Error?e.message:"Não foi possível conectar.");}
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
    if(!this.stopped && this.requiresRelay && !relayReady())throw new Error("Não foi possível acessar o servidor de conexão segura. Copie o diagnóstico abaixo para verificarmos esta rede. Código: TURN-SEM-ROTA.");
  }
  private signal() {
    return api(`/api/rooms/${this.session.code}`,"POST",{description:JSON.stringify(this.pc.localDescription)},this.session.token);
  }
  private async poll() {
    if(this.stopped || this.channel?.readyState==="open") return;
    try {
      const state=await api<{peerName:string|null;joined:boolean;description:string|null}>(`/api/rooms/${this.session.code}`,"GET",undefined,this.session.token);
      if(this.stopped) return;
      if(state.peerName) this.hooks.peer(state.peerName);
      if(state.joined && !this.connectTimer) this.connectTimer=setTimeout(()=>this.fail("A conexão demorou demais. Crie outra sala. Se continuar, copie o diagnóstico abaixo."),120000);
      if(state.description && !this.pc.remoteDescription) {
        this.hooks.state("connecting","Estabelecendo conexão segura…");
        await this.pc.setRemoteDescription(JSON.parse(state.description));
        if(this.session.role==="guest") {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          await this.gather();
          if(this.stopped)return;
          await this.signal();
        }
      }
    } catch(e) {
      if(!this.stopped)this.fail(e instanceof Error?e.message:"A sala expirou.");
      return;
    }
    if(!this.stopped && this.pc.connectionState!=="connected")this.pollTimer=setTimeout(()=>void this.poll(),1500);
  }
  private bind(channel:RTCDataChannel) {
    this.channel=channel;
    channel.binaryType="arraybuffer";
    channel.bufferedAmountLowThreshold=65536;
    channel.onopen=()=>{
      if(this.connectTimer)clearTimeout(this.connectTimer);
      if(this.pollTimer)clearTimeout(this.pollTimer);
      this.hooks.state("connected","Aparelhos conectados");
    };
    channel.onclose=()=>{if(!this.stopped)this.fail("O outro aparelho desconectou. Crie outra sala para continuar.");};
    channel.onerror=()=>{if(!this.stopped)this.fail("A transferência foi interrompida. Reconecte os aparelhos.");};
    channel.onmessage=event=>{
      const bytes=typeof event.data==="string"?event.data.length*2:event.data instanceof Blob?event.data.size:event.data.byteLength;
      this.queuedBytes+=bytes;
      if(this.queuedBytes>4*FLOW_WINDOW){this.fail("O envio excedeu a velocidade de gravação. Tente novamente.");return;}
      this.queue=this.queue.then(()=>{if(!this.stopped)return this.message(event.data);}).catch(e=>{this.cancel();this.hooks.error(e instanceof Error?e.message:"Dados inválidos recebidos.");}).finally(()=>{this.queuedBytes-=bytes;});
    };
  }
  private control(value:unknown) {
    if(this.stopped||this.channel?.readyState!=="open") throw new Error("O aparelho não está conectado.");
    this.channel.send(JSON.stringify(value));
  }
  private wait(key:string,timeout=120000) {
    return new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(key);reject(new Error("O outro aparelho não respondeu. Tente novamente."));},timeout);
      this.pending.set(key,{resolve,reject,timer});
    });
  }
  private resolve(key:string) {const p=this.pending.get(key);if(p){clearTimeout(p.timer);p.resolve();this.pending.delete(key);}}
  private rejectAll(message:string) {for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}this.pending.clear();}
  private async message(data:string|ArrayBuffer|Blob) {
    if(typeof data!=="string") {
      const r=this.receiving;
      if(!r || !this.accepted)throw new Error("Arquivo recebido sem autorização.");
      const chunk=data instanceof Blob?await data.arrayBuffer():data;
      if(chunk.byteLength>CHUNK_SIZE || r.bytes+chunk.byteLength>r.info.size)throw new Error("Tamanho de arquivo inválido.");
      if(r.sink)await r.sink.write(chunk);else r.chunks.push(chunk);
      if(this.receiving!==r)return;
      r.bytes+=chunk.byteLength;
      this.progress(r.info.name,r.bytes,r.info.size,"receive");
      if(this.incomingFlow && (r.bytes%FLOW_WINDOW===0 || r.bytes===r.info.size))this.control({type:"flow",id:r.info.id,bytes:r.bytes});
      return;
    }
    if(data.length>350000)throw new Error("Solicitação muito grande.");
    const msg=JSON.parse(data);
    switch(msg.type) {
      case "offer": {
        if(!validateOffer(msg.offer) || this.busy) {this.control({type:"reject",reason:this.busy?"O aparelho está ocupado.":"Lote inválido ou maior que 100 GB."});return;}
        this.incoming=msg.offer;this.incomingFlow=msg.flowControl===1;this.accepted=false;this.receiveIndex=0;
        this.hooks.offer(this.incoming);return;
      }
      case "accept": this.peerFlow=msg.flowControl===1;this.resolve("accept");return;
      case "reject": this.rejectAll(typeof msg.reason==="string"?msg.reason:"O recebimento foi recusado.");return;
      case "file": {
        const info=this.incoming?.files[this.receiveIndex];
        if(!this.accepted || this.receiving || !info || msg.id!==info.id)throw new Error("Sequência de arquivos inválida.");
        const epoch=this.transferEpoch;
        const sink=this.sinkFactory?await this.sinkFactory(info,this.receiveIndex):null;
        if(this.stopped || epoch!==this.transferEpoch){await sink?.abort().catch(()=>{});return;}
        this.receiving={info,chunks:[],bytes:0,sink};this.progress(info.name,0,info.size,"receive");return;
      }
      case "file-end": {
        const r=this.receiving;
        if(!r || msg.id!==r.info.id || r.bytes!==r.info.size)throw new Error("Arquivo incompleto. Envie novamente.");
        if(r.sink)await r.sink.close();
        if(this.receiving!==r)return;
        this.hooks.file(r.info,r.sink?null:new Blob(r.chunks,{type:r.info.type||"application/octet-stream"}));
        this.receiving=null;this.receiveIndex++;this.control({type:"ack",id:msg.id});return;
      }
      case "ack": this.resolve(`ack:${msg.id}`);return;
      case "flow": if(typeof msg.id==="string" && Number.isSafeInteger(msg.bytes))this.resolve(`flow:${msg.id}:${msg.bytes}`);return;
      case "done": {
        if(!this.incoming || !this.accepted || this.receiving || this.receiveIndex!==this.incoming.files.length)throw new Error("Transferência incompleta.");
        const count=this.incoming.files.length;this.incoming=null;this.accepted=false;this.sinkFactory=null;this.hooks.offer(null);this.hooks.complete("receive",count);return;
      }
      case "cancel": this.resetTransfer();this.hooks.error("Transferência cancelada pelo outro aparelho.");return;
    }
  }
  accept(sinkFactory?:SinkFactory,offerId?:string) {
    if(!this.incoming || (offerId && this.incoming.id!==offerId))return;
    const total=this.incoming.files.reduce((n,file)=>n+file.size,0);
    if(total>MAX_MEMORY && (!sinkFactory || !this.incomingFlow)){
      const message=!sinkFactory?"Para receber mais de 200 MB, escolha uma pasta usando Chrome ou Edge no computador.":"Atualize o site no aparelho que envia para transferir arquivos grandes.";
      this.reject();this.hooks.error(message);return;
    }
    this.sinkFactory=sinkFactory||null;
    this.accepted=true;this.hooks.offer(null);this.control({type:"accept",flowControl:this.incomingFlow?1:0});
  }
  reject() {
    this.incoming=null;this.accepted=false;this.hooks.offer(null);this.control({type:"reject",reason:"O recebimento foi recusado."});
  }
  private async drain() {
    const c=this.channel;
    if(!c || this.stopped || this.cancelled || c.readyState!=="open")throw new Error("Transferência interrompida.");
    if(c.bufferedAmount<=262144)return;
    await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);c.removeEventListener("bufferedamountlow",low);c.removeEventListener("close",closed);};
      const low=()=>{cleanup();resolve();};const closed=()=>{cleanup();reject(new Error("Conexão encerrada."));};
      const timer=setTimeout(()=>{cleanup();reject(new Error("O envio demorou demais. Tente novamente."));},30000);
      c.addEventListener("bufferedamountlow",low,{once:true});c.addEventListener("close",closed,{once:true});
      if(c.bufferedAmount<=65536)low();
    });
  }
  async send(files:File[]) {
    if(this.busy)throw new Error("Aguarde a transferência atual terminar.");
    const offer:Offer={id:crypto.randomUUID(),files:files.map(f=>({id:crypto.randomUUID(),name:f.name,size:f.size,type:f.type||"application/octet-stream"}))};
    if(!validateOffer(offer))throw new Error("Selecione até 500 arquivos e 100 GB por lote.");
    this.outgoing=true;this.cancelled=false;this.peerFlow=false;
    try {
      const accept=this.wait("accept",600000);this.control({type:"offer",offer,flowControl:1});
      await accept;
      for(let i=0;i<files.length;i++) {
        const file=files[i],info=offer.files[i];
        if(this.cancelled)throw new Error("Transferência cancelada.");
        this.control({type:"file",id:info.id});
        for(let offset=0;offset<file.size;offset+=CHUNK_SIZE) {
          const chunk=await file.slice(offset,offset+CHUNK_SIZE).arrayBuffer();
          await this.drain();
          if(this.cancelled)throw new Error("Transferência cancelada.");
          const current=Math.min(offset+chunk.byteLength,file.size);
          const confirmation=this.peerFlow && (current%FLOW_WINDOW===0 || current===file.size)?this.wait(`flow:${info.id}:${current}`,120000):null;
          this.channel!.send(chunk);
          if(confirmation)await confirmation;
          this.progress(file.name,current,file.size,"send");
        }
        const ack=this.wait(`ack:${info.id}`,60000);this.control({type:"file-end",id:info.id});await ack;
      }
      this.control({type:"done"});this.hooks.complete("send",files.length);
    } catch(e) {
      if(!this.stopped && this.channel?.readyState==="open")this.control({type:"cancel"});
      throw e;
    } finally {this.outgoing=false;}
  }
  private resetTransfer() {
    this.transferEpoch++;
    this.cancelled=true;void this.receiving?.sink?.abort().catch(()=>{});this.receiving=null;this.incoming=null;this.accepted=false;this.sinkFactory=null;this.hooks.offer(null);this.rejectAll("Transferência cancelada.");
  }
  cancel() {if(this.channel?.readyState==="open")this.control({type:"cancel"});this.resetTransfer();}
  private fail(message:string) {if(this.stopped)return;this.failureDiagnostics=this.diagnostics;this.close();this.hooks.state("error",message);this.hooks.error(message);}
  close() {
    this.stopped=true;
    if(this.pollTimer)clearTimeout(this.pollTimer);
    if(this.connectTimer)clearTimeout(this.connectTimer);
    this.resetTransfer();this.channel?.close();this.pc?.close();
  }
}
