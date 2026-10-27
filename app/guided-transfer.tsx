"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Check, CheckCheck, Copy, File as FileIcon, HelpCircle, LoaderCircle, LockKeyhole, Plus, ShieldCheck, UploadCloud, X } from "lucide-react";
import { api, MAX_BATCH, MAX_MEMORY, MAX_FILES, safeFilename, TransferConnection, type ConnectionDiagnostics, type FileInfo, type Offer, type Session } from "../lib/transfer";
import {canSaveToDisk,chooseReceiveFolder} from "../lib/disk-receiver";
import TopBar from "./top-bar";
import InviteCard from "./invite-card";
import {readInvite} from "../lib/invite";
import {type TransferStats} from "../lib/progress";
import TransferProgress,{type PauseState} from "./transfer-progress";
import FileThumbnail from "./file-thumbnail";
import ReceiveOffer from "./receive-offer";
import {archiveFiles} from "../lib/archive";
import {useKeepAwake} from "./use-keep-awake";

type Mode = "choose" | "send" | "receive";
type Received = FileInfo & { url: string|null;preview:Blob|null;blob:Blob|null };
type Progress = { name: string; current: number; total: number; direction: string;stats?:TransferStats };
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1_000_000_000 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1_000_000_000).toFixed(1)} GB`;
const prettyCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

export default function GuidedTransfer() {
  const [mode, setMode] = useState<Mode>("choose");
  const [files, setFiles] = useState<File[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("Computador");
  const [peer, setPeer] = useState("");
  const [state, setState] = useState("idle");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const offeredId=useRef<string|null>(null);
  const [acceptedCount,setAcceptedCount]=useState(0);
  const [skipped,setSkipped]=useState<string[]>([]);
  const [archiving,setArchiving]=useState(false);
  const [archiveUrl,setArchiveUrl]=useState<string|null>(null);
  const [received, setReceived] = useState<Received[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [turnNotice,setTurnNotice]=useState("");
  const [pause,setPause]=useState<PauseState>({local:false,remote:false,supported:false});
  const [verified,setVerified]=useState<Record<string,boolean>>({});
  const [copied, setCopied] = useState(false);
  const [complete, setComplete] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [diskSupported,setDiskSupported]=useState(false);
  const [destination,setDestination]=useState("");
  const [choosingFolder,setChoosingFolder]=useState(false);
  const [diagnostics,setDiagnostics]=useState<ConnectionDiagnostics|null>(null);
  const [diagnosticCopied,setDiagnosticCopied]=useState(false);
  const [offline,setOffline]=useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const connection = useRef<TransferConnection | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const urls = useRef<string[]>([]);
  const retainedBytes = useRef(0);
  const autoStarted = useRef(false);
  const epoch = useRef(0);
  const total = files.reduce((n, f) => n + f.size, 0);
  const connected = state === "connected";
  const transferActive=!complete && (sending || !!progress);
  const hasUnsavedFiles=received.some(file=>!!file.url);
  const awake=useKeepAwake((sending || !!progress)&&!pause.local&&!pause.remote);

  useEffect(() => {
    const ua = navigator.userAgent;
    setDiskSupported(canSaveToDisk());
    setName(/iPhone|iPad/i.test(ua) ? "iPhone / iPad" : /Android/i.test(ua) ? "Android" : /Macintosh/i.test(ua) ? "Mac" : "Computador");
    const invite = new URLSearchParams(location.hash.slice(1)).get("sala");
    if (invite && readInvite(invite)) { setMode("receive"); setCode(readInvite(invite)!); }
    return () => { connection.current?.close(); urls.current.forEach(u => URL.revokeObjectURL(u)); };
  }, []);

  useEffect(()=>{
    const recover=()=>{if(connection.current?.reconnecting)connection.current.retry();};
    const visible=()=>{if(document.visibilityState==="visible")recover();};
    window.addEventListener("online",recover);document.addEventListener("visibilitychange",visible);
    return ()=>{window.removeEventListener("online",recover);document.removeEventListener("visibilitychange",visible);};
  },[]);

  useEffect(() => {
    if (!transferActive && !hasUnsavedFiles) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [transferActive, hasUnsavedFiles]);

  useEffect(()=>{
    const update=()=>setOffline(!navigator.onLine);
    update();window.addEventListener("online",update);window.addEventListener("offline",update);
    return ()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update);};
  },[]);

  // Connecting is sufficient: no second Send button is needed after pairing.
  useEffect(() => {
    if (mode === "send" && connected && files.length && !autoStarted.current) {
      autoStarted.current = true;
      void sendFiles();
    }
  }, [mode, connected, files]); // sendFiles uses the selected batch for this connection.

  function remember(direction: "send" | "receive", count: number) {
    try {
      const old = JSON.parse(localStorage.getItem("localtransfer-history") || "[]");
      localStorage.setItem("localtransfer-history", JSON.stringify([{ id: crypto.randomUUID(), direction, count, time: new Date().toISOString() }, ...(Array.isArray(old) ? old : [])].slice(0, 30)));
    } catch { /* Saving a local record is optional. */ }
  }

  function attach(s: Session, currentEpoch: number) {
    if (currentEpoch !== epoch.current) {
      void api(`/api/rooms/${s.code}`, "DELETE", undefined, s.token).catch(() => {});
      return;
    }
    sessionRef.current = s; setSession(s); setPeer(s.peerName || ""); setState("connecting");setDiagnostics(null);setDiagnosticCopied(false);
    const active = () => epoch.current === currentEpoch;
    setVerified({});setSkipped([]);setPause({local:false,remote:false,supported:false});
    const conn = new TransferConnection(s, {
      skipped:name=>{if(active())setSkipped(old=>[...old,name]);},
      selection:count=>{if(active())setAcceptedCount(count);},
      pause:(local,remote,supported)=>{if(active())setPause({local,remote,supported});},
      integrity:(id,value)=>{if(active())setVerified(old=>({...old,[id]:value}));},
      notice: message=>{if(active())setTurnNotice(message);},
      state: (next, message) => { if (active()) { setState(next); setStatus(message); } },
      peer: value => { if (active()) setPeer(value); },
      offer: incoming => {
        if (!active()) return;
        if(incoming&&offeredId.current!==incoming.id){setComplete(false);setSkipped([]);setVerified({});setSelectedIds(incoming.files.map(f=>f.id));setError("");}
        offeredId.current=incoming?.id||null;
        setOffer(incoming);
      },
      progress: (fileName, current, fileTotal, direction,stats) => { if (active()) setProgress({ name: fileName, current, total: fileTotal, direction,stats }); },
      file: (info, blob,preview) => {
        if (!active()) return;
        const url = blob?URL.createObjectURL(blob):null;
        if(url && blob){urls.current.push(url);retainedBytes.current+=blob.size;}
        setArchiveUrl(null);setReceived(old => [...old, { ...info, name: safeFilename(info.name), url,blob,preview:preview||blob }]);
      },
      complete: (direction, count) => {
        if (!active()) return;
        setAcceptedCount(count);setComplete(true); setProgress(null); setSending(false); remember(direction, count);
      },
      error: message => { if (active()) { setError(message); setSending(false); setProgress(null);setDiagnostics(connection.current?.diagnostics||null); } },
    },new URLSearchParams(location.search).get("relay")==="1");
    connection.current = conn; void conn.start();
  }

  async function createCode() {
    const currentEpoch = epoch.current;
    setLoading(true); setError("");
    try {
      if (!window.RTCPeerConnection) throw new Error("Abra este site em um navegador atualizado, como Safari, Chrome, Edge ou Firefox.");
      attach(await api<Session>("/api/rooms", "POST", { name }), currentEpoch);
    } catch (e) { if (epoch.current === currentEpoch) setError(e instanceof Error ? e.message : "Não foi possível gerar o código."); }
    finally { if (epoch.current === currentEpoch) setLoading(false); }
  }

  function chooseFiles(list: FileList | File[] | null) {
    if (!list?.length || sending) return;
    const next = [...files];
    for (const f of Array.from(list)) if (!next.some(old => old.name === f.name && old.size === f.size && old.lastModified === f.lastModified)) next.push(f);
    if (next.length > MAX_FILES || next.reduce((n, f) => n + f.size, 0) > MAX_BATCH) {
      setError("Escolha até 500 arquivos e 100 GB por vez. Você pode enviar outros depois."); return;
    }
    setFiles(next); setError(""); setComplete(false);
    if (!sessionRef.current && !loading) void createCode();
  }

  async function join() {
    const normalized = readInvite(code)||"";
    if (normalized.length !== 8) { setError("Digite os 8 caracteres mostrados no aparelho que vai enviar."); return; }
    const currentEpoch = epoch.current;
    setLoading(true); setError("");
    try {
      if (!window.RTCPeerConnection) throw new Error("Use um navegador atualizado para receber os arquivos.");
      attach(await api<Session>(`/api/rooms/${encodeURIComponent(normalized)}/join`, "POST", { name }), currentEpoch);
    } catch (e) { if (epoch.current === currentEpoch) setError(e instanceof Error ? e.message : "Confira o código e tente novamente."); }
    finally { if (epoch.current === currentEpoch) setLoading(false); }
  }

  async function sendFiles() {
    const conn = connection.current;
    if (!conn || !files.length) return;
    setSending(true); setError(""); setComplete(false);
    try { await conn.send(files); }
    catch (e) { if (connection.current === conn) setError(e instanceof Error ? e.message : "O envio foi interrompido."); }
    finally { if (connection.current === conn) { setSending(false); setProgress(null); } }
  }

  function disconnect() {
    epoch.current++; connection.current?.close(); connection.current = null;
    const old = sessionRef.current; sessionRef.current = null;
    if (old) void api(`/api/rooms/${old.code}`, "DELETE", undefined, old.token).catch(() => {});
    setSelectedIds([]);offeredId.current=null;setAcceptedCount(0);setSession(null); setState("idle"); setStatus(""); setPeer(""); setSending(false); setLoading(false);setTurnNotice("");
    setOffer(null); setProgress(null); setComplete(false); setError("");setPause({local:false,remote:false,supported:false});setVerified({});setDiagnostics(null);setDiagnosticCopied(false); autoStarted.current = false;
  }

  function restart(next: Mode = "choose") {
    if(transferActive && !window.confirm("A transferência ainda não terminou. Voltar ao início vai interrompê-la. Deseja sair mesmo assim?"))return;
    disconnect(); setFiles([]); setCode(""); setMode(next); setCopied(false);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  function nextBatch(){
    setFiles([]);setComplete(false);setProgress(null);setError("");setVerified({});setSkipped([]);setAcceptedCount(0);autoStarted.current=false;
  }

  async function saveAll(){
    if(archiving)return;setArchiving(true);setError("");
    const batch=received.filter(f=>f.blob);
    try{const zip=await archiveFiles(batch.map(f=>({name:f.name,blob:f.blob!})));const url=URL.createObjectURL(zip);urls.current.push(url);setArchiveUrl(url);}
    catch(e){setError(e instanceof Error?e.message:"Não foi possível preparar o ZIP.");}
    finally{setArchiving(false);}
  }

  function clearReceived() {
    if(archiving)return;setArchiveUrl(null);
    urls.current.forEach(u => URL.revokeObjectURL(u)); urls.current = []; retainedBytes.current = 0; setReceived([]);
  }

  async function acceptOffer() {
    const conn=connection.current;
    if(!conn || !offer || choosingFolder)return;
    const currentEpoch=epoch.current;
    const selected=offer.files.filter(f=>selectedIds.includes(f.id));
    if(!selected.length){setError("Escolha pelo menos um arquivo para receber.");return;}
    const total=selected.reduce((n,file)=>n+file.size,0);
    if(total<=MAX_MEMORY){
      if(retainedBytes.current+total>MAX_MEMORY){setError("Salve e limpe os arquivos que já chegaram, ou selecione menos arquivos para receber.");return;}
      setDestination("");setError("");conn.accept(undefined,offer.id,selectedIds);return;
    }
    setChoosingFolder(true);setError("");
    try {
      const folder=await chooseReceiveFolder();
      if(epoch.current!==currentEpoch || connection.current!==conn || !conn.busy)return;
      setDestination(folder.name);conn.accept(folder.open,offer.id,selectedIds);
    } catch(e) {
      if(epoch.current===currentEpoch && !(e instanceof DOMException && e.name==="AbortError"))setError("Não foi possível abrir a pasta. Escolha uma pasta em que você possa salvar arquivos e tente novamente.");
    } finally {setChoosingFolder(false);}
  }

  async function copyCode() {
    if (!session) return;
    try { await navigator.clipboard.writeText(session.code); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError("Não foi possível copiar automaticamente. Selecione o código e copie ou digite no outro aparelho."); }
  }

  const sendingStep = complete ? 3 : session ? 2 : 1;
  const receivingStep = complete ? 3 : session ? 2 : 1;

  return <div className="guided-app">
    <TopBar onHome={() => { if (mode !== "choose") restart(); }} />
    <main className="guided-main">
      {mode === "choose" ? <section className="welcome">
        <div className="eyebrow"><span />SEM INSTALAR NADA</div>
        <h1>O que você quer fazer?</h1>
        <p className="lead">Envie fotos e arquivos entre o celular e o computador.<br />{" "}Escolha o que quer fazer <strong>neste aparelho</strong>.</p>
        <div className="choice-grid">
          <button className="choice-card send-choice" onClick={() => { setError(""); setMode("send"); }}><span className="choice-icon"><ArrowUpRight size={34} /></span><h2>Enviar arquivos</h2><p>Os arquivos estão aqui e quero<br />{" "}mandar para outro aparelho.</p><span className="choice-action">Escolher o que enviar<ArrowRight size={18} /></span></button>
          <button className="choice-card receive-choice" onClick={() => { setError(""); setMode("receive"); }}><span className="choice-icon"><ArrowDownToLine size={30} /></span><h2>Receber arquivos</h2><p>Quero receber e salvar os arquivos<br />{" "}neste aparelho.</p><span className="choice-action">Digitar o código<ArrowRight size={18} /></span></button>
        </div>
        <div className="example"><span className="example-icon"><HelpCircle size={20} /></span><p><strong>Vai passar fotos do celular para o computador?</strong><br />{" "}No celular, escolha <b>Enviar</b>. No computador, escolha <b>Receber</b>.</p></div>
      </section> : <section className="flow-page">
        <button className="back-button" onClick={() => restart()}><ArrowLeft size={16} />Voltar ao início</button>
        <div className="flow-title"><span className={`flow-icon ${mode}`} >{mode === "send" ? <ArrowUpRight size={27} /> : <ArrowDownToLine size={25} />}</span><div><div className="eyebrow">NESTE APARELHO</div><h1>{mode === "send" ? "Enviar arquivos" : "Receber arquivos"}</h1></div></div>
        <ol className="steps" aria-label="Etapas da transferência">{(mode === "send" ? ["Escolher arquivos", "Compartilhar código", "Concluir envio"] : ["Digitar código", "Receber arquivos", "Salvar arquivos"]).map((label, index) => {
          const activeStep = mode === "send" ? sendingStep : receivingStep;
          return <li key={label} className={index + 1 === activeStep ? "current" : index + 1 < activeStep ? "done" : ""} aria-current={index + 1 === activeStep ? "step" : undefined}><span>{index + 1 < activeStep ? <Check size={13} /> : index + 1}</span>{label}</li>;
        })}</ol>

        {mode === "send" ? <>
          <input ref={picker} className="sr-only" type="file" multiple aria-label="Escolher arquivos" onChange={e => { chooseFiles(e.target.files); e.target.value = ""; }} />
          {!files.length ? <section className={`flow-card choose-files ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); chooseFiles(e.dataTransfer.files); }}>
            <span className="large-icon"><UploadCloud size={38} strokeWidth={1.5} /></span><h2>Primeiro, escolha os arquivos.</h2><p>Selecione as fotos, vídeos ou documentos<br />{" "}que você quer enviar para o outro aparelho.</p><button className="primary" onClick={() => picker.current?.click()}><Plus size={20} />Selecionar arquivos</button><small>Até 100 GB por vez · Para receber mais de 200 MB, use Chrome ou Edge no computador.</small>
          </section> : complete ? <section className="flow-card success-card"><span className="success-icon"><CheckCheck size={36} /></span><h2>Arquivos enviados!</h2><p>{acceptedCount} de {files.length} arquivo(s) foram aceitos e chegaram ao outro aparelho.<br />{" "}Confira os arquivos no aparelho que recebeu.</p><p className="integrity-badge">{acceptedCount>0&&Object.values(verified).filter(Boolean).length===acceptedCount?"Integridade SHA-256 confirmada em todos os arquivos.":"Verificação adicional indisponível. Atualize as duas páginas nos próximos envios."}</p><button className="primary" onClick={nextBatch}><Plus size={18} />Enviar outros arquivos</button><button className="text-button" onClick={() => restart()}>Voltar ao início</button></section> : <section className="flow-card code-card">
            {session ? <><span className="card-kicker">{connected ? "APARELHOS CONECTADOS" : "AGORA, NO OUTRO APARELHO"}</span><h2>{state==="reconnecting" ? "Recuperando a conexão…" : connected ? (sending ? (progress ? (pause.local||pause.remote?"Transferência pausada.":"Enviando seus arquivos…") : "Só falta aceitar do outro lado.") : "Pronto para enviar.") : "Escolha Receber e digite este código."}</h2><p>{connected ? <>Conectado com <strong>{peer || "o outro aparelho"}</strong>.</> : "Abra este mesmo site no aparelho que vai receber os arquivos."}</p><div className="code-display" aria-label={`Código para receber: ${session.code}`}>{prettyCode(session.code)}</div><button className="secondary" onClick={() => void copyCode()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Código copiado" : "Copiar código"}</button>{!connected && state!=="reconnecting" && <InviteCard code={session.code}/>}<div className={`connection-note ${connected ? "connected" : ""}`} role="status">{connected ? <Check size={15} /> : <LoaderCircle size={15} className="spin" />}<span>{connected ? (progress ? "Mantenha as duas páginas abertas até terminar." : "O envio começa após a confirmação no outro aparelho.") : state==="reconnecting" ? status : "Aguardando o outro aparelho digitar o código…"}</span></div>{state === "error" && <button className="primary" onClick={() => { disconnect(); void createCode(); }}>Gerar outro código</button>}{connected && !sending && error && <button className="primary" onClick={() => void sendFiles()}>Tentar enviar novamente<ArrowRight size={17} /></button>}<small>O código vale por 20 minutos. Compartilhe apenas com quem vai receber.</small></> : <><span className="large-icon"><LoaderCircle size={33} className={loading ? "spin" : ""} /></span><h2>{loading ? "Preparando seu código…" : "Seus arquivos estão selecionados."}</h2><p>{loading ? "Já vamos mostrar o código para conectar o outro aparelho." : "Toque abaixo para gerar o código de recebimento."}</p>{!loading && <button className="primary" onClick={() => void createCode()}>Gerar código<ArrowRight size={17} /></button>}</>}
            <div className="batch-summary"><FileIcon size={19} /><span><strong>{files.length} arquivo(s) selecionado(s)</strong><small>{size(total)}</small></span>{!connected && !loading && <button className="text-button" onClick={() => picker.current?.click()}>Adicionar mais<Plus size={14} /></button>}</div>
            <details className="file-details"><summary>Ver arquivos selecionados</summary>{files.map((file, i) => <div className="file-line" key={`${file.name}-${i}`}><FileThumbnail file={file} name={file.name}/><span>{file.name}</span><small>{size(file.size)}</small></div>)}</details>
          </section>}
        </> : <>
          {!session ? <form className="flow-card receive-form" onSubmit={e => { e.preventDefault(); if (!loading) void join(); }}><span className="large-icon blue"><ArrowDownToLine size={34} /></span><h2>Qual é o código de envio?</h2><p>No outro aparelho, escolha <strong>Enviar arquivos</strong><br />{" "}e selecione o que deseja enviar. O código aparecerá lá.</p><label htmlFor="receive-code">Digite ou cole o código do outro aparelho</label><input id="receive-code" className="code-input" autoFocus value={code} onChange={e => setCode(readInvite(e.target.value)||e.target.value.toUpperCase().replace(/[^A-Z2-9\s-]/g, ""))} placeholder="ABCD EFGH" onPaste={event=>{const pasted=readInvite(event.clipboardData.getData("text"));if(pasted){event.preventDefault();setCode(pasted);}}} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12} disabled={loading} /><button className="primary" type="submit" disabled={loading || code.replace(/[\s-]/g, "").length !== 8}>{loading ? <LoaderCircle className="spin" size={18} /> : <ArrowDownToLine size={18} />}{loading ? "Conectando…" : "Conectar e receber"}</button><small>Você confirma o recebimento antes de os arquivos chegarem.</small></form> : !complete && !progress && <section className="flow-card waiting-card"><span className={`large-icon ${connected ? "" : "blue"}`}>{connected ? <Check size={34} /> : <LoaderCircle className="spin" size={34} />}</span><h2>{connected ? "Conectado! Aguarde os arquivos." : state==="reconnecting" ? "Recuperando a conexão…" : state === "error" ? "Não conseguimos conectar." : "Conectando os aparelhos…"}</h2><p>{connected ? <>O pedido de recebimento vai aparecer aqui.<br />{" "}Quando aparecer, escolha os arquivos e confirme o recebimento.</> : state==="reconnecting" ? "Mantenha esta página aberta. A transferência continuará do ponto recebido quando a internet voltar." : "Mantenha esta página aberta. Isso pode levar alguns segundos."}</p><div className="connection-note" role="status">{connected ? <LockKeyhole size={14} /> : null}{connected ? `Conexão com ${peer || "o outro aparelho"}` : status}</div><button className="text-button" onClick={() => { disconnect(); }}>Tentar outro código<ArrowLeft size={14} /></button></section>}
          {complete && <div className="received-heading"><span className="success-icon"><CheckCheck size={30} /></span><h2>Seus arquivos chegaram!</h2><p>{destination ? <>Arquivos salvos na pasta <strong>{destination}</strong>.</> : <>Toque em <strong>Salvar</strong> em cada arquivo para guardá-lo neste aparelho.</>}</p></div>}
        </>}

        {session && !complete && <section className="connection-health" aria-label="Estado da conexão" role="status">
          <strong>{offline?"Este aparelho está sem internet":state==="error"?"Não foi possível conectar":state==="reconnecting"?"Tentando reconectar os aparelhos…":connected?"Aparelhos conectados":state==="waiting"?"Aguardando o outro aparelho":"Conectando os aparelhos…"}</strong>
          <p>{offline?"Ative o Wi-Fi ou os dados móveis. Mantenha as duas páginas abertas; tentaremos continuar quando a internet voltar.":state==="error"?"Confira a internet nos dois aparelhos. Se estiverem conectados, crie outro código e tente novamente.":state==="reconnecting"?status:connected?"A conexão está pronta. Os arquivos só são enviados depois do aceite de quem recebe.":status||"Preparando a conexão segura. Isso pode levar alguns segundos."}</p>
          {(offline||state==="reconnecting")&&<small>Não atualize nem feche as páginas. Uma transferência em andamento pode continuar do ponto confirmado.</small>}
        </section>}
        {transferActive&&<p className="leave-warning" role="note">Transferência em andamento: não feche nem atualize esta página, mesmo durante uma pausa. Ao sair, você poderá precisar começar novamente.</p>}
        {skipped.length>0&&<div className="skip-summary" role="status"><strong>{skipped.length} arquivo(s) cancelado(s)</strong><ul>{skipped.map((name,i)=><li key={i}>{name}</li>)}</ul><p>Os outros arquivos continuam normalmente. Arquivos cancelados não entram na contagem de recebidos.</p></div>}
        {turnNotice && <div className="turn-notice" role="status"><HelpCircle size={19}/><div><strong>Disponibilidade da retransmissão</strong><p>{turnNotice}</p></div></div>}
        {error && <div className="error-message" role="alert"><HelpCircle size={19} /><span>{error}</span><button aria-label="Fechar aviso" onClick={() => setError("")}><X size={17} /></button></div>}
        {error && diagnostics && <details className="connection-diagnostics"><summary>Diagnóstico da conexão</summary><p>Sem nomes, arquivos, endereços IP ou senhas. Compartilhe estes dados se precisar de ajuda.</p><pre>{JSON.stringify(diagnostics,null,2)}</pre><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(JSON.stringify(diagnostics));setDiagnosticCopied(true);}catch{setDiagnosticCopied(false);}}}>{diagnosticCopied?"Diagnóstico copiado":"Copiar diagnóstico"}</button></details>}
        {(sending || progress) && <TransferProgress progress={progress} pause={pause} reconnecting={state==="reconnecting"} awake={awake} canSkip={!!connection.current?.canSkipFile} onSkip={()=>connection.current?.skipCurrentFile()} onPause={()=>connection.current?.setPaused(!pause.local)} onCancel={()=>{connection.current?.cancel();setSending(false);setProgress(null);setError("Transferência cancelada. Você pode tentar novamente.");}} onReconnect={()=>connection.current?.retry()}/>}
      </section>}

      {!!received.length && <section className="downloads flow-card"><div className="downloads-title"><h2>Arquivos recebidos <span>{received.length}</span></h2><button className="text-button" disabled={archiving||transferActive} onClick={clearReceived}>Limpar lista<X size={14} /></button></div><div className="save-all-actions">{received.some(f=>f.blob)&&(!archiveUrl?<button className="secondary" disabled={archiving||transferActive} onClick={()=>void saveAll()}>{archiving?"Preparando ZIP…":"Salvar todos os arquivos (ZIP)"}</button>:<a className="primary" href={archiveUrl} download="LocalTransfer-arquivos.zip">Baixar ZIP com todos os arquivos</a>)}<small>O ZIP reúne os arquivos disponíveis nesta página. Arquivos já gravados na pasta não precisam ser baixados novamente.</small></div><p className="save-warning">{received.some(file=>file.url) ? "Salve os arquivos antes de fechar esta página." : "Os arquivos já foram gravados na pasta escolhida."}</p>{received.map(file => <div className="download-row" key={file.id}><FileThumbnail file={file.preview} name={file.name}/><div><strong>{file.name}</strong><small>{size(file.size)}</small><span className={`integrity-badge ${file.integrity!=="verified"?"integrity-unavailable":""}`}>{file.integrity==="verified"?<><ShieldCheck size={13}/> Integridade verificada</>:"Verificação adicional indisponível"}</span></div>{file.url ? <a className="secondary" href={file.url} download={file.name}><ArrowDownToLine size={16} />Salvar</a> : <span className="secondary"><Check size={16} />Salvo na pasta</span>}</div>)}<p className="iphone-note">No iPhone, o arquivo pode abrir em outra tela. Use o botão de compartilhar e escolha “Salvar em Arquivos” ou “Salvar Imagem”.</p>{complete && <button className="primary" onClick={() => { setComplete(false);setProgress(null);setError(""); }}>Receber outros arquivos<ArrowRight size={16} /></button>}</section>}


      <div className="reassurance"><ShieldCheck size={16} /><span>Sem login. Sem instalar aplicativos. Seus arquivos não ficam no servidor.</span></div>
    </main>
    <footer className="site-footer"><span>LocalTransfer</span><span>Do seu aparelho para o outro.</span></footer>
    {offer && <ReceiveOffer offer={offer} selected={selectedIds} peer={peer} busy={choosingFolder} diskSupported={diskSupported} error={error} onChange={ids=>{setSelectedIds(ids);setError("");}} onAccept={()=>void acceptOffer()} onReject={()=>connection.current?.reject()}/>}
  </div>;
}

