"use client";
import {ShieldCheck,LoaderCircle} from "lucide-react";
export default function PeerConfirmation({words}:{words:string|null}){
  return <section className="peer-confirmation" aria-label="Confirmação dos aparelhos"><strong><ShieldCheck size={17}/> Confira nos dois aparelhos</strong>{words?<><p className="peer-words" aria-label={`Palavras de confirmação: ${words}`}>{words.split(" · ").map((word,i)=><span key={i}>{word}</span>)}</p><p>As quatro palavras devem ser iguais nas duas telas. Se forem diferentes, cancele e crie outra sala.</p></>:<p><LoaderCircle size={15} className="spin"/> Preparando as palavras da conexão…</p>}</section>;
}
