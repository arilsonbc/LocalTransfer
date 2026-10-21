"use client";
import {useEffect,useState} from "react";
import {Check,Copy,Link as LinkIcon,QrCode,Share2} from "lucide-react";
import {makeInvite} from "../lib/invite";

export default function InviteCard({code}:{code:string}) {
  const [url,setUrl]=useState("");
  const [qr,setQr]=useState("");
  const [showQr,setShowQr]=useState(false);
  const [copied,setCopied]=useState(false);
  const [notice,setNotice]=useState("");
  useEffect(()=>{setUrl(makeInvite(location.href,code));setCopied(false);setQr("");},[code]);
  useEffect(()=>{
    if(!showQr || !url)return;
    let active=true;
    void import("qrcode").then(q=>q.toDataURL(url,{width:256,margin:3,errorCorrectionLevel:"M",color:{dark:"#183b2a",light:"#ffffff"}})).then(image=>{if(active)setQr(image);}).catch(()=>{if(active)setNotice("Não foi possível gerar o QR Code. Use o link ou o código da sala.");});
    return ()=>{active=false;};
  },[showQr,url]);
  async function copy(){try{await navigator.clipboard.writeText(url);setCopied(true);setNotice("");}catch{setNotice("Selecione o link abaixo e copie para compartilhar.");}}
  async function share(){try{if(navigator.share)await navigator.share({title:"Receber arquivos no LocalTransfer",text:"Abra este convite no aparelho que vai receber. Compartilhe apenas com a pessoa esperada.",url});else await copy();}catch(e){if(!(e instanceof DOMException && e.name==="AbortError"))await copy();}}
  return <div className="invite-card">
    <p>Ou conecte sem digitar:</p>
    <div className="invite-actions"><button className="secondary" onClick={()=>setShowQr(!showQr)} aria-expanded={showQr}><QrCode size={17}/>{showQr?"Ocultar QR Code":"Mostrar QR Code"}</button><button className="secondary" onClick={()=>void copy()}><span>{copied?<Check size={16}/>:<LinkIcon size={16}/>}</span>{copied?"Link copiado":"Copiar convite"}</button><button className="text-button" onClick={()=>void share()}><Share2 size={15}/>Compartilhar</button></div>
    {showQr && <div className="invite-qr">{qr?<img src={qr} width={208} height={208} alt="QR Code para abrir o convite de recebimento neste outro aparelho"/>:<span>Preparando QR Code…</span>}<small>Leia com a câmera do aparelho que vai receber.<br/>Depois, toque em Conectar e receber.</small></div>}
    {notice && <div className="invite-notice" role="status"><p>{notice}</p><input aria-label="Link do convite" value={url} readOnly onFocus={event=>event.currentTarget.select()}/></div>}
    <small>O convite dá acesso à sala. Compartilhe só com quem deve receber.</small>
  </div>;
}
