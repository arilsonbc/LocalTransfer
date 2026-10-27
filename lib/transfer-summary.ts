export type BatchOutcome="completed"|"rejected"|"cancelled"|"failed";
export type BatchSummary={direction:"send"|"receive";outcome:BatchOutcome;offered:number;sent:number;received:number;refused:number;cancelled:number;failed:number;totalBytes:number;completedBytes:number;durationMs:number};
type Item={id:string;size:number};
export class BatchSummaryTracker {
  private selected:Set<string>;
  private completed=new Set<string>();
  private skipped=new Set<string>();
  private result:BatchSummary|null=null;
  constructor(private direction:"send"|"receive",private files:Item[],private started=performance.now()){
    this.selected=new Set(files.map(f=>f.id));
  }
  select(ids:string[]){if(!this.result)this.selected=new Set(ids.filter(id=>this.files.some(f=>f.id===id)));}
  confirm(id:string){if(!this.result&&this.selected.has(id)&&!this.skipped.has(id))this.completed.add(id);}
  skip(id:string){if(!this.result&&this.selected.has(id)&&!this.completed.has(id))this.skipped.add(id);}
  finish(outcome:BatchOutcome,now=performance.now()):BatchSummary {
    if(this.result)return this.result;
    if(outcome==="rejected")this.selected.clear();
    const pending=Math.max(0,this.selected.size-this.completed.size-this.skipped.size);
    return this.result={direction:this.direction,outcome,offered:this.files.length,
      sent:this.direction==="send"?this.completed.size:0,received:this.direction==="receive"?this.completed.size:0,
      refused:this.files.length-this.selected.size,cancelled:this.skipped.size+(outcome==="cancelled"?pending:0),failed:outcome==="failed"?pending:0,
      totalBytes:this.files.reduce((n,f)=>n+f.size,0),completedBytes:this.files.filter(f=>this.completed.has(f.id)).reduce((n,f)=>n+f.size,0),
      durationMs:Math.max(0,now-this.started)};
  }
}
export function formatDuration(ms:number){
  const seconds=Math.floor(Math.max(0,ms)/1000);
  if(seconds<60)return `${seconds} s`;
  if(seconds<3600)return `${Math.floor(seconds/60)} min ${seconds%60} s`;
  return `${Math.floor(seconds/3600)} h ${Math.floor(seconds%3600/60)} min`;
}
