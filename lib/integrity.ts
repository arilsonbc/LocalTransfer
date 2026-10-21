import {sha256} from "@noble/hashes/sha2.js";

export const newSha256=()=>sha256.create();
export const digestHex=(hash:ReturnType<typeof newSha256>)=>Array.from(hash.clone().digest(),b=>b.toString(16).padStart(2,"0")).join("");
const CHECKPOINT=1024*1024;

// Keep a few small hash states, never a copy of the file or its prefix.
export class SendingIntegrity {
  private hash=newSha256();
  private bytes=0;
  private checkpoints=new Map([[0,this.hash.clone()]]);
  update(chunk:ArrayBuffer){
    this.hash.update(new Uint8Array(chunk));this.bytes+=chunk.byteLength;
    if(this.bytes%CHECKPOINT===0){
      this.checkpoints.set(this.bytes,this.hash.clone());
      const recent=[...this.checkpoints.keys()].filter(n=>n>0).sort((a,b)=>b-a);
      for(const old of recent.slice(5))this.checkpoints.delete(old);
    }
  }
  async seek(file:Blob,offset:number,ready:()=>Promise<void>){
    if(!Number.isSafeInteger(offset)||offset<0||offset>file.size)throw new Error("Ponto de verificação inválido.");
    if(offset===this.bytes)return;
    const start=Math.max(...[...this.checkpoints.keys()].filter(n=>n<=offset));
    this.hash=this.checkpoints.get(start)!.clone();this.bytes=start;
    for(const n of this.checkpoints.keys())if(n>start)this.checkpoints.delete(n);
    while(this.bytes<offset){
      await ready();
      const chunk=await file.slice(this.bytes,Math.min(this.bytes+65536,offset)).arrayBuffer();
      await ready();this.update(chunk);
    }
  }
  digest(){return digestHex(this.hash);}
}
