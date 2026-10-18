export const MAX_BATCH = 200 * 1024 * 1024;
export const MAX_FILES = 500;
export const CHUNK_SIZE = 16 * 1024;
export type FileInfo = {id:string;name:string;size:number;type:string};
export type Offer = {id:string;files:FileInfo[]};
export type Session = {code:string;token:string;role:"host"|"guest";expiresAt:number;peerName?:string};
type Hooks = {
  state:(state:string,message:string)=>void;
  peer:(name:string)=>void;
  offer:(offer:Offer|null)=>void;
  progress:(name:string,current:number,total:number,direction:"send"|"receive")=>void;
  file:(file:FileInfo,blob:Blob)=>void;
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
  private receiving:{info:FileInfo;chunks:ArrayBuffer[];bytes:number}|null=null;
  private receiveIndex=0;
  private outgoing=false;
  private cancelled=false;
  private pending=new Map<string,{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private queue=Promise.resolve();
  constructor(private session:Session,private hooks:Hooks) {}
  private createPeer(iceServers:RTCIceServer[]) {
    this.pc=new RTCPeerConnection({iceServers});
    this.pc.ondatachannel=e=>this.bind(e.channel);
    this.pc.onconnectionstatechange=()=>{
      if(this.stopped) return;
      if(this.pc.connectionState==="failed") this.fail("Não foi possível conectar os aparelhos. Confira a internet nos dois e crie outra sala.");
      if(this.pc.connectionState==="disconnected") this.hooks.state("reconnecting","Conexão interrompida. Tentando reconectar…");
      if(this.pc.connectionState==="connected" && this.channel?.readyState==="open") this.hooks.state("connected","Aparelhos conectados");
    };
  }
  get busy() {return this.outgoing || !!this.incoming;}
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
    if(this.pc.iceGatheringState==="complete") return;
    await new Promise<void>(resolve=>{
      const done=()=>{clearTimeout(timer);this.pc.removeEventListener("icegatheringstatechange",changed);resolve();};
      const changed=()=>{if(this.pc.iceGatheringState==="complete")done();};
      const timer=setTimeout(done,20000);
      this.pc.addEventListener("icegatheringstatechange",changed);
    });
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
      if(state.joined && !this.connectTimer) this.connectTimer=setTimeout(()=>this.fail("A conexão demorou demais. Confira a internet nos dois aparelhos e crie outra sala."),90000);
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
      this.queue=this.queue.then(()=>this.message(event.data)).catch(e=>{this.cancel();this.hooks.error(e instanceof Error?e.message:"Dados inválidos recebidos.");});
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
      r.chunks.push(chunk);r.bytes+=chunk.byteLength;
      this.hooks.progress(r.info.name,r.bytes,r.info.size,"receive");
      return;
    }
    if(data.length>350000)throw new Error("Solicitação muito grande.");
    const msg=JSON.parse(data);
    switch(msg.type) {
      case "offer": {
        if(!validateOffer(msg.offer) || this.busy) {this.control({type:"reject",reason:this.busy?"O aparelho está ocupado.":"Lote inválido ou maior que 200 MB."});return;}
        this.incoming=msg.offer;this.accepted=false;this.receiveIndex=0;
        this.hooks.offer(this.incoming);return;
      }
      case "accept": this.resolve("accept");return;
      case "reject": this.rejectAll(typeof msg.reason==="string"?msg.reason:"O recebimento foi recusado.");return;
      case "file": {
        const info=this.incoming?.files[this.receiveIndex];
        if(!this.accepted || this.receiving || !info || msg.id!==info.id)throw new Error("Sequência de arquivos inválida.");
        this.receiving={info,chunks:[],bytes:0};this.hooks.progress(info.name,0,info.size,"receive");return;
      }
      case "file-end": {
        const r=this.receiving;
        if(!r || msg.id!==r.info.id || r.bytes!==r.info.size)throw new Error("Arquivo incompleto. Envie novamente.");
        this.hooks.file(r.info,new Blob(r.chunks,{type:r.info.type||"application/octet-stream"}));
        this.receiving=null;this.receiveIndex++;this.control({type:"ack",id:msg.id});return;
      }
      case "ack": this.resolve(`ack:${msg.id}`);return;
      case "done": {
        if(!this.incoming || !this.accepted || this.receiving || this.receiveIndex!==this.incoming.files.length)throw new Error("Transferência incompleta.");
        const count=this.incoming.files.length;this.incoming=null;this.accepted=false;this.hooks.offer(null);this.hooks.complete("receive",count);return;
      }
      case "cancel": this.resetTransfer();this.hooks.error("Transferência cancelada pelo outro aparelho.");return;
    }
  }
  accept() {
    if(!this.incoming)return;
    this.accepted=true;this.hooks.offer(null);this.control({type:"accept"});
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
    if(!validateOffer(offer))throw new Error("Selecione até 500 arquivos e 200 MB por lote.");
    this.outgoing=true;this.cancelled=false;
    try {
      const accept=this.wait("accept");this.control({type:"offer",offer});
      await accept;
      for(let i=0;i<files.length;i++) {
        const file=files[i],info=offer.files[i];
        if(this.cancelled)throw new Error("Transferência cancelada.");
        this.control({type:"file",id:info.id});
        for(let offset=0;offset<file.size;offset+=CHUNK_SIZE) {
          const chunk=await file.slice(offset,offset+CHUNK_SIZE).arrayBuffer();
          await this.drain();
          if(this.cancelled)throw new Error("Transferência cancelada.");
          this.channel!.send(chunk);
          this.hooks.progress(file.name,Math.min(offset+chunk.byteLength,file.size),file.size,"send");
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
    this.cancelled=true;this.receiving=null;this.incoming=null;this.accepted=false;this.hooks.offer(null);this.rejectAll("Transferência cancelada.");
  }
  cancel() {if(this.channel?.readyState==="open")this.control({type:"cancel"});this.resetTransfer();}
  private fail(message:string) {if(this.stopped)return;this.close();this.hooks.state("error",message);this.hooks.error(message);}
  close() {
    this.stopped=true;
    if(this.pollTimer)clearTimeout(this.pollTimer);
    if(this.connectTimer)clearTimeout(this.connectTimer);
    this.resetTransfer();this.channel?.close();this.pc?.close();
  }
}
