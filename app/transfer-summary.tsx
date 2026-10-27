"use client";
import {useLanguage} from "./language-provider";
import { formatDuration, type BatchSummary } from "../lib/transfer-summary";
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1e9 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1e9).toFixed(1)} GB`;
const outcomes = { completed: "Lote concluído", rejected: "Recebimento recusado", cancelled: "Lote cancelado", failed: "Lote interrompido por falha" };
export default function TransferSummary({ summary: s }: {
    summary: BatchSummary;
}) {
    const { t } = useLanguage();
    return <section className="batch-report flow-card" aria-label={t("Resumo da transfer\u00EAncia")}>
    <h2>{t("Resumo da transfer\u00EAncia")}</h2><p>{t(outcomes[s.outcome])}{t(" \u00B7 Neste aparelho: ")}{s.direction === "send" ? t("envio") : t("recebimento")}</p>
    <dl className="batch-report-grid">{[
            [t("Enviados"), s.sent], [t("Recebidos"), s.received], [t("Recusados"), s.refused], [t("Cancelados"), s.cancelled], [t("Falhas / n\u00E3o conclu\u00EDdos"), s.failed],
            [t("Total do lote"), size(s.totalBytes)], [t("Arquivos conclu\u00EDdos"), size(s.completedBytes)], [t("Dura\u00E7\u00E3o"), formatDuration(s.durationMs)]
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <small>{t("Resumo deste lote: ")}{s.offered}{t(" arquivo(s) oferecido(s). Enviados contam apenas os arquivos confirmados pelo destino; recebidos contam os conclu\u00EDdos neste aparelho. Recusados n\u00E3o foram selecionados ou aceitos. A dura\u00E7\u00E3o inclui espera pelo aceite, pausas e reconex\u00F5es.")}</small>
  </section>;
}
