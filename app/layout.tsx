import LanguageProvider from "./language-provider";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LocalTransfer — seus arquivos, de um aparelho para outro",
  description: "Envie fotos e arquivos entre iPhone, Android e computador direto pelo navegador. Sem instalar aplicativos.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head><script id="localtransfer-theme" dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem('localtransfer-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`}}/></head>
      <body className="antialiased"><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
