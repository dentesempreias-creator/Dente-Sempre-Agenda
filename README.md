# Dente Sempre — produto (computador, celular e servidor)

O Dente Sempre agora é um **programa instalado** (Windows, Mac, Linux), um **aplicativo de celular** (Android, com a base do iPhone pronta) e um **servidor** que guarda os dados de cada clínica separados, confere licenças e faz a sincronização.

Ele **não abre mais no navegador**: o servidor só responde aos aplicativos, e a licença de cada aparelho é assinada pelo servidor.

```
dente-sempre/
├── app/
│   ├── fonte/dente-sempre.html   ← o programa (o mesmo arquivo único de sempre, com offline e licença)
│   ├── config.json               ← endereço do servidor + chave pública das licenças
│   ├── preparar.js               ← embaralha o código e coloca o programa dentro dos apps
│   ├── desktop/                  ← aplicativo de computador (Electron)
│   ├── celular/                  ← aplicativo de celular (Capacitor: Android + iOS)
│   └── LEIA-ME-APPS.md           ← detalhes técnicos dos apps
├── servidor/
│   ├── servidor.js               ← servidor (Node 22, sem dependências, banco SQLite)
│   ├── planos.js                 ← planos e limites (o único arquivo que decide o que cada clínica pode usar)
│   ├── paciente.js               ← link do paciente: página de confirmação pelo WhatsApp
│   ├── Dockerfile                ← para Fly.io, Railway, Render...
│   └── hospedagem/               ← instalação num VPS com HTTPS automático (Caddy)
└── .github/workflows/gerar-apps.yml   ← gera o APK e os instaladores no GitHub, de graça
```

---

## 1. Ordem para colocar no ar (resumo)

1. **Suba o servidor** (seção 4). Anote o endereço, por exemplo `https://api.seudominio.com.br`.
2. No servidor, rode `dente-sempre chave-publica` e copie a chave.
3. Coloque o endereço e a chave em `app/config.json`.
4. **Gere os aplicativos** (seções 2 e 3).
5. Crie uma clínica: `dente-sempre nova-clinica "Clínica Sorriso" --plano basico`.
6. Entregue para a clínica: o **código da clínica**, o **usuário admin com a senha provisória** e a **chave de ativação**.

> Os aplicativos só aceitam licenças assinadas pela chave do **seu** servidor. Se trocar de servidor (ou perder o arquivo `dados/licenca-privada.pem`), precisa gerar os aplicativos de novo. **Guarde uma cópia desse arquivo fora do servidor.**

---

## 2. Como gerar o aplicativo de computador

Precisa do **Node.js 22** (nodejs.org). Dentro da pasta `app/`:

```bash
npm run instalar            # uma vez só
npm run desktop:abrir       # abre o programa para testar, sem instalar
npm run desktop:windows     # instalador do Windows  → app/desktop/dist/Dente-Sempre-Instalador-1.0.0.exe
npm run desktop:mac         # .dmg (só num Mac)      → app/desktop/dist/
npm run desktop:linux       # .AppImage e .deb       → app/desktop/dist/
```

- Cada comando primeiro roda o `preparar`. Ele pega o `fonte/dente-sempre.html` e coloca o endereço do servidor e a chave pública. Depois embaralha o código e o coloca dentro do app.
- Se faltar o endereço ou a chave em `config.json`, ele para e explica o que falta.
- O aplicativo é feito com Electron 44. Os dados ficam no computador, no endereço fixo `app://dente-sempre`, e não se perdem ao atualizar.

**Sem instalar nada (pelo GitHub):**

1. Coloque o projeto num repositório do GitHub.
2. Em **Settings → Secrets and variables → Actions**, crie `DS_SERVIDOR` e `DS_CHAVE_PUBLICA`.
3. Rode **Actions → Gerar aplicativos**.

Saem o instalador do Windows, o do Mac, o do Linux e o APK do Android. Detalhes e assinatura digital: `app/LEIA-ME-APPS.md`.

## 3. Como gerar o aplicativo de celular

**Android:**

- **Pelo GitHub (recomendado):** a mesma execução de **Actions → Gerar aplicativos** gera o `app-debug.apk`, para teste. Se você cadastrar a chave de assinatura (`ANDROID_KEYSTORE_BASE64` e as senhas), também gera o APK e o `.aab` assinados, prontos para a Google Play.
- **No seu computador:** instale o **Android Studio** (ele traz o kit do Android e o Java). Depois, na pasta `app/`:
  ```bash
  npm run celular:android             # APK de teste → app/celular/android/app/build/outputs/apk/debug/
  npm run celular:android-assinado    # APK + AAB assinados (veja "Assinatura" no LEIA-ME-APPS.md)
  ```
- O aplicativo é feito com Capacitor 8, para Android 7 ou mais novo. Ele só aceita conexão `https://`.
- Os dados da clínica não vão para o backup do Google nem passam para outro celular.

**iPhone:** a base está pronta em `app/celular/ios`. Num **Mac com Xcode**:

1. Rode `npm run celular:ios`, que abre o Xcode.
2. Escolha sua conta Apple em *Signing & Capabilities*.
3. Use *Product → Archive* para enviar ao TestFlight ou à App Store.

**Como o programa fica no celular** (telas de até 600px; no computador nada muda):

- **Barra fixa embaixo** com os 5 atalhos mais usados: Menu, Confirmar, Lista, Pacientes e Mais. O resto (Encaixe, Bloquear, Aniversários, Dentistas e Modo ocupada) fica no Menu.
- O botão **+ Novo horário** fica flutuando acima da barra. Quando você digita nas anotações ou na assistente, a barra sai da frente do teclado.
- **Agenda:** cartões com nome e horário maiores, e linhas de 15 minutos mais altas, melhores para o dedo.
- **Janelas** abrem de baixo para cima. Os botões de ação ficam em duas colunas, e Salvar/Cancelar ficam sempre visíveis no rodapé.
- **Menus de opções** (Mais, ou tocar num horário livre) abrem de baixo, na largura toda, com fundo escuro. Tocar fora fecha.
- **Lista do dia:** cada consulta vira um cartão, sem tabela cortada de lado. No app do celular não aparece o botão Imprimir, porque a impressão é pelo computador.
- **Buscar consultas:** a lupa fica no topo, ao lado da sincronização. O campo é grande, e cada resultado é um cartão com o botão **Ver no dia** (veja a seção 7).
- **Sem internet:** a faixa amarela fica presa no topo mesmo rolando a agenda, com texto curto e o botão "Ver pendentes".
- **WhatsApp:** no app do celular abre **direto o aplicativo do WhatsApp** (`whatsapp://`). Se ele não estiver instalado, abre pelo wa.me.
- **Backup:** é salvo pelo botão **Compartilhar** do celular (Drive, e-mail, WhatsApp, Arquivos).
- **Textos:** "Lembrar neste computador" virou "Lembrar neste aparelho". O mesmo vale nas outras mensagens: ativação, sair, backup e sincronização.

> **Gerar o APK aqui no Claude não deu certo:** a rede deste ambiente bloqueia `dl.google.com`, de onde o Android baixa as peças dele. Use o GitHub (acima) ou o Android Studio no seu computador.

---

## 4. Servidor e banco de dados (barato)

O banco é **SQLite**, que já vem dentro do Node.js 22. Não precisa contratar banco de dados separado.

Cada clínica fica num **arquivo próprio**: `dados/clinicas/<id>.db`. O arquivo `dados/sistema.db` guarda só a lista de clínicas, licenças e aparelhos. Um erro numa clínica não alcança as outras, e dá para fazer cópia ou restaurar **uma clínica só**.

### Opção recomendada: um VPS barato com HTTPS automático

É a mais barata e a mais simples de manter. Um servidor pequeno (1 vCPU, 1–2 GB de memória) aguenta dezenas de clínicas.

| Item | Custo aproximado |
|---|---|
| VPS (Hetzner, Contabo, DigitalOcean, Vultr, Hostinger, Magalu Cloud) | US$ 4 a 6 por mês (≈ R$ 25 a 35) |
| Domínio `.com.br` (registro.br) | ≈ R$ 40 por ano |
| Certificado HTTPS (Let's Encrypt, pelo Caddy) | grátis |
| Banco de dados (SQLite) | grátis |
| **Total** | **≈ R$ 30 a 40 por mês** |

*Preços mudam: confira no site de cada um.*

Passo a passo:

1. Contrate o VPS com **Ubuntu 24.04**.
2. No registro.br, crie o registro **A** de `api.seudominio.com.br` apontando para o IP do VPS.
3. Copie a pasta `servidor` para o VPS (por exemplo com `scp -r servidor root@IP:/root/`).
4. No VPS, como root:
   ```bash
   cd /root/servidor
   bash hospedagem/instalar-vps.sh api.seudominio.com.br
   ```
   O script instala o Node 22 e o Caddy (que cuida do HTTPS). Ele também liga o serviço, que religa sozinho se cair, ativa o firewall e agenda a cópia diária.
5. No fim, o script mostra a **chave pública** para colocar em `app/config.json`.
6. Teste: abra `https://api.seudominio.com.br/api/situacao` (deve responder `"ok": true`).

Depois disso, use o comando **`dente-sempre`** no VPS para tudo (veja a seção 6).

### Outras opções

- **Oracle Cloud "Always Free"**: o VPS é grátis de verdade, mas o cadastro pede cartão e a criação da máquina às vezes falha por falta de vaga. Use o mesmo `instalar-vps.sh`.
- **Fly.io** (≈ US$ 3 a 5 por mês) ou **Railway** (plano Hobby, ≈ US$ 5 por mês): use o `Dockerfile` da pasta `servidor`.
  - **Obrigatório:** crie um **volume** montado em `/app/dados`. Sem volume, os dados somem a cada atualização.
  - Fly.io: `fly launch` dentro da pasta `servidor`, depois `fly volumes create dados --size 1`, e no `fly.toml` coloque `[mounts] source="dados" destination="/app/dados"`.
  - Para criar clínicas: `fly ssh console -C "node servidor.js nova-clinica 'Nome'"`.
  - O HTTPS é da própria plataforma.
- **Postgres grátis (Supabase, Neon)**: hoje não é necessário. O SQLite com um arquivo por clínica aguenta bem o começo. Só vale trocar com muitas clínicas e mais de um servidor ao mesmo tempo. Nesse caso, a troca fica nas funções `abrirBanco`/`bancoDaClinica` do `servidor.js`.

### Cópias de segurança

- **Automática**: a cada 6 horas o próprio servidor faz uma cópia segura de todas as clínicas em `dados/copias/`. Guarda as últimas 28, ou seja, 7 dias. A cópia inclui a chave das licenças.
- **Diária no VPS** (03:15): a cópia é compactada em `/var/backups/dente-sempre/` e guardada por 30 dias. Para mandar também para o Google Drive ou Dropbox, configure o `rclone` e crie `/etc/dente-sempre-backup.conf` com `RCLONE_DESTINO=nome:pasta`.
- **De uma clínica**: `dente-sempre copia-clinica sorriso`.
- **Restaurar uma clínica** (pode ser com o servidor ligado): `dente-sempre restaurar-clinica sorriso arquivo.db`.
  - Os aparelhos da clínica percebem a restauração e baixam tudo de novo.
  - Antes, cada aparelho guarda uma cópia do que tinha.
  - **Atenção:** alterações que algum aparelho ainda não tinha enviado se perdem.
- No próprio programa continua existindo o **backup da clínica** (Menu → Backup), que o administrador pode baixar.

### Variáveis do servidor (opcionais)

| Variável | Para quê | Padrão |
|---|---|---|
| `PORTA` | porta | 3000 |
| `HOST` | `127.0.0.1` atrás do Caddy | 0.0.0.0 |
| `PASTA_DADOS` | onde ficam os bancos | `./dados` |
| `LICENCA_DIAS_OFFLINE` | quantos dias o app funciona sem falar com o servidor | 10 |
| `COPIA_HORAS` / `COPIAS_GUARDADAS` | cópia automática | 6 / 28 |
| `MAX_CLINICAS` | limite de clínicas neste servidor | 0 (sem limite) |
| `CONFIAR_PROXY` | atrás de Caddy, Fly ou Railway | desligado |
| `LICENCA_CHAVE_PRIVADA` | a chave das licenças por variável, em vez do arquivo | — |
| `ORIGENS_PERMITIDAS` | quem pode chamar a API de dentro de um navegador | os apps |
| `LINK_DIAS` | validade máxima do link do paciente | 90 |
| `FUSO` | fuso da clínica (para saber que dia é "hoje" no link) | America/Sao_Paulo |

---

## 5. Como funciona o offline e a sincronização

- **Tudo fica guardado no aparelho.** Funciona sem internet:
  - ver a agenda do dia;
  - agendar, remarcar e cancelar;
  - cadastrar e editar paciente;
  - marcar chegou, faltou e atendido;
  - anotações e Mensagem para grupo (o WhatsApp precisa de internet para enviar).
- **Entrar sem internet**: depois de entrar uma vez com internet, o usuário pode entrar sem internet com a mesma senha.
  - Os dados de entrada ficam guardados no aparelho, protegidos pela senha da pessoa (criptografia AES).
  - Isso vale por 30 dias sem contato com o servidor.
  - 5 senhas erradas seguidas fazem esperar 1 minuto.
- **Mostra quando está offline**:
  - aparece uma faixa amarela, **"Sem internet"**, com quantas alterações esperam para enviar;
  - o indicador no topo mostra "Sem internet · 3 pendentes";
  - clicando em **"Ver o que falta enviar"**, aparece a lista, por exemplo: "Consulta · Maria · 23/10 09:00 · Agendado", "Paciente · Maria", "Anotação do dia".
- **Quando a internet volta**, o programa envia tudo sozinho e recebe o que os outros aparelhos fizeram. Com internet, as alterações saem em cerca de 2 segundos, e o programa confere o que chegou a cada 30 segundos, ao voltar para a janela e ao abrir. As regras de sincronização são as mesmas da versão anterior.
- **Conflito** (duas pessoas mexeram na mesma consulta sem internet): fica valendo a alteração mais recente, como antes.

---

## 6. Link para o paciente confirmar pelo WhatsApp

**Como a recepção usa:**

1. Toque na consulta, depois em **Enviar link para o paciente**. O botão aparece em consultas agendadas, de hoje em diante, para quem pode confirmar (Recepção e Administrador).
2. O programa garante que a consulta já está no servidor e pede um **link único** daquela consulta.
3. Abre a janela com a **mensagem pronta**, que você pode editar. Exemplo: "Olá, Maria! Sua consulta na Clínica Sorriso está marcada para terça-feira, 27/10, às 09:00, com a Dra. Ana. Para confirmar ou pedir para remarcar, toque no link: https://api.seudominio.com.br/p/…"
4. **Abrir WhatsApp** abre a conversa com a mensagem: no computador pelo WhatsApp Web, no celular direto no app do WhatsApp. Também há o botão **Copiar link**.

**O que o paciente vê** (no navegador do celular dele, sem instalar nada):

- o nome da clínica (e o logo, se houver);
- "Olá, Maria!", só com o primeiro nome;
- a data por extenso, o horário, o dentista e o procedimento;
- os botões **Confirmar presença** e **Preciso remarcar**. Depois de responder, ele ainda pode mudar de ideia pelo mesmo link.

**Como a resposta chega na agenda:**

- O servidor grava a resposta como uma alteração da agenda, e ela chega a todos os aparelhos pela sincronização normal (em até 30 segundos).
- No cartão da consulta aparece **✓ Confirmado pelo paciente** (verde) ou **↻ Pediu remarque** (amarelo).
- A resposta também aparece no detalhe da consulta e na Lista do dia.
- Na hora em que a resposta chega, aparece um aviso na tela, por exemplo: "Resposta do paciente: Maria confirmou (27/10 09:00)".
- Se a recepção **remarcar** a consulta, a resposta antiga some. O mesmo link passa a mostrar o novo horário e pede confirmação de novo.

**Segurança do link:**

- Cada link tem um código aleatório de 144 bits, impossível de adivinhar. O servidor guarda só o resumo (SHA-256) do código.
- A página mostra **só aquela consulta**. Não aparecem telefone, sobrenome, CPF, endereço nem outros pacientes.
- **Abrir** o link não muda nada: só tocar no botão grava a resposta. Assim, a prévia que o WhatsApp gera do link não confirma sozinha.
- O link deixa de valer:
  - quando a consulta passa;
  - quando a consulta é apagada;
  - quando a clínica é suspensa;
  - depois de 90 dias.
- Há limite de pedidos por endereço. A página não é indexada por buscadores e não pode ser colocada dentro de outro site.
- O link precisa do servidor: no modo sem servidor, o botão não aparece. Sem internet, o programa avisa e você tenta de novo depois.

---

## 7. Buscar consultas

Acha qualquer consulta pelo **nome do paciente** ou pelo **procedimento** (limpeza, canal, extração...), em qualquer data.

**Onde fica:**

- **Computador:** botão **Buscar** (lupa) na barra de comandos, ao lado de Pacientes. Também pela tecla **B**.
- **Celular:** a **lupa no topo**, ao lado da sincronização. A barra de baixo continua com os mesmos 5 botões.
- **Menu → Agenda → Buscar consultas**, no computador e no celular.
- **Pacientes:** o link **Buscar consultas por procedimento ou período** abre a busca já com o nome que estava digitado.

**Como usar:**

1. Digite o nome (ou parte dele) ou o procedimento. Pode misturar: `maria canal`. Acentos e maiúsculas não importam. Só números, como `98765`, busca pelo telefone. Isso vale para quem pode ver pacientes e só fora do modo ocupada.
2. Se quiser, escolha:
   - o **Período**: hoje, próximos 7 ou 30 dias, últimos 30 dias, este mês, mês passado, este ano ou **Escolher datas** (De / Até);
   - a **Situação**: agendado, atrasado/sem registro, chegou, faltou, confirmado pelo paciente ou pediu remarque;
   - o **Dentista**.
3. A lista mostra data, dia da semana, horário, paciente, procedimento, dentista e situação, da mais nova para a mais antiga.
4. **Toque no resultado** para abrir o detalhe da consulta. Ali dá para marcar Veio, remarcar etc. O link **‹ Voltar à busca** volta para a lista sem perder o que foi digitado.
5. **Ver no dia** abre a agenda naquele dia e naquele dentista, com o cartão da consulta piscando.

**Regras:**

- O **dentista** só encontra as consultas da agenda dele, e não tem o filtro de dentista. Recepção e Administrador encontram todas.
- Consultas excluídas não aparecem.
- Funciona **sem internet**, porque usa os dados que já estão no aparelho.
- A busca não muda nada nos dados, só procura.
- Para não travar, mostra no máximo 200 resultados e avisa para refinar.

---

## 8. Ativação e o que já está preparado para vender

### Criar uma clínica (com o servidor ligado)

```bash
dente-sempre nova-clinica "Clínica Sorriso" --plano basico
```

Mostra:

```
Clínica "Clínica Sorriso" criada.
  Código da clínica: sorriso
  Plano: Básico
  Primeiro acesso: usuário admin, senha provisória ...
  Chave de ativação: DSEM-XXXX-XXXX-XXXX
```

### Primeiro uso na clínica

1. Instale o aplicativo no computador ou no celular.
2. Na entrada, digite o **código da clínica**, o usuário `admin` e a senha provisória. O programa pede para criar uma senha nova.
3. O programa pede a **chave de ativação**. Isso liga **este aparelho** a **esta clínica**, e a licença assinada fica guardada no aparelho.
4. O administrador cria os usuários da recepção e dos dentistas, como antes. Em cada aparelho novo, a pessoa entra e ativa com a mesma chave. Cada aparelho conta no limite do plano.

O nome de usuário é **único dentro da clínica**: duas clínicas podem ter, as duas, o usuário `recepcao`.

### Planos (arquivo `servidor/planos.js`)

| Plano | Aparelhos | Dentistas ativos | Usuários | Validade |
|---|---|---|---|---|
| Teste grátis | 2 | 2 | 4 | 14 dias |
| Básico | 3 | 2 | 6 | até a data do plano |
| Profissional | 10 | 8 | 20 | até a data do plano |

Os preços ficam em `planos.js` (hoje vazios). Os limites são conferidos **no servidor**, e o programa avisa antes, por exemplo: "O plano Básico permite até 2 dentistas ativos."

### Comandos de venda e suporte (todos com o servidor ligado)

```bash
dente-sempre clinicas                                  # lista clínicas, plano, situação, aparelhos
dente-sempre plano sorriso profissional --ate 2027-10-31
dente-sempre suspender sorriso                         # ex.: pagamento atrasado (o app bloqueia)
dente-sempre reativar sorriso
dente-sempre aparelhos sorriso                         # quais aparelhos estão ativados
dente-sempre revogar-aparelho sorriso pc-1a2b3c...     # aparelho perdido ou roubado
dente-sempre liberar-aparelho sorriso pc-1a2b3c...     # libera a vaga
dente-sempre nova-chave sorriso                        # chave nova (a antiga deixa de ativar aparelhos novos)
dente-sempre senha-admin sorriso                       # senha provisória nova para o administrador
```

### Proteção contra cópia, crack e falsificação

O que foi feito:

- **Licença assinada** (ECDSA P-256).
  - A chave que assina fica só no servidor. O aplicativo tem só a chave pública: ele confere a licença, mas não consegue criar uma.
  - Mudar o plano ou a data dentro da licença quebra a assinatura, e o programa bloqueia.
- **Ligada à clínica e ao aparelho.**
  - No computador, o aparelho é identificado pela máquina (ID do sistema), não por algo que se copia. Copiar a pasta do programa para outro computador não leva a ativação junto.
  - No celular, vale o ID do aparelho.
  - Reinstalar no mesmo computador reaproveita a vaga.
- **O servidor é quem manda.**
  - Todo envio, recebimento, backup e ativação passa pela conferência de sessão, licença, aparelho, situação da clínica e limites do plano.
  - Clínica suspensa, aparelho revogado ou plano vencido são recusados no servidor, mesmo que alguém altere o aplicativo.
- **Sem internet por muito tempo**: a licença precisa ser renovada a cada 10 dias. A renovação acontece sozinha em cada sincronização. Voltar o relógio do aparelho para enganar o prazo é detectado.
- **Isolamento**: a clínica de cada pedido vem da **sessão** (do servidor), nunca de algo que o aparelho manda. Os testes conferem que uma clínica não lê, não grava e não ativa nada de outra.
- **Senhas**: guardadas com scrypt no servidor. Há limite de tentativas por usuário e por endereço.
- **Aplicativos**:
  - o código vai embaralhado (ofuscado) dentro dos apps;
  - o app de computador tem as travas do Electron ligadas: não roda como Node, não aceita depuração por linha de comando e confere a integridade do pacote;
  - o servidor não entrega o programa para navegador e só aceita chamadas dos apps (CORS).

O que **nenhum** programa consegue impedir 100%: alguém com muito conhecimento pode alterar o aplicativo instalado no próprio aparelho. Mesmo assim, essa pessoa **não consegue sincronizar, ativar aparelhos novos nem usar o servidor** sem licença válida, porque a conferência de verdade está no servidor. Para um programa de agenda com dados na nuvem, essa é a proteção que vale.

---

## 9. O que ficou pronto e o que falta para vender

### Pronto

- Aplicativo de computador: aqui foram gerados o instalador do Windows e os do Linux. O Mac é gerado pelo GitHub. O app foi testado no Linux ligado a um servidor de verdade: entrou, ativou, foi identificado pela máquina e sincronizou.
- Aplicativo de celular Android (o APK é gerado pelo GitHub), com a base do iPhone pronta.
- Funcionamento sem internet: agenda, pacientes, chegou e faltou, entrada sem internet, aviso "Sem internet" e lista do que falta enviar. A sincronização automática acontece quando a internet volta.
- Servidor com um banco por clínica:
  - mesmo nome de usuário em clínicas diferentes;
  - backup e restauração por clínica;
  - criar clínica e chave com o servidor ligado.
- Licença assinada, ligada à clínica e ao aparelho, com renovação, suspensão e revogação.
- Planos (Teste, Básico, Profissional) com limites de aparelhos, dentistas e usuários conferidos no servidor.
- Link para o paciente confirmar ou pedir remarque pelo WhatsApp, com a resposta aparecendo na agenda.
- Busca de consultas por paciente, procedimento, período, situação e dentista. Respeita as permissões e funciona sem internet.
- Telas ajustadas para o celular: barra embaixo, cartões maiores, janelas de baixo para cima e WhatsApp direto no app.
- O pagamento está preparado (`aoConfirmarPagamento` em `planos.js`) e o painel tem as rotas reservadas (`/api/painel/...`).
- Instalação em VPS com HTTPS automático, cópias automáticas e Dockerfile.
- Todas as funções de antes continuam iguais, inclusive as permissões:
  - agenda, pacientes, dentistas e permissões;
  - Mensagem para grupo e personalização;
  - backup e modo "ocupada".

### Falta para começar a vender

1. **Contratar o servidor e o domínio** e rodar o `instalar-vps.sh`. Depois, gerar os apps com o endereço e a chave de verdade.
2. **Pagamento** (Mercado Pago, Asaas, Stripe...). Falta ligar o aviso de pagamento confirmado ao `aoConfirmarPagamento` em `planos.js`, que já muda o plano e a data.
3. **Painel de administração** (tela para você criar clínicas, ver aparelhos e suspender). Hoje isso é feito pelos comandos `dente-sempre ...`, e as rotas estão reservadas em `/api/painel/`.
4. **Assinatura digital dos instaladores**:
   - Windows: certificado de assinatura de código, ≈ US$ 100 a 400 por ano. Sem ele, o Windows mostra "Editor desconhecido".
   - Mac: conta Apple Developer, US$ 99 por ano.
5. **Lojas**:
   - Google Play: US$ 25, uma vez só. Precisa gerar a chave de assinatura do Android e o pacote AAB.
   - App Store: US$ 99 por ano, e é preciso um Mac com Xcode para gerar o iPhone.
6. **Parte legal**: termos de uso, política de privacidade e contrato de tratamento de dados (LGPD). Dados de pacientes são dados pessoais, e um advogado deve revisar.
7. **Suporte**: um e-mail ou WhatsApp de suporte para colocar nas mensagens "Fale com o suporte".
8. **Testar o APK num celular de verdade.** Ele é gerado pelo GitHub ou pelo Android Studio, porque este ambiente não baixa o kit do Android. O visual do celular e o WhatsApp foram testados num navegador do tamanho de um celular, simulando o app. O app de computador foi testado no Linux; vale abrir o instalador num Windows de verdade antes de vender.
