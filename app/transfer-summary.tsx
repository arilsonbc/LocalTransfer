import {formatDuration,type BatchSummary} from "../lib/transfer-summary";
const size=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:n<1e9?`${(n/1048576).toFixed(1)} MB`:`${(n/1e9).toFixed(1)} GB`;
const outcomes={completed:"Lote concluído",rejected:"Recebimento recusado",cancelled:"Lote cancelado",failed:"Lote interrompido por falha"};
export default function TransferSummary({summary:s}:{summary:BatchSummary}){
  return <section className="batch-report flow-card" aria-label="Resumo da transferência">
    <h2>Resumo da transferência</h2><p>{outcomes[s.outcome]} · Neste aparelho: {s.direction==="send"?"envio":"recebimento"}</p>
    <dl className="batch-report-grid">{[
      ["Enviados",s.sent],["Recebidos",s.received],["Recusados",s.refused],["Cancelados",s.cancelled],["Falhas / não concluídos",s.failed],
      ["Total do lote",size(s.totalBytes)],["Arquivos concluídos",size(s.completedBytes)],["Duração",formatDuration(s.durationMs)]
    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <small>Resumo deste lote: {s.offered} arquivo(s) oferecido(s). Enviados contam apenas os arquivos confirmados pelo destino; recebidos contam os concluídos neste aparelho. Recusados não foram selecionados ou aceitos. A duração inclui espera pelo aceite, pausas e reconexões.</small>
  </section>;
}
