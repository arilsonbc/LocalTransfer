import {messages} from "./messages";
export type Language="pt"|"en"|"es";
export function validLanguage(value:unknown):Language{return value==="en"||value==="es"?value:"pt";}
const canonical=new Map<string,string>();
const patterns:{key:string;regex:RegExp;indices:string[]}[]=[];
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
for(const [key,translations] of Object.entries(messages)){
  for(const text of [key,...translations]){
    if(!text.includes("{0}")){if(!canonical.has(text))canonical.set(text,key);continue;}
    const indices:string[]=[];let offset=0,pattern="^";
    for(const match of text.matchAll(/\{(\d+)\}/g)){pattern+=escape(text.slice(offset,match.index))+"([\\s\\S]*?)";indices.push(match[1]);offset=match.index!+match[0].length;}
    patterns.push({key,regex:new RegExp(pattern+escape(text.slice(offset))+"$"),indices});
  }
}
export function translate(text:string,language:Language,values:readonly unknown[]=[]):string{
  const trimmed=text.trim();let key=Object.hasOwn(messages,text)?text:canonical.get(trimmed),params=values;
  if(!key){for(const pattern of patterns){const match=pattern.regex.exec(trimmed);if(match){key=pattern.key;const found:string[]=[];pattern.indices.forEach((index,i)=>{found[Number(index)]=match[i+1];});params=found;break;}}}
  if(!key)return text;
  const output=language==="pt"?key:messages[key][language==="en"?0:1];
  const result=output.replace(/\{(\d+)\}/g,(placeholder,index)=>params[Number(index)]===undefined?placeholder:String(params[Number(index)]));
  return text===trimmed?result:text.slice(0,text.indexOf(trimmed))+result+text.slice(text.indexOf(trimmed)+trimmed.length);
}
