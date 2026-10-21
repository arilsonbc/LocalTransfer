export type TransferStats={bytes:number;total:number;percent:number;bytesPerSecond:number;secondsRemaining:number|null;fileNumber:number;fileCount:number};
export class ProgressMeter {
  private time=0;
  private bytes=0;
  private speed=0;
  reset(){this.time=0;this.bytes=0;this.speed=0;}
  sample(bytes:number,total:number,fileNumber:number,fileCount:number,now=performance.now()):TransferStats {
    bytes=Math.max(0,Math.min(bytes,total));
    if(!this.time || bytes<this.bytes){this.time=now;this.bytes=bytes;this.speed=0;}
    const elapsed=now-this.time;
    if(elapsed>=500){
      const instant=Math.max(0,(bytes-this.bytes)*1000/elapsed);
      this.speed=this.speed?this.speed*.65+instant*.35:instant;
      this.time=now;this.bytes=bytes;
    }
    return {bytes,total,percent:total?Math.min(100,bytes/total*100):100,bytesPerSecond:this.speed,secondsRemaining:bytes===total?0:this.speed>0?Math.ceil((total-bytes)/this.speed):null,fileNumber,fileCount};
  }
}
export function formatRemaining(seconds:number|null) {
  if(seconds===null)return "Calculando tempo restante…";
  if(seconds===0)return "Concluindo…";
  if(seconds<60)return `Cerca de ${Math.max(1,seconds)} s restantes`;
  if(seconds<3600)return `Cerca de ${Math.ceil(seconds/60)} min restantes`;
  return `Cerca de ${Math.floor(seconds/3600)} h ${Math.ceil(seconds%3600/60)} min restantes`;
}
