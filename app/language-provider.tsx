"use client";
import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {translate,validLanguage,type Language} from "../lib/i18n";
const LanguageContext=createContext<{language:Language;choose:(language:Language)=>void}>({language:"pt",choose:()=>{}});
export default function LanguageProvider({children}:{children:ReactNode}){
  const [language,setLanguage]=useState<Language>("pt");
  useEffect(()=>{try{setLanguage(validLanguage(localStorage.getItem("localtransfer-language")));}catch{/* Portuguese remains the default. */}
    const sync=(event:StorageEvent)=>{if(event.key==="localtransfer-language")setLanguage(validLanguage(event.newValue));};window.addEventListener("storage",sync);return()=>window.removeEventListener("storage",sync);
  },[]);
  useEffect(()=>{document.documentElement.lang=language==="pt"?"pt-BR":language;document.title=location.pathname.startsWith("/converter")?`${translate("Conversor de imagens",language)} — LocalTransfer`:language==="en"?"LocalTransfer — files between your devices":language==="es"?"LocalTransfer — archivos entre tus dispositivos":"LocalTransfer — seus arquivos, de um aparelho para outro";},[language]);
  function choose(value:Language){const next=validLanguage(value);setLanguage(next);try{localStorage.setItem("localtransfer-language",next);}catch{/* Selection works without storage. */}}
  return <LanguageContext.Provider value={{language,choose}}>{children}</LanguageContext.Provider>;
}
export function useLanguage(){const {language,choose}=useContext(LanguageContext);return {language,choose,t:(text:string,values?:readonly unknown[])=>translate(text,language,values)};}
