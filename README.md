# LocalTransfer

Transferência de fotos e arquivos entre iPhone, Android, Windows e outros computadores **pelo navegador**, sem instalação.

## Usar

1. Abra o site nos dois aparelhos, preferencialmente no mesmo Wi-Fi.
2. Crie uma sala no primeiro aparelho.
3. No segundo, entre com o código de oito caracteres ou abra o link da sala.
4. Escolha arquivos, envie e aceite no receptor.
5. Toque em **Salvar** em cada arquivo recebido, antes de fechar a página.

Site: https://localtransfer-web.wise-sun-9588.chatgpt.site

O site é público e não exige login. Apenas quem conhece o código ou link da sala pode tentar conectar o segundo aparelho.

## Arquitetura

- React + TypeScript, executados com Vinext em Cloudflare Workers.
- Cloudflare D1 armazena apenas salas e sinalização WebRTC (SDP/endereços de conexão), sem conteúdo dos arquivos.
- O canal WebRTC transfere os arquivos em blocos ordenados de 16 KiB, com controle de fluxo, confirmação de recebimento e cancelamento.
- A sessão usa tokens aleatórios de 256 bits; apenas seus hashes SHA-256 são persistidos.
- O ingresso de um segundo aparelho é atômico. A sala não permite um terceiro participante.
- Códigos aleatórios de 40 bits, validade de 20 minutos, limites de requisições e verificação de origem nos endpoints de escrita.
- Salas expiradas deixam de funcionar imediatamente e são removidas oportunisticamente na próxima criação de sala. Não há garantia de exclusão física exatamente no instante da expiração.
- Histórico local guarda somente data, direção e quantidade de arquivos; não contém arquivos nem nomes.

## Limitações da versão 0.1

- Até 500 arquivos e **200 MiB por lote**; a interface apresenta esse limite como 200 MB.
- Downloads são mantidos na memória do navegador até salvar/remover/fechar. Não há upload de arquivos ao servidor nem retomada após interrupções.
- Ambos os navegadores precisam permanecer abertos. No celular, mantenha a tela desbloqueada.
- Requer navegadores atuais com WebRTC. A compatibilidade com aparelhos físicos iPhone/Android precisa de validação nesses aparelhos.
- Usa STUN público do Google para descoberta de conectividade; não inclui serviço TURN. Redes restritas ou certos NATs podem impedir a conexão entre redes diferentes. Recomenda-se o mesmo Wi-Fi.
- Não oferece descoberta UDP multicast, execução em segundo plano nem integração com o aplicativo LocalSend, pois essas funções não estão disponíveis da mesma forma em páginas web.
- Conhecer o código permite tentar ocupar a segunda vaga da sala. Compartilhe-o apenas com o receptor esperado e confira o nome exibido antes de aceitar arquivos.
- Nome LocalTransfer é provisório e não foi feita pesquisa de marca/domínio.

## Desenvolvimento

Requer Node.js >= 22.13.0 e npm.

```sh
npm ci
npm run test
npm run typecheck
npm run build
```

Declare o binding D1 `DB` em `.openai/hosting.json`. A migração inicial está em `drizzle/0000_dashing_roughhouse.sql`.

Para a prévia local, após o build:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_dashing_roughhouse.sql
npm start
```

O servidor mostra o endereço local da prévia. `localhost` só funciona no próprio computador; o site HTTPS publicado é usado nos celulares.

## GitHub e publicação

Repositório: https://github.com/arilsonbc/LocalTransfer

O workflow de GitHub Actions verifica os testes, os tipos e o build a cada push ou pull request. Ele **não publica automaticamente em produção**: a hospedagem Sites mantém seu próprio repositório de origem e o deploy usa o mesmo código validado. Novas alterações podem ser enviadas ao GitHub e publicadas pelo fluxo Sites, sem tokens de hospedagem no repositório.

## Origem e licença

Implementação web própria, inspirada no uso de transferência entre dispositivos do LocalSend. Não é um fork do aplicativo Flutter nem usa seu protocolo de transferência: navegadores usam WebRTC e salas.

Referência: https://github.com/localsend/localsend (Apache-2.0).

O código LocalTransfer está sob Apache-2.0. Avisos de licença do template Sites e das dependências estão preservados nos respectivos arquivos. Não há vínculo oficial com o projeto LocalSend.

