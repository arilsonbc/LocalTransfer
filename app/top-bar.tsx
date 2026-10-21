"use client";

import {useRef} from "react";
import {ArrowLeftRight,ExternalLink,CodeXml,HelpCircle,Mail,X} from "lucide-react";
import ThemeSwitch from "./theme-switch";

const questions=[
  ["Como envio meus arquivos?","No aparelho com os arquivos, escolha Enviar arquivos e selecione o que deseja enviar. No outro aparelho, use o link de convite, leia o QR Code com a câmera ou escolha Receber arquivos e digite o código. Confirme o recebimento para começar."],
  ["Preciso instalar algum aplicativo ou criar uma conta?","Não. Abra o site no navegador dos dois aparelhos. Funciona no computador, Android e iPhone, sem instalação ou login."],
  ["Os aparelhos precisam estar no mesmo Wi-Fi?","Não. Você pode usar Wi-Fi ou rede móvel, inclusive 4G e 5G. Quando a conexão direta não é possível, o serviço TURN da Cloudflare ajuda a conectar os aparelhos."],
  ["Qual é o limite de tamanho?","Você pode enviar até 500 arquivos e 100 GB por vez. Para receber mais de 200 MB, use Chrome ou Edge no computador e escolha uma pasta com espaço livre. Navegadores sem gravação direta em pasta continuam limitados a 200 MB no recebimento."],
  ["Onde meus arquivos ficam salvos?","Em envios pequenos, toque em Salvar em cada arquivo recebido. Em envios grandes, os arquivos são gravados durante a transferência em uma subpasta LocalTransfer dentro da pasta que você escolher. No iPhone, use o menu de compartilhar para salvar em Arquivos ou Fotos, conforme o tipo de arquivo."],
  ["Posso pausar e continuar depois?","Sim. Durante o envio, toque em Pausar transferência. O progresso fica preservado enquanto as duas páginas permanecerem abertas. Quem pausou precisa tocar em Continuar transferência; se os dois pausarem, os dois precisam continuar. Alguns blocos que já estavam em trânsito podem chegar após o toque. Fechar ou recarregar a página ainda impede a retomada."],
  ["Como sei que o arquivo chegou inteiro?","Com as duas páginas atualizadas, o site compara automaticamente o SHA-256 do conteúdo enviado e recebido. O selo Integridade verificada só aparece depois dessa confirmação. Se o conteúdo não conferir, o arquivo não é concluído e será necessário enviá-lo novamente. Aparelhos com versões antigas mostram que a verificação adicional está indisponível."],
  ["Quando aparecem as miniaturas das fotos?","No envio, abra Ver arquivos selecionados. No receptor, as miniaturas aparecem após aceitar e receber o arquivo. Elas são geradas no próprio aparelho, sem serviço externo. JPEG, PNG, WebP e AVIF de até 12 MB podem ter miniatura; formatos como HEIC ou imagens sem suporte continuam sendo transferidos com um ícone de arquivo."],
  ["Os arquivos ficam guardados no servidor?","Não. A transferência é criptografada pelo WebRTC. Os arquivos passam diretamente entre os aparelhos ou pelo retransmissor TURN; o LocalTransfer não mantém uma cópia deles no servidor. Compartilhe o código apenas com quem deve receber."],
  ["O que faço se a transferência parar?","Mantenha as páginas abertas e os aparelhos ativos até terminar. Confira a internet e o espaço livre no aparelho que recebe. Se a internet oscilar, o site tenta reconectar automaticamente e retoma do último byte recebido, por até dois minutos. Não feche nem recarregue as páginas, não cancele a transferência e mantenha os arquivos selecionados. Se o navegador encerrar a página ou as tentativas terminarem, será necessário criar outra sala."],
];

export default function TopBar({onHome}:{onHome:()=>void}) {
  const faq=useRef<HTMLDialogElement>(null);
  const contact=useRef<HTMLDialogElement>(null);
  return <>
    <header className="topbar"><div className="nav-header">
      <button className="brand" onClick={onHome} aria-label="LocalTransfer, voltar ao início"><span className="brand-icon"><ArrowLeftRight size={22}/></span><span>Local<strong>Transfer</strong></span></button>
      <nav className="topnav" aria-label="Navegação principal">
        <button className="nav-item" onClick={()=>faq.current?.showModal()} aria-haspopup="dialog" aria-controls="faq-dialog"><HelpCircle size={17}/><span>Como funciona</span></button>
        <a className="nav-item" href="https://github.com/arilsonbc/LocalTransfer" target="_blank" rel="noopener noreferrer" aria-label="GitHub: código do LocalTransfer (abre em outra aba)"><CodeXml size={17}/><span>GitHub</span><ExternalLink className="external-icon" size={12}/></a>
        <button className="nav-item" onClick={()=>contact.current?.showModal()} aria-haspopup="dialog" aria-controls="contact-dialog"><Mail size={17}/><span>Contato</span></button>
      </nav>
      <ThemeSwitch/>
    </div></header>
    <dialog ref={faq} id="faq-dialog" className="info-dialog" aria-labelledby="faq-title">
      <div className="dialog-heading"><div><span className="card-kicker">TIRE SUAS DÚVIDAS</span><h2 id="faq-title">Como funciona o LocalTransfer</h2></div><button className="icon-button" aria-label="Fechar perguntas frequentes" onClick={()=>faq.current?.close()} autoFocus><X size={21}/></button></div>
      <p className="dialog-intro">Um aparelho envia. O outro recebe. Sem complicação.</p>
      <div className="faq-list">{questions.map(([question,answer],index)=><details key={question} open={index===0}><summary>{question}</summary><p>{answer}</p></details>)}</div>
    </dialog>
    <dialog ref={contact} id="contact-dialog" className="info-dialog contact-dialog" aria-labelledby="contact-title">
      <div className="dialog-heading"><div><span className="card-kicker">VAMOS CONVERSAR</span><h2 id="contact-title">Entre em contato</h2></div><button className="icon-button" aria-label="Fechar contato" onClick={()=>contact.current?.close()} autoFocus><X size={21}/></button></div>
      <p className="dialog-intro">Dúvidas, sugestões ou algo que podemos melhorar?</p>
      <a className="contact-email" href="mailto:Ari-casagrande@hotmail.com"><Mail size={22}/><span>Ari-casagrande@hotmail.com</span></a>
      <p className="contact-note">Clique no endereço para abrir seu aplicativo de e-mail.</p>
    </dialog>
  </>;
}
