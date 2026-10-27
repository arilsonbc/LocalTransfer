"use client";
import {useLanguage} from "./language-provider";
import { ArrowDownToLine, Check, File as FileIcon, LoaderCircle } from "lucide-react";
import { MAX_MEMORY, type Offer } from "../lib/transfer";
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1e9 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1e9).toFixed(1)} GB`;
export default function ReceiveOffer({ offer, selected, peer, busy, diskSupported, error, onChange, onAccept, onReject }: {
    offer: Offer;
    selected: string[];
    peer: string;
    busy: boolean;
    diskSupported: boolean;
    error: string;
    onChange: (ids: string[]) => void;
    onAccept: () => void;
    onReject: () => void;
}) {
    const { t } = useLanguage();
    const chosen = offer.files.filter(f => selected.includes(f.id));
    const total = chosen.reduce((n, f) => n + f.size, 0), large = total > MAX_MEMORY;
    return <div className="modal-backdrop"><section className="receive-modal selective-offer" role="dialog" aria-modal="true" aria-labelledby="receive-title">
    <span className="success-icon"><ArrowDownToLine size={30}/></span><span className="card-kicker">{t("ARQUIVOS DE ")}{peer || t("OUTRO APARELHO")}</span>
    <h2 id="receive-title">{t("Quais arquivos deseja receber?")}</h2><p id="selection-summary" aria-live="polite">{chosen.length}{t(" de ")}{offer.files.length}{t(" arquivo(s) selecionado(s) · ")}{size(total)}</p>
    {!offer.selectable && <p>{t("Para escolher apenas alguns arquivos, atualize o site no aparelho que envia. Nesta conexão, você pode receber o lote completo.")}</p>}
    <div className="selection-actions"><button className="text-button" disabled={busy || !offer.selectable || chosen.length === offer.files.length} onClick={() => onChange(offer.files.map(f => f.id))}>{t("Marcar todos")}</button><button className="text-button" disabled={busy || !offer.selectable || !chosen.length} onClick={() => onChange([])}>{t("Desmarcar todos")}</button></div>
    <div className="offer-files selectable-files" role="group" aria-label={t("Arquivos disponíveis")} aria-describedby="selection-summary">{offer.files.map(file => <label key={file.id} className="offer-file-choice"><input type="checkbox" checked={selected.includes(file.id)} disabled={busy || !offer.selectable} onChange={event => onChange(event.target.checked ? [...selected, file.id] : selected.filter(id => id !== file.id))}/><FileIcon size={17}/><span>{file.name}</span><small>{size(file.size)}</small></label>)}</div>
    {!chosen.length && <p role="status">{t("Selecione pelo menos um arquivo para continuar.")}</p>}
    {large && <p>{diskSupported ? t("Escolha uma pasta com espaço livre para os arquivos selecionados.") : t("Para receber esta seleção com mais de 200 MB, use Chrome ou Edge em um computador. Você também pode desmarcar arquivos para receber um lote menor.")}</p>}
    {error && <p className="selection-error" role="alert">{t(error)}</p>}
    <button className="primary" autoFocus disabled={busy || !chosen.length || (large && !diskSupported)} onClick={onAccept}>{busy ? <LoaderCircle className="spin" size={18}/> : <Check size={18}/>} {busy ? t("Abrindo pasta…") : large ? t("Escolher pasta e receber selecionados") : t("Receber {0} arquivo(s) selecionado(s)", [chosen.length])}</button>
    <button className="text-button" disabled={busy} onClick={onReject}>{t("Não receber agora")}</button>
  </section></div>;
}
