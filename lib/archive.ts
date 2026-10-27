// ZIP without compression: Blob parts keep file bytes out of a second large JS buffer.
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function header(length:number){const bytes=new Uint8Array(length);return {bytes,view:new DataView(bytes.buffer)};}
export async function archiveFiles(files:{name:string;blob:Blob}[]):Promise<Blob>{
  if(!files.length||files.length>500||files.reduce((n,f)=>n+f.blob.size,0)>200*1024*1024)throw new Error("Salve até 200 MB de arquivos por ZIP.");
  const parts:BlobPart[]=[],central:BlobPart[]=[];let offset=0,centralSize=0;
  for(let index=0;index<files.length;index++){
    const file=files[index];
    const safe=file.name.replace(/[\\/\u0000-\u001f<>:"|?*]/g,"_").replace(/^\.+/,"_").slice(0,200)||"arquivo";
    const name=new TextEncoder().encode(`${String(index+1).padStart(3,"0")}-${safe}`);
    let crc=0xffffffff;const reader=file.blob.stream().getReader();
    try{while(true){const {done,value}=await reader.read();if(done)break;for(const byte of value)crc=table[(crc^byte)&255]^(crc>>>8);}}finally{reader.releaseLock();}
    crc=(crc^0xffffffff)>>>0;
    const local=header(30);local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint16(6,0x800,true);local.view.setUint16(12,33,true);
    local.view.setUint32(14,crc,true);local.view.setUint32(18,file.blob.size,true);local.view.setUint32(22,file.blob.size,true);local.view.setUint16(26,name.length,true);
    parts.push(local.bytes,name,file.blob);
    const entry=header(46);entry.view.setUint32(0,0x02014b50,true);entry.view.setUint16(4,20,true);entry.view.setUint16(6,20,true);entry.view.setUint16(8,0x800,true);entry.view.setUint16(14,33,true);
    entry.view.setUint32(16,crc,true);entry.view.setUint32(20,file.blob.size,true);entry.view.setUint32(24,file.blob.size,true);entry.view.setUint16(28,name.length,true);entry.view.setUint32(42,offset,true);
    central.push(entry.bytes,name);centralSize+=46+name.length;offset+=30+name.length+file.blob.size;
  }
  const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
  return new Blob([...parts,...central,end.bytes],{type:"application/zip"});
}
