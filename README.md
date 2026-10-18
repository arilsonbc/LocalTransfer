# LocalTransfer

Transferência de fotos e arquivos entre iPhone, Android e computador pelo navegador, sem instalar aplicativos.

## Usar

1. No aparelho que tem os arquivos, escolha **Enviar arquivos**.
2. Selecione os arquivos. O código aparece automaticamente.
3. No outro aparelho, escolha **Receber arquivos**.
4. Digite o código, conecte e aceite o recebimento.
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

As salas expiram automaticamente após 20 minutos. Redis guarda apenas hashes dos tokens e dados temporários de conexão (nome dos aparelhos e SDP), nunca fotos ou arquivos. O ingresso do segundo participante e a atualização da sinalização são atômicos via Lua. Cada sala aceita dois aparelhos; alterações preservam o prazo original, sem prolongar a validade.

A integração GitHub/Vercel publica novos commits da branch `main`. `vercel.json` fixa o preset Next.js e os comandos de instalação/build. O GitHub Actions executa os testes, a checagem de tipos e o build.

## Desenvolvimento

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

- Até 500 arquivos e 200 MiB (apresentados como 200 MB na interface) por lote.
- Os arquivos recebidos ficam na memória do navegador até serem salvos ou removidos. Mantenha a página aberta e o celular desbloqueado.
- Não há retomada após interrupções. No iPhone, salvar em Fotos pode exigir o menu de compartilhamento.
- Para redes móveis e NAT restritivo, configure `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` como variáveis de servidor na Vercel e faça um novo deploy. A rota autenticada `/api/rooms/[code]/ice` gera credenciais com validade de uma hora; a chave principal nunca vai ao navegador. Sem ambas as variáveis, apenas STUN fica disponível e a conexão entre algumas redes pode falhar. Uma configuração parcial ou falha da Cloudflare retorna erro explícito.
- O TURN tem consumo de tráfego e franquia definidos pela Cloudflare. Credenciais temporárias limitam a exposição, mas não representam um limite financeiro. Verifique o consumo no painel da conta.
- O código permite conectar o segundo participante. Compartilhe-o só com o receptor esperado e confira os arquivos antes de aceitar.
- Não se conecta diretamente ao aplicativo LocalSend.

## Licença

Implementação web própria, inspirada no uso de transferência entre dispositivos do LocalSend. Não é um fork do aplicativo Flutter nem usa seu protocolo de transferência. LocalTransfer usa WebRTC e salas.

Código sob Apache-2.0. Avisos do template original e das dependências estão preservados em `NOTICE`, `build/sites-vite-plugin.LICENSE` e `vendor/`. Não há vínculo oficial com o LocalSend.
