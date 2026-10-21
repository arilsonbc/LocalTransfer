"use client";
import {useEffect,useRef,useState} from "react";
import {File as FileIcon} from "lucide-react";
import {canPreviewPhoto} from "../lib/photo-preview";

async function thumbnail(file:Blob):Promise<Blob|null>{
  const bitmap=await createImageBitmap(file,{resizeWidth:160,resizeQuality:"medium",imageOrientation:"from-image"});
  try{
    const canvas=document.createElement("canvas");canvas.width=160;canvas.height=160;
    const context=canvas.getContext("2d");if(!context)return null;
    const scale=Math.max(160/bitmap.width,160/bitmap.height),width=bitmap.width*scale,height=bitmap.height*scale;
    context.drawImage(bitmap,(160-width)/2,(160-height)/2,width,height);
    return await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",.8));
  }finally{bitmap.close();}
}
export default function FileThumbnail({file,name}:{file:Blob|null;name:string}){
  const target=useRef<HTMLSpanElement>(null);const[url,setUrl]=useState("");
  useEffect(()=>{
    if(!file||!canPreviewPhoto(file.type,file.size)||typeof createImageBitmap!=="function")return;
    let stopped=false,objectUrl="";const element=target.current;if(!element)return;
    const load=async()=>{
      try{const result=await thumbnail(file);if(stopped||!result)return;objectUrl=URL.createObjectURL(result);setUrl(objectUrl);}catch{/* Unsupported or damaged images keep the file icon. */}
    };
    const observer=typeof IntersectionObserver==="function"?new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer?.disconnect();void load();}},{rootMargin:"100px"}):null;
    if(observer)observer.observe(element);else void load();
    return()=>{stopped=true;observer?.disconnect();if(objectUrl)URL.revokeObjectURL(objectUrl);setUrl("");};
  },[file]);
  return <span ref={target} className="file-thumbnail">{url?<img src={url} alt={`Miniatura de ${name}`} width={56} height={56} loading="lazy" decoding="async" onError={()=>setUrl("")}/>:<FileIcon size={22} aria-hidden="true"/>}</span>;
}
