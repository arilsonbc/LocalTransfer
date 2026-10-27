"use client";
import {useLanguage} from "./language-provider";
import { useEffect, useState } from "react";
import { Check, Link as LinkIcon, QrCode, Share2 } from "lucide-react";
import { makeInvite } from "../lib/invite";
export default function InviteCard({ code }: {
    code: string;
}) {
    const { t } = useLanguage();
    const [url, setUrl] = useState("");
    const [qr, setQr] = useState("");
    const [showQr, setShowQr] = useState(false);
    const [copied, setCopied] = useState(false);
    const [notice, setNotice] = useState("");
    useEffect(() => { setUrl(makeInvite(location.href, code)); setCopied(false); setQr(""); }, [code]);
    useEffect(() => {
        if (!showQr || !url)
            return;
        let active = true;
        void import("qrcode").then(q => q.toDataURL(url, { width: 256, margin: 3, errorCorrectionLevel: "M", color: { dark: "#183b2a", light: "#ffffff" } })).then(image => { if (active)
            setQr(image); }).catch(() => { if (active)
            setNotice(t("N\u00E3o foi poss\u00EDvel gerar o QR Code. Use o link ou o c\u00F3digo da sala.")); });
        return () => { active = false; };
    }, [showQr, url]);
    async function copy() { try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setNotice("");
    }
    catch {
        setNotice(t("Selecione o link abaixo e copie para compartilhar."));
    } }
    async function share() { try {
        if (navigator.share)
            await navigator.share({ title: t("Receber arquivos no LocalTransfer"), text: t("Abra este convite no aparelho que vai receber. Compartilhe apenas com a pessoa esperada."), url });
        else
            await copy();
    }
    catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError"))
            await copy();
    } }
    return <div className="invite-card">
    <p>{t("Ou conecte sem digitar:")}</p>
    <div className="invite-actions"><button className="secondary" onClick={() => setShowQr(!showQr)} aria-expanded={showQr}><QrCode size={17}/>{showQr ? t("Ocultar QR Code") : t("Mostrar QR Code")}</button><button className="secondary" onClick={() => void copy()}><span>{copied ? <Check size={16}/> : <LinkIcon size={16}/>}</span>{copied ? t("Link copiado") : t("Copiar convite")}</button><button className="text-button" onClick={() => void share()}><Share2 size={15}/>{t("Compartilhar")}</button></div>
    {showQr && <div className="invite-qr">{qr ? <img src={qr} width={208} height={208} alt={t("QR Code para abrir o convite de recebimento neste outro aparelho")}/> : <span>{t("Preparando QR Code\u2026")}</span>}<small>{t("Leia com a c\u00E2mera do aparelho que vai receber.")}<br />{t("Depois, toque em Conectar e receber.")}</small></div>}
    {notice && <div className="invite-notice" role="status"><p>{t(notice)}</p><input aria-label={t("Link do convite")} value={url} readOnly onFocus={event => event.currentTarget.select()}/></div>}
    <small>{t("O convite d\u00E1 acesso \u00E0 sala. Compartilhe s\u00F3 com quem deve receber.")}</small>
  </div>;
}
