"use client";

import {useEffect,useState} from "react";
import {Moon,Sun} from "lucide-react";

export default function ThemeSwitch() {
  const [theme,setTheme]=useState("light");
  useEffect(()=>{setTheme(document.documentElement.dataset.theme||"light");},[]);
  function choose(value:"light"|"dark") {
    document.documentElement.dataset.theme=value;
    setTheme(value);
    try{localStorage.setItem("localtransfer-theme",value);}catch{/* The selection still works without local storage. */}
  }
  return <div className="theme-switch" role="group" aria-label="Aparência da página">
    <button className="theme-button" type="button" aria-label="Modo claro" title="Modo claro" aria-pressed={theme==="light"} onClick={()=>choose("light")}><Sun size={20}/></button>
    <button className="theme-button" type="button" aria-label="Modo escuro" title="Modo escuro" aria-pressed={theme==="dark"} onClick={()=>choose("dark")}><Moon size={20}/></button>
  </div>;
}
