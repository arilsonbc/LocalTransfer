import {wordlist} from "@scure/bip39/wordlists/portuguese.js";

function fingerprint(sdp:string){
  const values=[...sdp.matchAll(/^a=fingerprint:sha-256[ \t]+((?:[a-f0-9]{2}:){31}[a-f0-9]{2})[ \t]*\r?$/gim)].map(m=>m[1].replaceAll(":","").toLowerCase());
  if(new Set(values).size!==1)throw new Error("Não foi possível conferir os aparelhos. Atualize os navegadores e crie outra sala.");
  return values[0];
}
export async function derivePeerVerification(localSdp:string,remoteSdp:string,code:string){
  const pair=[fingerprint(localSdp),fingerprint(remoteSdp)].sort();
  const binding=JSON.stringify(["LocalTransfer peer verification v1",code,...pair]);
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(binding)));
  // Four independent 11-bit indices: 44 bits displayed as Portuguese words.
  const bits=Array.from(digest.slice(0,6),b=>b.toString(2).padStart(8,"0")).join("");
  const words=Array.from({length:4},(_,i)=>wordlist[parseInt(bits.slice(i*11,i*11+11),2)]).join(" · ");
  return {binding,words};
}
