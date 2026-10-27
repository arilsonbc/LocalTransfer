"use client";
import {useLanguage} from "./language-provider";
export default function LanguageSwitch(){const {language,choose}=useLanguage();const label=language==="en"?"Language":language==="es"?"Idioma":"Idioma";
  return <label className="language-switch"><span className="sr-only">{label}</span><select aria-label={label} value={language} onChange={event=>choose(event.target.value as "pt"|"en"|"es")}><option value="pt">Português</option><option value="en">English</option><option value="es">Español</option></select></label>;
}
