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
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
