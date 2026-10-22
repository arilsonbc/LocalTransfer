"use client";
import {ArrowDownToLine,Check,File as FileIcon,LoaderCircle} from "lucide-react";
import {MAX_MEMORY,type Offer} from "../lib/transfer";
import PeerConfirmation from "./peer-confirmation";
const size=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1e9?`${(n/1048576).toFixed(1)} MB`:`${(n/1e9).toFixed(1)} GB`;
export default function ReceiveOffer({offer,selected,peer,busy,diskSupported,error,onChange,onAccept,onReject,words,confirmed,onConfirm}:{offer:Offer;selected:string[];peer:string;busy:boolean;diskSupported:boolean;error:string;onChange:(ids:string[])=>void;onAccept:()=>void;onReject:()=>void;words:string|null;confirmed:boolean;onConfirm:(value:boolean)=>void}){
  const chosen=offer.files.filter(f=>selected.includes(f.id));const total=chosen.reduce((n,f)=>n+f.size,0),large=total>MAX_MEMORY;
  return <div className="modal-backdrop"><section className="receive-modal selective-offer" role="dialog" aria-modal="true" aria-labelledby="receive-title">
    <span className="success-icon"><ArrowDownToLine size={30}/></span><span className="card-kicker">ARQUIVOS DE {peer||"OUTRO APARELHO"}</span>
    <h2 id="receive-title">Quais arquivos deseja receber?</h2><p id="selection-summary" aria-live="polite">{chosen.length} de {offer.files.length} arquivo(s) selecionado(s) · {size(total)}</p>
    <PeerConfirmation words={words}/>
    <label className="peer-match-check"><input type="checkbox" checked={confirmed} disabled={busy||!words} onChange={event=>onConfirm(event.target.checked)}/><span>Conferi: as quatro palavras são iguais nos dois aparelhos.</span></label>
    {!offer.selectable&&<p>Para escolher apenas alguns arquivos, atualize o site no aparelho que envia. Nesta conexão, você pode receber o lote completo.</p>}
    <div className="selection-actions"><button className="text-button" disabled={busy||!offer.selectable||chosen.length===offer.files.length} onClick={()=>onChange(offer.files.map(f=>f.id))}>Marcar todos</button><button className="text-button" disabled={busy||!offer.selectable||!chosen.length} onClick={()=>onChange([])}>Desmarcar todos</button></div>
    <div className="offer-files selectable-files" role="group" aria-label="Arquivos disponíveis" aria-describedby="selection-summary">{offer.files.map(file=><label key={file.id} className="offer-file-choice"><input type="checkbox" checked={selected.includes(file.id)} disabled={busy||!offer.selectable} onChange={event=>onChange(event.target.checked?[...selected,file.id]:selected.filter(id=>id!==file.id))}/><FileIcon size={17}/><span>{file.name}</span><small>{size(file.size)}</small></label>)}</div>
    {!chosen.length&&<p role="status">Selecione pelo menos um arquivo para continuar.</p>}
    {large&&<p>{diskSupported?"Escolha uma pasta com espaço livre para os arquivos selecionados.":"Para receber esta seleção com mais de 200 MB, use Chrome ou Edge em um computador. Você também pode desmarcar arquivos para receber um lote menor."}</p>}
    {error&&<p className="selection-error" role="alert">{error}</p>}
    <button className="primary" autoFocus disabled={busy||!chosen.length||!words||!confirmed||(large&&!diskSupported)} onClick={onAccept}>{busy?<LoaderCircle className="spin" size={18}/>:<Check size={18}/>} {busy?"Abrindo pasta…":large?"Escolher pasta e receber selecionados":`Receber ${chosen.length} arquivo(s) selecionado(s)`}</button>
    <button className="text-button" disabled={busy} onClick={onReject}>Não receber agora</button>
  </section></div>;
}
