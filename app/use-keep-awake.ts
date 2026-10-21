"use client";
import {useEffect,useState} from "react";

export function useKeepAwake(active:boolean){
  const [awake,setAwake]=useState(false);
  useEffect(()=>{
    let disposed=false,pending=false;
    let sentinel:WakeLockSentinel|null=null;
    async function acquire(){
      if(!active || disposed || pending || sentinel || document.visibilityState!=="visible" || !navigator.wakeLock)return;
      pending=true;
      try{
        const next=await navigator.wakeLock.request("screen");
        if(disposed || document.visibilityState!=="visible"){await next.release();return;}
        sentinel=next;setAwake(true);
        next.addEventListener("release",()=>{if(sentinel===next)sentinel=null;if(!disposed)setAwake(false);});
      }catch{if(!disposed)setAwake(false);}finally{pending=false;}
    }
    if(!active)setAwake(false);else void acquire();
    document.addEventListener("visibilitychange",acquire);
    return ()=>{disposed=true;document.removeEventListener("visibilitychange",acquire);void sentinel?.release().catch(()=>{});};
  },[active]);
  return awake;
}
