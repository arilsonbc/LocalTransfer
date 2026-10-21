"use client";
import {ArrowDownToLine,UploadCloud,Pause,Play,ShieldCheck} from "lucide-react";
import {formatRemaining,type TransferStats} from "../lib/progress";

export type FileProgress={name:string;current:number;total:number;direction:string;stats?:TransferStats};
export type PauseState={local:boolean;remote:boolean;supported:boolean};
const size=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1e9?`${(n/1048576).toFixed(1)} MB`:`${(n/1e9).toFixed(1)} GB`;
export default function TransferProgress({progress,pause,reconnecting,awake,onPause,onCancel,onReconnect}:{progress:FileProgress|null;pause:PauseState;reconnecting:boolean;awake:boolean;onPause:()=>void;onCancel:()=>void;onReconnect:()=>void}){
  const paused=pause.local||pause.remote;
  const label=reconnecting?"Recuperando a conexão…":paused?"Transferência pausada":progress?.direction==="receive"?"Recebendo":"Enviando";
  return <section className="progress-card" aria-label="Andamento da transferência">
    <div><span className="progress-icon">{paused?<Pause size={23}/>:progress?.direction==="receive"?<ArrowDownToLine size={23}/>:<UploadCloud size={23}/>}</span><div><strong>{progress?.name||"Aguardando aceitar no outro aparelho…"}</strong><small>{progress?`${label} · ${size(progress.current)} de ${size(progress.total)}`:"Nenhum arquivo é enviado antes da confirmação."}</small></div></div>
    {progress?.stats&&<div className="transfer-stats"><span>{progress.stats.percent.toFixed(0)}% do lote · Arquivo {progress.stats.fileNumber} de {progress.stats.fileCount}</span><span>{reconnecting?"Reconectando…":paused?"Pausado":progress.stats.bytesPerSecond>0?`${size(progress.stats.bytesPerSecond)}/s`:"Medindo velocidade…"}</span><span>{reconnecting||paused?"Os dados recebidos estão preservados":formatRemaining(progress.stats.secondsRemaining)}</span></div>}
    <progress max={progress?.stats?.total||progress?.total||1} value={progress?.stats?.bytes||progress?.current||0}/>
    {paused&&<p className="pause-explanation" role="status">{pause.local&&pause.remote?"Os dois aparelhos pausaram. Cada um precisa tocar em Continuar para retomar.":pause.local?"Você pausou. Toque em Continuar quando quiser retomar.":"O outro aparelho pausou. Aguarde ele continuar a transferência."}</p>}
    <div className="transfer-actions">
      {progress&&pause.supported&&<button className="secondary" disabled={reconnecting||(!pause.local&&pause.remote)} onClick={onPause}>{pause.local?<Play size={17}/>:<Pause size={17}/>} {pause.local?"Continuar transferência":pause.remote?"Pausado no outro aparelho":"Pausar transferência"}</button>}
      <button className="text-button" onClick={onCancel}>Cancelar transferência</button>
    </div>
    <small className="integrity-note"><ShieldCheck size={14}/> A integridade de cada arquivo será conferida antes de concluir, quando os dois aparelhos estiverem atualizados.</small>
    <small className="awake-note">{awake?"Tela mantida ligada durante a transferência.":"Mantenha esta página aberta."} A retomada funciona enquanto as duas páginas permanecerem abertas.</small>
    <details className="connection-options"><summary>Problemas com a conexão?</summary><p>Uma nova tentativa preserva o que já foi recebido. Não feche as páginas nem remova os arquivos selecionados.</p><button className="secondary" disabled={reconnecting} onClick={onReconnect}>Reconectar agora</button></details>
  </section>;
}
