# LocalTransfer

Transferência de fotos e arquivos entre iPhone, Android e computador pelo navegador, sem instalar aplicativos.

## Usar

1. No aparelho que tem os arquivos, escolha **Enviar arquivos**.
2. Selecione os arquivos. O código aparece automaticamente.
3. No outro aparelho, escolha **Receber arquivos**.
4. Digite o código, abra o link de convite ou leia o QR Code com a câmera. Conecte e aceite o recebimento.
5. Toque em **Salvar** em cada arquivo recebido.

## Hospedagem no Vercel

A aplicação é Next.js: interface e rotas `/api/rooms` executam no Vercel. O envio usa WebRTC: conexão direta quando possível, ou retransmissão criptografada pelo Cloudflare TURN quando configurado.

Repositório: https://github.com/arilsonbc/LocalTransfer

Projeto Vercel: `patudoglobal/local-transfer`

Domínio de produção configurado: https://local-transfer-virid.vercel.app

O endereço só está operacional após o deploy concluir e o banco Redis ser conectado. A publicação anterior do Sites/Cloudflare é uma versão independente e não é atualizada por este fluxo.

### Conectar o banco de salas

Em Vercel > local-transfer > Storage, conecte **Upstash for Redis**, selecione o plano desejado e habilite a conexão com os ambientes de produção e preview. Depois faça um novo deploy para carregar as variáveis.

A integração deve fornecer um destes pares de variáveis, sempre no servidor:

- `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`
- ou `KV_REST_API_URL` e `KV_REST_API_TOKEN`
- ou `localtransfer_KV_REST_API_URL` e `localtransfer_KV_REST_API_TOKEN` (prefixo da integração deste projeto)

Não use prefixo `NEXT_PUBLIC_` nessas variáveis. Não coloque tokens no GitHub. O arquivo `.env.example` contém somente exemplos.

Salas não pareadas expiram após 20 minutos. Depois do primeiro ingresso, a sala fica reservada aos mesmos dois tokens por até 48 horas para permitir reconexão. Redis guarda apenas hashes dos tokens e dados temporários de conexão (nome dos aparelhos e SDP), nunca fotos ou arquivos. O ingresso do segundo participante e a atualização da sinalização são atômicos via Lua. Cada sala aceita dois aparelhos; o código não permite que um terceiro substitua o receptor. Atualizações de sinalização não prolongam a validade da sessão.

A integração GitHub/Vercel publica novos commits da branch `main`. `vercel.json` fixa o preset Next.js e os comandos de instalação/build. O GitHub Actions executa os testes, a checagem de tipos e o build.

## Conectar e acompanhar

- Convites e QR Codes são gerados localmente e contêm apenas o código da sala. Não há serviço externo de QR nem token de autenticação no link. O modo TURN forçado é preservado quando solicitado no endereço.
- O progresso mostra o lote completo, número do arquivo, velocidade estimada e tempo restante. A estimativa reinicia após reconexões.
- Durante a transferência, o site solicita manter a tela ligada onde a API estiver disponível. Isso não garante execução em segundo plano: voltar a outra aplicação ou bloquear o telefone pode suspender a página.

## Desenvolvimento

### Integridade, pausa e miniaturas

O receptor pode selecionar parte do lote antes de aceitar. A negociação `selection:1` anuncia o suporte; a confirmação informa IDs exclusivos pertencentes à oferta original. A ordem original é preservada, e o remetente não lê nem envia o conteúdo dos itens recusados. Progresso, limites de memória, destino em disco e contagens finais usam somente os itens escolhidos. A seleção fica fixa durante a retomada, inclusive se a confirmação final se perder. A autorização do receptor também rejeita cabeçalhos de arquivos não selecionados. Com versões antigas sem essa negociação, o recebimento permanece disponível para o lote completo.

- As páginas negociam suporte a SHA-256 e verificam cada arquivo antes de concluir a gravação/entrega. O hash é incremental (`@noble/hashes`), sem carregar o arquivo inteiro. O remetente mantém no máximo seis checkpoints pequenos para recuperar o hash após reconexão; o receptor preserva o hash junto com os bytes confirmados. Erros de integridade abortam o arquivo atual. A confirmação indica igualdade dos bytes processados nos aparelhos, não autenticação da identidade do outro participante nem releitura física do disco. Versões antigas continuam compatíveis, sem selo de verificação.
- Cada participante pode pausar. O envio só continua quando ambos liberarem suas próprias pausas; blocos já em trânsito ainda podem chegar. Prazos de confirmação e estimativas são suspensos/reiniciados durante a pausa. O estado da pausa é trocado novamente na reconexão. As páginas e as seleções precisam permanecer disponíveis; recarregar ou fechar ainda não é retomável. Pausar não amplia a validade da sala ou das credenciais TURN. A tela deixa de ser mantida ligada durante a pausa.
- Miniaturas locais de 160 × 160 px são geradas sob demanda para JPEG, PNG, WebP e AVIF de até 12 MiB, quando `createImageBitmap` estiver disponível. A seleção e a lista recebida usam as miniaturas; nada é enviado antes do aceite para mostrar uma prévia. Arquivos em disco são abertos para prévia somente depois de fechar a gravação verificada. Imagens sem suporte, HEIC, SVG e arquivos maiores mantêm ícone; falhas de prévia não invalidam a transferência. URLs locais são liberadas quando os itens saem da tela/lista.

### Controle de consumo do TURN

Configure `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_ANALYTICS_API_TOKEN` como variáveis de servidor na Vercel. O token precisa somente de **Account Analytics: Read** na conta desejada. Não use o segredo do TURN como token de Analytics. Faça um novo deploy após alterar variáveis.

O servidor consulta o total de saída (`egressBytes`) e entrada (`ingressBytes`) de **todas as chaves TURN da conta** pela API GraphQL oficial, com cache compartilhado no Redis por até cinco minutos. A consulta ocorre ao preparar uma conexão; não há monitor agendado ou envio de e-mails. Os totais ficam no servidor; o navegador recebe somente a disponibilidade e avisos. Para acompanhar os números e investigar chaves/usuários, use Cloudflare → Realtime → TURN → Analytics.

`TURN_MONTHLY_BUDGET_GB` define um orçamento operacional de saída em GB decimais por **mês calendário UTC**, padrão **900 GB**. Aos 80% (720 GB no padrão), novas conexões recebem aviso. Ao atingir o orçamento, novas credenciais deixam de ser emitidas e a conexão direta continua disponível. `TURN_ENABLED=false` também pausa a emissão. Se Analytics estiver parcialmente configurado ou falhar, novas conexões usam somente STUN, sem emitir credenciais TURN; credenciais existentes continuam válidas. Sem ambas as variáveis, a medição fica desativada para compatibilidade com instalações antigas; os limites de emissão continuam ativos.

Proteções no servidor: sala e token válidos, até três solicitações por minuto por IP/participante, dez por minuto por IP entre todas as salas, 60 por hora por IP, seis emissões por participante da sala em 48 horas e 600 emissões por hora no projeto. São contadores atômicos no Redis. Recriar salas não remove os limites por IP/global. Reconexões dentro da mesma página reutilizam as credenciais e não consomem novas emissões.

**Não é um teto financeiro garantido.** Analytics pode atrasar, o cache tem cinco minutos e credenciais já emitidas duram até 48 horas. Sessões existentes não são revogadas ao atingir o orçamento. O mês calendário pode diferir do período da fatura; consumo SFU e outras cobranças não entram neste contador. Um cliente modificado pode reutilizar credenciais válidas. Para incidentes, acompanhe a conta e revogue credenciais/chaves pelo painel Cloudflare, considerando o impacto nas transferências em andamento. Limites por IP podem afetar aparelhos que compartilham o mesmo IP de operadora.

Referência: [Analytics do TURN](https://developers.cloudflare.com/realtime/turn/analytics/).

Requer Node.js >= 22.13.0 e npm. Use Node 24 para o mesmo ambiente do CI.

```sh
npm ci
```

Copie `.env.example` para `.env.local` e configure um banco Redis de desenvolvimento. Não use credenciais de produção para testes locais.

```sh
npm run dev
npm test
npm run typecheck
npm run build
npm start
```

Testes automatizados de rotas usam armazenamento isolado em memória. O transporte WebRTC simulado verifica os bytes, múltiplos blocos, arquivos vazios, recusa e autorização. A integração real com Redis deve ser verificada após o provisionamento.

## Limitações

A rota TURN usa TLS na porta 443, evitando tentativas nos vários caminhos UDP e portas alternativas em redes móveis. O modo automático mantém as rotas diretas disponíveis e, se o pareamento falhar, tenta novamente usando apenas TURN. No modo forçado, o pareamento espera uma rota `relay` no SDP por até 45 segundos; se não aparecer, informa `TURN-SEM-ROTA`. O diagnóstico local não inclui IPs, arquivos ou credenciais. Para testar exclusivamente o retransmissor, abra `/?relay=1` nos dois aparelhos. Esse modo usa `iceTransportPolicy: relay`, sem conexão direta.

- Até 500 arquivos e 100 GB decimais (100.000.000.000 bytes) por lote, inclusive um arquivo único de até 100 GB.
- Lotes acima de 200 MiB exigem `showDirectoryPicker` no receptor (Chrome/Edge de computador). O receptor escolhe a pasta, e cada arquivo é gravado por fluxo em uma subpasta nova, com nomes numerados para evitar sobrescritas. O envio aguarda confirmação do receptor a cada 1 MiB, mantendo a fila de gravação limitada. É necessário espaço livre suficiente; falhas de gravação cancelam a transferência e abortam o arquivo atual.
- Nos navegadores sem gravação direta, como Safari/iPhone e navegadores móveis sem o seletor, o limite de recebimento permanece em 200 MiB. Arquivos pequenos continuam na memória até salvar/remover. Esses dispositivos podem enviar arquivos maiores para um receptor compatível. Mantenha as páginas abertas e os aparelhos ativos.
- A retomada é automática durante quedas curtas, com as duas páginas abertas e a seleção de arquivos e o destino ainda disponíveis. A negociação é versionada; respostas antigas são ignoradas. O receptor informa arquivo e byte já recebido, preservando o escritor em disco ou os blocos em memória. Arquivos concluídos não são duplicados. A recuperação tenta até cinco vezes, com espera crescente, dentro de dois minutos. Cancelamento, erro de disco, fechamento/recarregamento da página ou encerramento do navegador não são retomáveis nesta versão. No iPhone, salvar em Fotos pode exigir o menu de compartilhamento.
- Para redes móveis e NAT restritivo, configure `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` como variáveis de servidor na Vercel e faça um novo deploy. A rota autenticada `/api/rooms/[code]/ice` gera credenciais com validade de 48 horas para permitir transferências longas; a chave principal nunca vai ao navegador. O código da sala vale por 20 minutos para o primeiro pareamento; a sessão privada pareada fica disponível por até 48 horas. Sem ambas as variáveis, apenas STUN fica disponível e a conexão entre algumas redes pode falhar. Uma configuração parcial ou falha da Cloudflare retorna erro explícito.
- O TURN tem consumo de tráfego e franquia definidos pela Cloudflare. Credenciais temporárias limitam a exposição, mas não representam um limite financeiro. Verifique o consumo no painel da conta.
- O código permite conectar o segundo participante. Compartilhe-o só com o receptor esperado e confira os arquivos antes de aceitar.
- Não se conecta diretamente ao aplicativo LocalSend.

## Licença

Implementação web própria, inspirada no uso de transferência entre dispositivos do LocalSend. Não é um fork do aplicativo Flutter nem usa seu protocolo de transferência. LocalTransfer usa WebRTC e salas.

Código sob Apache-2.0. Avisos do template original e das dependências estão preservados em `NOTICE`, `build/sites-vite-plugin.LICENSE` e `vendor/`. Não há vínculo oficial com o LocalSend.

### Avisos de saída e conexão

Durante uma transferência, inclusive pausada, o site pede confirmação ao voltar ao início e solicita ao navegador o aviso ao fechar ou atualizar a aba. Arquivos recebidos que ainda estão disponíveis apenas na página também mantêm esse aviso. O navegador escolhe o texto do diálogo; em celulares, fechar o aplicativo ou encerrar o navegador pode não dispará-lo. O aviso não salva a sessão após fechar a página.

O estado da conexão informa espera, preparação, reconexão, indisponibilidade e falta de internet detectada pelo navegador. A indicação de internet é uma pista local, não um teste de acesso ao outro aparelho. Na reconexão, mantenha as páginas abertas para preservar o progresso confirmado.


### Lotes na mesma conexão, ZIP e cancelamento individual

Após concluir, use Enviar outros arquivos para selecionar outro lote sem trocar o código. Quem recebe precisa aceitar cada novo lote. Mantenha as páginas abertas; os arquivos anteriores continuam disponíveis e contam no limite de memória de 200 MB até limpar a lista.

Salvar todos os arquivos (ZIP) prepara um arquivo ZIP local, sem compressão e sem enviar os dados a um servidor. Depois toque em Baixar ZIP. Ele inclui apenas os arquivos disponíveis na página, até 200 MB; arquivos já gravados diretamente na pasta não são incluídos. Os nomes são numerados para evitar colisões. No iPhone, pode ser necessário usar Compartilhar e Salvar em Arquivos.

Cancelar somente este arquivo funciona no remetente e no destinatário atualizados, durante o arquivo atual. O parcial é descartado (ou a gravação é abortada), os demais continuam e a contagem final exclui cancelados. Se a transferência estiver pausada, continue para enviar os próximos. O cancelamento precisa chegar ao outro aparelho antes da finalização; um arquivo já concluído não é apagado. Cancelar transferência continua encerrando o lote todo.


### Resumo da transferência

Cada lote mostra um resumo local ao concluir, recusar, cancelar ou falhar: enviados (confirmados pelo destino), recebidos neste aparelho, recusados na seleção ou no aceite, cancelados, falhas/não concluídos, tamanho oferecido e tamanho concluído. Enviados e recebidos são contagens deste aparelho, não a soma dos dois lados. A duração começa na proposta do lote e inclui aceite, pausas e reconexões. Blocos parciais e tráfego de retransmissão não entram no tamanho concluído. O resumo não é salvo em servidor e é substituído no próximo lote. Após uma falha, o remetente pode ter menos confirmações do que os arquivos efetivamente concluídos no destinatário; confira os dois resumos.


### Conversor de imagens

Abra /converter pelo menu Imagens ou pelo atalho na página inicial. Escolha JPG, PNG ou WebP, qualidade e maior lado da saída. A conversão usa ImageBitmap e canvas localmente, sem upload. As dimensões preservam a proporção e nunca ampliam o original. JPG preenche transparência com branco; PNG/WebP podem preservá-la. PNG ignora a qualidade; reduzir dimensões ajuda a diminuir o tamanho. A saída é estática, não preserva EXIF original e pode ficar maior que o arquivo de entrada, o que é informado na tela.

Limites: 20 fotos, 20 MB por arquivo, 100 MB de entrada e de resultados, 40 megapixels por imagem e maior lado de saída de até 4096 px. JPEG, PNG, WebP, AVIF, HEIC e HEIF só são decodificados se o navegador permitir. HEIC/HEIF pode falhar mesmo em aparelho atualizado; a mensagem orienta exportar JPG. Há prévia, download individual e ZIP dos resultados concluídos. Falha em uma conversão não impede as seguintes. Parar cancela a fila e descarta o resultado que ainda não terminou. Trocar fotos ou limpar libera as URLs locais; originais não são modificados.


### Idiomas

O seletor no topo oferece Português (padrão), English e Español. A escolha é salva apenas no navegador em localtransfer-language, permanece ao abrir o conversor ou recarregar e atualiza o idioma HTML e o título da página. Sem acesso ao armazenamento, a troca funciona durante a sessão. A mudança não recria salas, não interrompe transferências e não altera nomes, conteúdo de arquivos, códigos ou dados de diagnóstico. As mensagens de interface, ajuda, status e erros conhecidos têm catálogos locais; mensagens desconhecidas do navegador ou do sistema podem permanecer no idioma de origem. Diálogos nativos do navegador seguem suas próprias configurações de idioma.

