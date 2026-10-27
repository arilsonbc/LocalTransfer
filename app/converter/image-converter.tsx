"use client";
import {useLanguage} from "../language-provider";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ImagePlus, Download, ShieldCheck } from "lucide-react";
import TopBar from "../top-bar";
import { convertImage, IMAGE_LIMITS, validateImage, type ImageFormat } from "../../lib/image-converter";
import { archiveFiles } from "../../lib/archive";
import "./image-converter.css";
type Result = {
    id: string;
    original: string;
    originalBytes: number;
    name?: string;
    blob?: Blob;
    url?: string;
    width?: number;
    height?: number;
    error?: string;
};
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export default function ImageConverter() {
    const { t } = useLanguage();
    const [files, setFiles] = useState<File[]>([]), [format, setFormat] = useState<ImageFormat>("jpeg"), [quality, setQuality] = useState(80), [maxEdge, setMaxEdge] = useState(1920);
    const [results, setResults] = useState<Result[]>([]), [busy, setBusy] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
    const [zip, setZip] = useState<string | null>(null), [zipping, setZipping] = useState(false);
    const picker = useRef<HTMLInputElement>(null), generation = useRef(0), urls = useRef<string[]>([]);
    useEffect(() => () => { generation.current++; urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
    function clearResults() { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; setResults([]); setZip(null); }
    function select(list: FileList | null) {
        if (!list?.length || busy || zipping)
            return;
        const next = Array.from(list);
        try {
            if (next.length > IMAGE_LIMITS.files || next.reduce((n, f) => n + f.size, 0) > IMAGE_LIMITS.batchBytes)
                throw new Error(t("Escolha até 20 fotos, com até 100 MB no total."));
            next.forEach(validateImage);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : t("Não foi possível selecionar as fotos."));
            return;
        }
        generation.current++;
        clearResults();
        setFiles(next);
        setError("");
        setStatus("");
    }
    async function convert() {
        if (!files.length || busy || zipping)
            return;
        const run = ++generation.current;
        clearResults();
        setBusy(true);
        setError("");
        let converted = 0, totalBytes = 0;
        try {
            for (let i = 0; i < files.length; i++) {
                if (run !== generation.current)
                    break;
                const file = files[i];
                setStatus(t("Convertendo {0} de {1}: {2}", [i + 1, files.length, file.name]));
                let result: Result;
                try {
                    const output = await convertImage(file, { format, quality: quality / 100, maxEdge });
                    if (run !== generation.current)
                        break;
                    if (totalBytes + output.blob.size > IMAGE_LIMITS.batchBytes)
                        throw new Error(t("O resultado ultrapassa 100 MB. Reduza as dimensões ou selecione menos fotos."));
                    totalBytes += output.blob.size;
                    const url = URL.createObjectURL(output.blob);
                    urls.current.push(url);
                    converted++;
                    result = { id: String(i), original: file.name, originalBytes: file.size, ...output, url };
                }
                catch (e) {
                    if (run !== generation.current)
                        break;
                    result = { id: String(i), original: file.name, originalBytes: file.size, error: e instanceof Error ? e.message : t("Não foi possível converter esta foto.") };
                }
                setResults(old => [...old, result]);
            }
        }
        finally {
            setBusy(false);
            setStatus(run === generation.current ? t("{0} de {1} imagem(ns) convertida(s).", [converted, files.length]) : t("Conversão interrompida. Os resultados concluídos continuam disponíveis."));
        }
    }
    async function prepareZip() {
        if (busy || zipping)
            return;
        const run = generation.current;
        setZipping(true);
        setError("");
        try {
            const blob = await archiveFiles(results.filter(r => r.blob).map(r => ({ name: r.name!, blob: r.blob! })));
            if (run !== generation.current)
                return;
            const url = URL.createObjectURL(blob);
            urls.current.push(url);
            setZip(url);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : t("Não foi possível gerar o ZIP."));
        }
        finally {
            setZipping(false);
        }
    }
    const successful = results.filter(r => r.blob), before = successful.reduce((n, r) => n + r.originalBytes, 0), after = successful.reduce((n, r) => n + r.blob!.size, 0);
    return <div className="guided-app"><TopBar onHome={() => location.assign("/")}/><main className="guided-main converter-main">
    <a className="back-button" href="/"><ArrowLeft size={16}/>{t("Voltar ao LocalTransfer")}</a>
    <div className="eyebrow">{t("FERRAMENTA GRATUITA · SEM LOGIN")}</div><h1>{t("Conversor de imagens")}</h1><p className="converter-lead">{t("Troque o formato das suas fotos e reduza o tamanho para compartilhar com facilidade.")}</p>
    <section className="flow-card converter-settings" aria-label={t("Configurar conversão")}>
      <input className="sr-only" ref={picker} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.avif,.heic,.heif" aria-label={t("Escolher fotos para converter")} onChange={e => { select(e.target.files); e.target.value = ""; }}/>
      <button className="primary" disabled={busy || zipping} onClick={() => picker.current?.click()}><ImagePlus size={20}/>{files.length ? t("Trocar fotos") : t("Selecionar fotos")}</button>
      <p>{files.length ? t("{0} foto(s) selecionada(s) · {1}", [files.length, size(files.reduce((n, f) => n + f.size, 0))]) : t("Até 20 fotos · 20 MB por foto · 100 MB no total")}</p>
      {!!files.length && <details className="converter-files"><summary>{t("Ver fotos selecionadas")}</summary><ul>{files.map((file, i) => <li key={i}>{file.name} · {size(file.size)}</li>)}</ul></details>}
      <div className="converter-controls">
        <label>{t("Formato de saída")}<select aria-label={t("Formato de saída")} value={format} disabled={busy || zipping} onChange={e => setFormat(e.target.value as ImageFormat)}><option value="jpeg">{t("JPG — fotos e arquivos menores")}</option><option value="png">{t("PNG — preserva transparência")}</option><option value="webp">{t("WebP — fotos e transparência")}</option></select></label>
        <label>{t("Maior lado da imagem")}<select aria-label={t("Maior lado da imagem")} value={maxEdge} disabled={busy || zipping} onChange={e => setMaxEdge(Number(e.target.value))}><option value={0}>{t("Manter dimensões (até 4096 px)")}</option><option value={3840}>{t("3840 px — alta resolução")}</option><option value={1920}>{t("1920 px — uso diário")}</option><option value={1280}>{t("1280 px — arquivo menor")}</option><option value={800}>{t("800 px — versão compacta")}</option></select></label>
        <label className="converter-quality">{t("Qualidade: ")}{quality}%<input aria-label={t("Qualidade da imagem")} type="range" min={10} max={100} step={5} value={quality} disabled={busy || zipping || format === "png"} onChange={e => setQuality(Number(e.target.value))}/><small>{format === "png" ? t("PNG não usa o ajuste de qualidade. Reduza as dimensões para diminuir o arquivo.") : t("Qualidade menor costuma gerar arquivos menores, com perda de detalhes.")}</small></label>
      </div>
      <p className="converter-note">{t("A proporção é mantida e imagens pequenas não são ampliadas. Em JPG, áreas transparentes ficam brancas. A saída é estática e não preserva os dados EXIF originais.")}</p>
      <div className="converter-actions"><button className="primary" disabled={!files.length || busy || zipping} onClick={() => void convert()}>{busy ? t("Convertendo…") : results.length ? t("Converter novamente") : t("Converter imagens")}</button>{busy && <button className="secondary" onClick={() => { generation.current++; }}>{t("Parar conversão")}</button>}{!!files.length && !busy && <button className="text-button" disabled={zipping} onClick={() => { generation.current++; clearResults(); setFiles([]); setStatus(""); setError(""); }}>{t("Limpar tudo")}</button>}</div>
    </section>
    {error && <p className="error-message" role="alert">{t(error)}</p>}<p className="converter-status" role="status" aria-live="polite">{t(status)}</p>
    {!!results.length && <section className="flow-card converter-results" aria-label={t("Imagens convertidas")}><h2>{t("Suas imagens")}</h2>
      {!!successful.length && <p>{size(before)}{t(" no original → ")}{size(after)}{t(" convertido(s). ")}{after < before ? t("{0}% menor.", [Math.round((1 - after / before) * 100)]) : after > before ? t("Este resultado ficou maior que o original. Tente reduzir a qualidade ou as dimensões.") : t("O tamanho não mudou.")}</p>}
      {successful.length > 1 && <div className="converter-actions">{zip ? <a className="primary" href={zip} download="LocalTransfer-imagens.zip">{t("Baixar todas em ZIP")}</a> : <button className="secondary" disabled={busy || zipping} onClick={() => void prepareZip()}>{zipping ? t("Preparando ZIP…") : t("Preparar ZIP com todas")}</button>}</div>}
      <div className="converter-result-list">{results.map(result => <article className="converter-result" key={result.id}>
        {result.url && <img src={result.url} alt={t("Prévia convertida de {0}", [result.original])} loading="lazy"/>}<div><h3>{result.original}</h3>{result.error ? <p role="alert">{t(result.error!)}</p> : <><p>{result.width} × {result.height} px · {size(result.originalBytes)} → {size(result.blob!.size)}</p><small>{result.name}</small><a className="secondary" href={result.url} download={result.name}><Download size={16}/>{t("Baixar imagem")}</a></>}</div>
      </article>)}</div>
    </section>}
    <p className="converter-privacy"><ShieldCheck size={20}/>{t("Suas fotos são processadas neste aparelho. Não são enviadas ao servidor.")}</p><p className="converter-note">{t("JPG, PNG, WebP e AVIF podem ser abertos conforme o navegador. HEIC/HEIF depende do aparelho e pode não funcionar. Limite de entrada: 40 megapixels. Baixe os resultados antes de fechar a página; seus arquivos originais não são alterados.")}</p>
  </main><footer className="site-footer"><span>LocalTransfer</span><span>{t("Ferramentas simples para o dia a dia.")}</span></footer></div>;
}
