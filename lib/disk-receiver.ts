import {safeFilename,type SinkFactory} from "./transfer";

type PickerWindow = Window & {showDirectoryPicker?:(options:{mode:"readwrite"})=>Promise<FileSystemDirectoryHandle>};
export function canSaveToDisk() {
  return typeof window!=="undefined" && typeof (window as PickerWindow).showDirectoryPicker==="function";
}
export async function chooseReceiveFolder():Promise<{name:string;open:SinkFactory}> {
  const picker=(window as PickerWindow).showDirectoryPicker;
  if(!picker)throw new Error("Para receber arquivos grandes, use Chrome ou Edge no computador.");
  const parent=await picker.call(window,{mode:"readwrite"});
  // A fresh subfolder and numbered names prevent overwriting existing files.
  const name=`LocalTransfer-${new Date().toISOString().replace(/[:.]/g,"-")}-${crypto.randomUUID().slice(0,8)}`;
  const folder=await parent.getDirectoryHandle(name,{create:true});
  return {name,open:async(file,index)=>{
    const filename=`${String(index+1).padStart(3,"0")}-${safeFilename(file.name).replace(/[. ]+$/,"")||"arquivo"}`;
    const handle=await folder.getFileHandle(filename,{create:true});
    const stream=await handle.createWritable();
    return {write:chunk=>stream.write(chunk),close:()=>stream.close(),abort:()=>stream.abort()};
  }};
}
