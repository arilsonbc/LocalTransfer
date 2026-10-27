"use client";
import {useLanguage} from "./language-provider";
import { ArrowDownToLine, UploadCloud, Pause, Play, ShieldCheck } from "lucide-react";
import { formatRemaining, type TransferStats } from "../lib/progress";
export type FileProgress = {
    name: string;
    current: number;
    total: number;
    direction: string;
    stats?: TransferStats;
};
export type PauseState = {
    local: boolean;
    remote: boolean;
    supported: boolean;
};
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1e9 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1e9).toFixed(1)} GB`;
export default function TransferProgress({ progress, pause, reconnecting, awake, canSkip, onSkip, onPause, onCancel, onReconnect }: {
    progress: FileProgress | null;
    pause: PauseState;
    reconnecting: boolean;
    awake: boolean;
    canSkip: boolean;
    onSkip: () => void;
    onPause: () => void;
    onCancel: () => void;
    onReconnect: () => void;
}) {
    const { t } = useLanguage();
    const paused = pause.local || pause.remote;
    const label = reconnecting ? t("Recuperando a conexão…") : paused ? t("Transferência pausada") : progress?.direction === "receive" ? t("Recebendo") : t("Enviando");
    return <section className="progress-card" aria-label={t("Andamento da transferência")}>
    <div><span className="progress-icon">{paused ? <Pause size={23}/> : progress?.direction === "receive" ? <ArrowDownToLine size={23}/> : <UploadCloud size={23}/>}</span><div><strong>{progress?.name || t("Aguardando aceitar no outro aparelho…")}</strong><small>{progress ? t("{0} · {1} de {2}",[label,size(progress.current),size(progress.total)]) : t("Nenhum arquivo é enviado antes da confirmação.")}</small></div></div>
    {progress?.stats && <div className="transfer-stats"><span>{progress.stats.percent.toFixed(0)}{t("% do lote · Arquivo ")}{progress.stats.fileNumber}{t(" de ")}{progress.stats.fileCount}</span><span>{reconnecting ? t("Reconectando…") : paused ? t("Pausado") : progress.stats.bytesPerSecond > 0 ? `${size(progress.stats.bytesPerSecond)}/s` : t("Medindo velocidade…")}</span><span>{reconnecting || paused ? t("Os dados recebidos estão preservados") : t(formatRemaining(progress.stats.secondsRemaining))}</span></div>}
    <progress max={progress?.stats?.total || progress?.total || 1} value={progress?.stats?.bytes || progress?.current || 0}/>
    {paused && <p className="pause-explanation" role="status">{pause.local && pause.remote ? t("Os dois aparelhos pausaram. Cada um precisa tocar em Continuar para retomar.") : pause.local ? t("Você pausou. Toque em Continuar quando quiser retomar.") : t("O outro aparelho pausou. Aguarde ele continuar a transferência.")}</p>}
    <div className="transfer-actions">
      {progress && pause.supported && <button className="secondary" disabled={reconnecting || (!pause.local && pause.remote)} onClick={onPause}>{pause.local ? <Play size={17}/> : <Pause size={17}/>} {pause.local ? t("Continuar transferência") : pause.remote ? t("Pausado no outro aparelho") : t("Pausar transferência")}</button>}
      {progress && canSkip && !reconnecting && <button className="secondary" onClick={onSkip}>{t("Cancelar somente este arquivo")}</button>}
      <button className="text-button" onClick={onCancel}>{t("Cancelar transferência")}</button>
    </div>
    <small className="integrity-note"><ShieldCheck size={14}/>{t(" A integridade de cada arquivo será conferida antes de concluir, quando os dois aparelhos estiverem atualizados.")}</small>
    <small className="awake-note">{awake ? t("Tela mantida ligada durante a transferência.") : t("Mantenha esta página aberta.")}{t(" A retomada funciona enquanto as duas páginas permanecerem abertas.")}</small>
    <details className="connection-options"><summary>{t("Problemas com a conexão?")}</summary><p>{t("Uma nova tentativa preserva o que já foi recebido. Não feche as páginas nem remova os arquivos selecionados.")}</p><button className="secondary" disabled={reconnecting} onClick={onReconnect}>{t("Reconectar agora")}</button></details>
  </section>;
}
