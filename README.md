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
│   ├── area.js                   ← área do paciente: entra com telefone + código e vê as próprias consultas
│   ├── pagamento.js              ← pagamento pelo Mercado Pago: /assinar e o aviso automático (seção 12)
│   ├── painel.js                 ← painel de administração em /painel, com senha (seção 12)
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
7. Para cobrar pela internet, configure o Mercado Pago e use o painel `/painel` (seção 12).

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
2. Preencha `app/config.json` com o endereço do servidor e a chave pública (`dente-sempre chave-publica`) e envie para o GitHub. Não precisa de secrets.
3. Rode **Actions → Gerar aplicativos** (ou crie uma etiqueta `v1.2.0`).

Saem o instalador do Windows (.exe) e o APK de teste do Android, sem assinatura. Mac, Linux e o Android assinado são gerados no computador. Detalhes e assinatura digital: `app/LEIA-ME-APPS.md`.

## 3. Como gerar o aplicativo de celular

**Android:**

- **Pelo GitHub (recomendado):** a mesma execução de **Actions → Gerar aplicativos** gera o `app-debug.apk`, para teste. O APK e o `.aab` assinados, para a Google Play, são gerados no computador (abaixo).
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

Depois disso, use o comando **`dente-sempre`** no VPS para tudo (veja a seção 11).

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
| `FUSO` | fuso da clínica (para saber que dia e hora é no link e na área do paciente) | America/Sao_Paulo |
| `AREA_CODIGO_HORAS` | validade do código da área do paciente | 48 |
| `AREA_SESSAO_DIAS` | o paciente fica conectado por até tantos dias sem uso | 30 |

As variáveis do pagamento e do painel estão na seção 12.

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

## 8. Área do paciente

O paciente entra pelo endereço **`https://api.seudominio.com.br/area`** com o **telefone** e um **código**, e vê só as consultas dele.

**1. A clínica escolhe as regras (uma vez, pelo administrador):** Menu → Configurações → **Área do paciente**.

- **WhatsApp da recepção:** vira o botão "Falar com a recepção pelo WhatsApp". Em branco, o botão não aparece.
- **O paciente pode cancelar pela área:** ligado ou desligado.
- **Remarcar e cancelar só até:** de "até a hora da consulta" a "3 dias antes". O padrão é 24 horas. Depois desse prazo, a área pede para o paciente falar com a recepção. Confirmar presença vale até a hora da consulta.

Essas regras sincronizam como as outras configurações. A opção só aparece com o servidor ligado.

**2. A recepção manda o acesso:** Pacientes → abra o paciente → **Enviar acesso à área do paciente**.

1. O programa envia os dados do paciente para o servidor, se faltar, e pede um **código de 6 números**.
2. Abre a mensagem pronta, que você pode editar. Exemplo: "Olá, Maria! Esta é a sua área do paciente da Clínica Sorriso… https://api.seudominio.com.br/area?codigo=482913. Para entrar, use o seu telefone com DDD e o código 482913."
3. **Abrir WhatsApp** ou **Copiar mensagem**.

O código vale **uma vez** e por **48 horas**. Um código novo substitui o anterior. O botão aparece para Recepção e Administrador.

**3. O paciente entra e usa** (no navegador do celular, sem instalar nada):

1. Toca no link: o código já vem preenchido. Ele digita o telefone com DDD, do jeito que quiser: `(11) 98765-4321`, `11987654321` ou `+55 11 98765-4321`.
2. Vê **Próximas consultas** (data, hora, procedimento e dentista) e **Consultas anteriores** (realizada, não compareceu ou cancelada).
3. Em cada próxima consulta, conforme as regras:
   - **Confirmar presença**;
   - **Pedir para remarcar**;
   - **Cancelar consulta**, que pede confirmação antes.
4. **Falar com a recepção pelo WhatsApp** abre a conversa com a recepção, já com o nome dele.
5. Ele continua conectado naquele celular por até 30 dias sem uso. **Sair deste aparelho** desconecta.

**Como a clínica vê as ações:** igual ao link simples.

- A ação vira uma resposta na agenda e chega a todos os aparelhos pela sincronização (em até 30 segundos).
- **No cartão da consulta:** ✓ Confirmado pelo paciente (verde), ↻ Pediu remarque (amarelo) ou **✕ Paciente cancelou** (vermelho).
- **No detalhe da consulta:** "Paciente cancelou · pela área do paciente".
- **Também aparece** na **Lista do dia**, no aviso na tela ("Resposta do paciente: Maria cancelou (04/11 15:00)") e na **Busca**, pela situação "Paciente cancelou".
- O cancelamento **não apaga** a consulta sozinho. A recepção vê o aviso e libera o horário (Excluir) quando quiser.
- Se a recepção remarcar a consulta, a resposta antiga some, como no link.

**Segurança:**

- **O paciente só vê o que é dele.** O servidor busca as consultas pelo paciente da sessão. Ele não vê outros pacientes, anotações, CPF, endereço, telefone nem dados internos da clínica. Pedir ação numa consulta de outra pessoa é recusado.
- **Entrar exige o telefone do cadastro e o código juntos.** O código vale uma vez e vence em 48 horas.
- **Tentativas erradas:** 5 seguidas no mesmo telefone, ou 20 do mesmo endereço, fazem esperar 15 minutos.
- **O servidor guarda só resumos** (SHA-256) do código, da sessão e do telefone.
- **A sessão** fica num cookie que o JavaScript não lê (HttpOnly), enviado só por HTTPS e só para `/area`. Cada botão leva uma senha da sessão, contra ataque de outro site.
- **A sessão acaba sozinha** se a recepção mudar o telefone do paciente, se o paciente for apagado, se a clínica for suspensa ou depois de 30 dias sem uso.
- **A página** não tem JavaScript, não é indexada por buscadores e não abre dentro de outro site.

**Arquivo:** `servidor/area.js`. As rotas são:

- `GET /area`: entrada ou lista de consultas;
- `POST /area/entrar`, `POST /area/acao` e `POST /area/sair`;
- `POST /api/area/convite`, para o app.

O resto do servidor não mudou. O link simples (`/p/...`) continua igual.

---

## 9. Controle de próteses (módulo opcional)

Acompanha as próteses enviadas ao laboratório: quem é o protético, quando foi, quando volta, se atrasou, e o histórico de idas e voltas. **Desligado, nada aparece**: a agenda, os pacientes e o resto ficam exatamente como antes.

**Ligar:** o administrador vai em Menu → Configurações → **Módulo de próteses**, marca "Ligar o controle de próteses" e escolhe o **prazo padrão do laboratório**. O padrão é 10 dias, e ele serve para sugerir o retorno previsto. Desligar só esconde o módulo: nada é apagado. A escolha vale para todos os aparelhos da clínica, pela sincronização.

**Onde fica** (com o módulo ligado):

- **Menu → Próteses:** a lista geral. No Menu já aparece "3 em andamento" e, se houver, **"1 em atraso"** em vermelho.
- **Menu → Protéticos (laboratórios):** cadastro com nome, WhatsApp e observação. Um protético que não é mais usado pode ser marcado como inativo.
- **Ficha do paciente** (Pacientes → paciente): "**Tem prótese?** Sim / Não". Com Sim, aparecem as próteses dele e o botão **+ Cadastrar prótese**.

**Cadastrar uma prótese**, pela ficha ou por Próteses → **+ Nova prótese**:

- **Tipo / descrição:** coroa, protocolo, PPR etc. A lista sugere os tipos, mas pode escrever qualquer coisa.
- **Protético responsável**, com o link "+ Cadastrar protético" ali mesmo.
- **Data de envio.** Em branco, a prótese fica como "Aguardando envio".
- **Retorno previsto:** é preenchido sozinho com a data de envio mais o prazo padrão, e pode ser mudado.
- **Anotações**, como cor e material.

**O caminho de uma prótese** (botões no detalhe dela):

| Situação | Botões |
|---|---|
| Aguardando envio | Enviar ao laboratório |
| No laboratório | Voltou pronta · Voltou para prova · Mensagem para o protético · Mudar o retorno previsto |
| **Em atraso** (no laboratório e passou do retorno previsto) | os mesmos, com **Cobrar o protético** em destaque |
| Na clínica (prova) | Reenviar ao laboratório · Ficou pronta |
| Pronta para entregar | Entregue ao paciente · Voltar ao laboratório |
| Entregue / Cancelada | saem de "Em andamento" e continuam no histórico |

Cada passo fica no **Histórico de envios e retornos**, com data, hora e quem fez. Ficam guardadas também a data em que a prótese voltou e a data em que foi entregue.

**Atraso e cobrança:**

- **Na lista de próteses:** faixa vermelha "1 prótese em atraso no laboratório", com o link "Ver só as atrasadas". As atrasadas aparecem primeiro, com "Em atraso · 5 dias" e o botão **Cobrar**.
- **Ao entrar no programa:** aviso uma vez por dia, por exemplo "2 próteses estão em atraso no laboratório. Veja em Menu → Próteses.". O aviso aparece na tela da agenda, sem mudar a agenda.
- **Cobrar** abre a mensagem pronta, que pode ser editada. Exemplo: "Olá, Carlos! Aqui é da Clínica Sorriso. A prótese (Coroa) do(a) paciente Maria Souza foi enviada em 14/10, com retorno previsto para 26/10, e ainda não chegou (3 dias de atraso). Consegue me dizer quando fica pronta? Obrigado(a)!"
- **Abrir WhatsApp** abre a conversa com o protético, e a cobrança fica registrada no histórico.

**Filtros na lista:**

- **Situação:** em andamento, em atraso, aguardando envio, no laboratório, na clínica, pronta, entregues, canceladas ou todas.
- **Protético.**
- **Busca** por paciente ou tipo.

**Quem usa:**

- Recepção e Administrador veem e mudam.
- Só o Administrador liga ou desliga o módulo.
- O dentista não vê o módulo, como já acontece com a lista de pacientes.

**Sem internet e sincronização:**

- Funciona sem internet, como o resto do programa.
- As próteses e os protéticos sincronizam entre os aparelhos como os pacientes.
- O servidor não precisou mudar.
- Enquanto o módulo não é usado, nada novo é enviado.

---

## 10. Regras do dia: dia passado e status obrigatório

Duas regras protegem o registro de quem veio e quem faltou. Elas valem no computador e no celular, com ou sem internet.

### Dia passado: só o administrador altera

Depois que o dia termina, as consultas daquele dia ficam travadas para a **Recepção** (o Dentista já não muda a agenda). Num dia passado, a recepção não consegue:

- criar horário, nem encaixe;
- alterar, remarcar ou excluir uma consulta;
- marcar Veio ou Não veio, nem liberar o horário de uma falta.

Quando alguém tenta, aparece o aviso **"Este dia já passou. Só o administrador pode alterar."**:

- no detalhe da consulta, os botões de mudar saem e o aviso fica no lugar (o WhatsApp continua);
- no botão direito, no clique num horário livre e nos atalhos, aparece o mesmo aviso embaixo da tela;
- se a data de um novo horário for mudada para um dia que já passou, o formulário não salva e mostra o aviso.

Olhando um dia passado, o botão **Novo horário** abre já com a data de hoje.

**O administrador não tem trava:** entra com o usuário dele e altera, remarca, exclui ou muda o status de qualquer dia, como antes. Se a recepção precisar corrigir um dia passado, chama o administrador, ou sai e entra como administrador.

Ver o dia passado continua igual para todos: agenda, lista do dia, busca e histórico do paciente.

### Status obrigatório: nenhum paciente fica em aberto

Toda consulta precisa terminar com **Veio** (Chegou) ou **Não veio** (Faltou).

**Tela de pendências ao abrir.** Ao entrar no programa, se alguma consulta de um dia anterior ficou sem status, aparece uma tela que cobre a agenda. Ela lista essas consultas por dia ("Ontem · Quinta-feira, 29 de outubro"), com hora, paciente, tipo e dentista, e os botões **Veio** e **Não veio**.

- Cada toque grava na hora e a linha sai da lista.
- Quando a lista acaba, a tela some e aparece "Pronto. Todas as consultas têm status e a agenda está liberada.".
- Para a recepção, esta tela é a única forma de dar status a uma consulta de dia passado, e só a uma que ficou sem status.
- O administrador também vê a tela e tem o link **Abrir**, para excluir ou remarcar em vez de marcar (por exemplo, quando o paciente desmarcou por telefone e ninguém tirou da agenda).
- O link **Sair** permite entrar com outro usuário.
- O dentista não recebe a tela, porque não muda a agenda.

A tela também aparece se o programa ficar aberto de um dia para o outro: ao virar o dia, ou ao voltar para o app do celular.

**Pendências do dia (Menu → Recepção do dia).** Mostra quantas estão sem status ("2 sem status" ou "Em dia"). Abre a lista das consultas de dias anteriores e também as **de hoje que já passaram do horário**. Assim dá para fechar o dia no fim do expediente.

**Ao fechar o programa do computador.** Se houver consulta sem status, o programa não fecha direto. Aparece a janela "**Ainda tem paciente sem status**", com a lista e os botões Veio / Não veio, e mais:

- **Voltar ao programa**;
- **Fechar mesmo assim** (para uma emergência). Nesse caso, na próxima abertura a tela de pendências pede os status antes de liberar a agenda.

Marcando todos, a janela diz "Tudo marcado. Já pode fechar o programa.".

**Ao sair (encerrar sessão),** a janela de Sair avisa quem está sem status, com o link "Marcar agora".

**No celular** não dá para impedir que o app seja fechado ou que o telefone desligue. Por isso o controle é feito na próxima abertura: a tela de pendências aparece antes da agenda.

**De quando conta:** as pendências contam a partir do dia anterior à primeira abertura desta versão em cada aparelho. O histórico antigo que ficou "Sem registro" não trava ninguém. O administrador pode corrigi-lo quando quiser.

Detalhes:

- As regras ficam no programa, e o servidor não mudou. Uma alteração feita sem internet no dia continua sincronizando normalmente no dia seguinte.
- Bloqueios e almoço não mudaram.
- As permissões de antes continuam iguais. A regra do dia passado só restringe ainda mais quem não é administrador.

---

## 11. Ativação e o que já está preparado para vender

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

## 12. Pagamento e painel de administração

Duas páginas novas no servidor. Elas só funcionam depois de configuradas: sem a configuração, o painel aparece como "desligado" e a página de assinatura não mostra o formulário de pagar. Nada do programa muda.

| Página | Quem usa | Para quê |
|---|---|---|
| `https://api.seudominio.com.br/assinar` | o **administrador da clínica** | escolher o plano (Básico ou Profissional) e fazer a **assinatura mensal** no Mercado Pago, com cobrança automática todo mês. Também mostra e **cancela** a assinatura |
| `https://api.seudominio.com.br/painel` | **só você** (dono do Dente Sempre), com senha | ver e cuidar de todas as clínicas |

### Assinatura mensal (cobrança automática)

Desde 31/10 a página `/assinar` faz uma **assinatura recorrente** (Mercado Pago Assinaturas) no lugar do pagamento único. O código fica em `servidor/assinatura.js`.

O que o administrador vê já na escolha do plano, em cada plano:
- **Assinatura mensal**
- **Primeiro mês: R$ XX** (com o desconto, quando há `PRECO_..._PROMO` e é a primeira assinatura da clínica)
- **A partir do segundo mês: R$ YY**
- **Você pode cancelar quando quiser**
- **Cobrança automática todo mês (cartão de crédito)**, ou **(cartão ou Pix)** com `ASSINATURA_PIX=1` (veja abaixo)

Como funciona:
1. O administrador escolhe o plano, digita o código da clínica, o usuário e a senha de administrador e o **e-mail da conta do Mercado Pago** que vai pagar. Recepção e dentista não conseguem.
2. O servidor cria a assinatura no Mercado Pago (mensal, em reais) e leva a pessoa para a página do Mercado Pago, onde ela autoriza a cobrança.
3. **A cada mês**, quando o Mercado Pago aprova a cobrança, ele avisa o servidor. O servidor pergunta ao próprio Mercado Pago se a cobrança está aprovada, em reais e no valor certo, e chama `aoConfirmarPagamento` com 1 mês. O plano e a validade mudam sozinhos, e os aparelhos recebem na próxima sincronização.
4. **Desconto do primeiro mês:** a assinatura começa com o valor promocional. Depois da primeira cobrança aprovada, o servidor muda o valor da assinatura no Mercado Pago para o preço normal. Se o Mercado Pago não aceitar na hora, ele tenta de novo no próximo aviso.
5. **Cancelar:** em `/assinar` → **Já assina? Ver ou cancelar a assinatura**. O administrador entra, vê a situação, o valor, os meses pagos e as cobranças, marca "Quero cancelar" e confirma. O servidor cancela no Mercado Pago, e não há novas cobranças. **Os dias já pagos continuam valendo.** Você também pode cancelar pelo painel do próprio Mercado Pago (Seu negócio → Assinaturas); o servidor fica sabendo pelo aviso.
6. **Trocar de plano:** cancele a assinatura atual e assine de novo. Os dias já pagos continuam valendo, e o mês novo começa a contar depois deles.

Cuidados que já estão no código:
- Cada cobrança vale **uma vez só**, mesmo que o aviso chegue repetido ou por dois caminhos.
- Cobrança com valor diferente do combinado não muda o plano (fica anotada no servidor).
- A clínica não consegue ter duas assinaturas ativas ao mesmo tempo.
- Se o cartão for recusado várias vezes, o Mercado Pago **pausa** a assinatura. A página mostra "Pausada" e o plano vence na data de sempre.
- Cobrança devolvida ou contestada aparece como "Devolvido" no painel, e o plano não volta sozinho.
- As cobranças aparecem no painel em **Pagamentos** e na ficha da clínica, como antes (o painel não mudou).
- Pagamentos avulsos feitos antes desta mudança continuam sendo conferidos normalmente.
- Para voltar ao pagamento avulso antigo, ponha `ASSINATURA_RECORRENTE=0` e religue.

#### Pix na assinatura

O Mercado Pago cobra a assinatura pelo **cartão de crédito** (e, em algumas contas, pelo saldo do Mercado Pago). A cobrança automática por **Pix (Pix Automático)** nas assinaturas depende de o Mercado Pago **liberar na sua conta**: pergunte ao suporte do Mercado Pago se o Pix Automático está disponível para as suas assinaturas. Quando estiver, coloque `ASSINATURA_PIX=1` em `/etc/dente-sempre.env` e religue. A página passa a dizer "Cobrança automática todo mês (cartão ou Pix)". Sem isso, ela diz "(cartão de crédito)", para não prometer ao cliente algo que a página do Mercado Pago não vai oferecer.

#### Botão "Falar com o suporte para pagar via Pix"

Para quem prefere pagar por Pix direto com você, a página `/assinar` pode mostrar um botão verde **"Falar com o suporte para pagar via Pix"**, logo abaixo de "Assinar e ir para o pagamento".

Para ligar, coloque o número do WhatsApp do suporte em `/etc/dente-sempre.env` e religue:
```
SUPORTE_WHATSAPP=11912345678
```
```bash
systemctl restart dente-sempre
```
- Pode escrever com DDD, com ou sem o 55 do Brasil, e com ou sem espaços, parênteses e traço: `(11) 91234-5678`, `11912345678` e `5511912345678` dão no mesmo.
- O botão abre o WhatsApp com a mensagem pronta: *"Olá! Quero assinar o plano Profissional da Agenda Dente Sempre. Código da clínica: sorriso."* O plano é o que estiver marcado na página e o código é o que estiver escrito no campo. Sem código escrito, a mensagem vai só com o plano.
- Não precisa digitar senha para usar o botão. A senha e o e-mail **não** vão na mensagem.
- Se o Mercado Pago ainda não estiver configurado, o botão aparece embaixo do aviso "A assinatura pela internet ainda não está disponível".
- Variável vazia (ou número inválido): o botão não aparece e a página fica exatamente como antes.
- Quando a clínica pagar pelo Pix, mude o plano e a validade dela no painel (ficha da clínica → mudar plano e validade).

#### O e-mail do pagador

O Mercado Pago exige o e-mail da conta de quem vai pagar. Se a pessoa entrar no Mercado Pago com outro e-mail, ele pode recusar a autorização. Por isso a página pede o e-mail e avisa: "Use o mesmo e-mail com que você vai entrar no Mercado Pago na próxima tela".

### Configurar o Mercado Pago (uma vez)

1. Crie uma conta de vendedor no Mercado Pago (de preferência com CNPJ) e entre em **mercadopago.com.br/developers → Suas integrações → Criar aplicação**. Escolha **Pagamentos on-line → Checkout Pro**.
2. Na aplicação, abra **Credenciais de produção** e copie o **Access Token** (começa com `APP_USR-`). Ele é secreto: não mande por WhatsApp nem coloque no site.
3. Ainda na aplicação, abra **Webhooks → Configurar notificações**:
   - Modo de produção, URL: `https://api.seudominio.com.br/api/pagamento/aviso`
   - Eventos: marque **Pagamentos**, **Planos e assinaturas** e **Pagamentos recorrentes** (os dois últimos são os da assinatura mensal; Pagamentos continua para os pedidos avulsos antigos).
   - Salve e copie a **Assinatura secreta** que aparece.
4. No VPS, edite o arquivo de configuração (o `instalar-vps.sh` já cria ele):
   ```bash
   nano /etc/dente-sempre.env
   ```
   e preencha:
   ```
   MP_ACCESS_TOKEN=APP_USR-...........
   MP_WEBHOOK_SEGREDO=a-assinatura-secreta-do-passo-3
   PRECO_BASICO=99,90
   PRECO_PROFISSIONAL=199,90
   ```
   Os preços são **por mês**. Os valores acima são só exemplo: use os seus.
5. Religue: `systemctl restart dente-sempre`.
6. Teste: abra `https://api.seudominio.com.br/assinar`. Devem aparecer os planos com os seus preços. Faça uma assinatura de verdade com um valor pequeno (por exemplo, criando uma clínica de teste), veja no painel se o plano mudou e depois cancele em **Ver ou cancelar a assinatura**.

> Em Fly.io, Railway ou Render, coloque as mesmas variáveis na configuração do serviço (Secrets/Variables), junto com `ENDERECO_PUBLICO=https://seu-endereco`.

### Pagamento avulso (como era antes de 31/10)

Esta parte só vale com `ASSINATURA_RECORRENTE=0`, ou para os pedidos avulsos feitos antes da assinatura mensal. O servidor continua conferindo esses pedidos.


1. O administrador da clínica abre a página de assinatura. Ele pode chegar por três caminhos:
   - no programa, em **Menu → Configurações → Assinar ou renovar o plano** (aparece só para o administrador, quando há servidor);
   - pelo botão **Assinar** do site de venda;
   - pelo endereço direto.
2. Ele escolhe o plano e o período (1, 3, 6 ou 12 meses) e digita o **código da clínica, o usuário e a senha de administrador** (os mesmos do programa). Recepção e dentista não conseguem pagar.
3. O servidor cria o pedido e leva a pessoa para a página do Mercado Pago.
4. Quando o pagamento é aprovado, o Mercado Pago avisa o servidor. O servidor **não confia no aviso**: ele pergunta ao próprio Mercado Pago como está aquele pagamento. Só muda o plano se o pagamento estiver aprovado, em reais e no valor certo do pedido.
5. Com tudo certo, o servidor chama `aoConfirmarPagamento` (em `planos.js`) e grava o plano e a data nova. Os meses pagos começam a contar **depois** dos dias que a clínica ainda tem (de teste ou de plano).
6. Os aparelhos recebem o plano novo na próxima sincronização.

Cuidados que já estão no código:
- Um mesmo pagamento vale **uma vez só**. Se o aviso chegar repetido, os meses não são somados de novo.
- Avisos sem a assinatura secreta certa são recusados.
- Cinco senhas erradas na página de assinatura bloqueiam novas tentativas por 15 minutos.
- Uma clínica **suspensa** que paga volta a ficar **ativa**, porque é isso que o `aoConfirmarPagamento` faz.
- Se um pagamento for **devolvido ou contestado** depois, o painel mostra "Devolvido", mas o plano **não volta sozinho**. Você decide no painel (por exemplo, mudando a data ou suspendendo a clínica).

### Acessar o painel

1. A senha do painel fica em `/etc/dente-sempre.env`, na linha `PAINEL_SENHA`. O `instalar-vps.sh` cria uma senha aleatória de 20 caracteres e mostra o endereço no fim da instalação. Para ver ou trocar a senha:
   ```bash
   nano /etc/dente-sempre.env
   systemctl restart dente-sempre
   ```
   A senha precisa ter **pelo menos 12 caracteres**. Sem ela, o painel fica desligado. Trocar a senha desconecta quem estava dentro.
2. Abra `https://api.seudominio.com.br/painel` e digite a senha. Você fica conectado até ficar 12 horas sem usar o painel, ou até clicar em **Sair**.

O que dá para fazer no painel:

| Tela | O que faz |
|---|---|
| **Clínicas** | lista de todas as clínicas, com plano, situação, validade e aparelhos em uso; busca por nome ou código; totais no topo |
| **Nova clínica** | cria a clínica com plano e dias. Mostra o código, o usuário, a senha provisória e a chave de ativação, e já monta o texto para mandar à clínica |
| Ficha da clínica (clique no nome) | **suspender / reativar**; **gerar chave nova** (as antigas continuam valendo); **senha nova do administrador**; **mudar plano e validade** à mão; **login e senha de cada usuário**; ver os **aparelhos ativados** e desativar ou liberar cada um; ver as chaves e os pagamentos da clínica |
| **Pagamentos** | se o Mercado Pago está configurado e todos os pedidos, com a situação de cada um |

Proteções do painel:
- cinco senhas erradas bloqueiam o acesso por 15 minutos;
- o cookie só vale para `/painel`, só por HTTPS e não é lido por scripts;
- todo botão tem uma proteção contra envio a partir de outro site;
- as páginas não aparecem no Google.

Os comandos `dente-sempre ...` da seção 11 continuam funcionando do mesmo jeito.

### Login e senha dos usuários

Na ficha da clínica, a caixa **Usuários e senhas** mostra o nome, o login, a senha, o perfil e a situação de cada usuário. A senha continua aparecendo depois de sair e entrar de novo no painel, e não é preciso gerar senha nova para ver a atual.

- O servidor confere a senha do jeito de antes (resumo scrypt com sal). Além disso, guarda uma cópia **criptografada** (AES-256-GCM) para o painel. A senha não fica em texto puro no banco, e o programa da clínica nunca recebe essa cópia.
- A cópia é feita sempre que o servidor recebe a senha: clínica criada, senha nova do administrador, usuário criado ou com senha trocada, e troca da própria senha.
- **Quem já tinha senha antes desta versão:** aparece "aparece quando a pessoa entrar de novo". A senha aparece depois do próximo login daquela pessoa.
- **A chave da criptografia** fica no arquivo `dados/chave-senhas.key`, criado sozinho (só o usuário do servidor lê). Ela vai junto com as cópias da pasta `dados`. Para guardar a chave separada dos dados, coloque `SENHAS_CHAVE=` com um texto longo e aleatório em `/etc/dente-sempre.env` antes de criar as clínicas. Se a chave mudar, as senhas guardadas voltam a aparecer só depois do próximo login de cada pessoa.
- Quem tem a senha do painel vê as senhas de todas as clínicas. Guarde bem a `PAINEL_SENHA`.

### Variáveis do pagamento e do painel

| Variável | Para quê | Padrão |
|---|---|---|
| `PAINEL_SENHA` | senha do painel (mínimo 12 caracteres) | — (painel desligado) |
| `PAINEL_SESSAO_HORAS` | depois de quantas horas sem uso o painel pede a senha de novo | 12 |
| `MP_ACCESS_TOKEN` | Access Token de produção do Mercado Pago | — (pagamento desligado) |
| `MP_WEBHOOK_SEGREDO` | assinatura secreta dos webhooks | — (recomendado) |
| `ENDERECO_PUBLICO` | endereço do servidor na internet, ex.: `https://api.seudominio.com.br` | o endereço do pedido |
| `PRECO_BASICO` / `PRECO_PROFISSIONAL` | preço por mês, ex.: `99,90` | — (o plano sem preço não aparece) |
| `PAGAMENTO_MESES` | períodos oferecidos (só no pagamento avulso antigo) | `1,3,6,12` |
| `PRECO_BASICO_PROMO` / `PRECO_PROFISSIONAL_PROMO` | preço do primeiro mês na primeira assinatura, ex.: `49,90` | — (sem promoção) |
| `ASSINATURA_PIX` | `1` = a página diz "cartão ou Pix" (só depois que o Mercado Pago liberar o Pix Automático) | — (diz "cartão de crédito") |
| `ASSINATURA_RECORRENTE` | `0` = volta ao pagamento avulso antigo | `1` (assinatura mensal) |
| `SUPORTE_WHATSAPP` | WhatsApp do suporte para o botão "Falar com o suporte para pagar via Pix", ex.: `11912345678` | — (sem o botão) |
| `SENHAS_CHAVE` | chave que protege as senhas mostradas no painel (texto longo e aleatório). Não mude depois | — (usa `dados/chave-senhas.key`) |

### Desconto do primeiro mês

Para dar um preço promocional no primeiro mês, coloque em `/etc/dente-sempre.env` e religue (`systemctl restart dente-sempre`):

```
PRECO_BASICO_PROMO=49,90
PRECO_PROFISSIONAL_PROMO=99,90
```

- A página `/assinar` mostra **"Primeiro mês: R$ 49,90"** e **"A partir do segundo mês: R$ 99,90"** em cada plano.
- Vale na **primeira assinatura** da clínica, ou seja, enquanto ela não tem nenhum pagamento aprovado. Na renovação, o preço é o normal.
- Só o primeiro mês tem o desconto. Na assinatura mensal, a partir do segundo mês o Mercado Pago cobra o preço normal (o servidor ajusta o valor sozinho).
- O Mercado Pago recebe o valor já com o desconto, e a confirmação confere esse valor. O painel mostra o valor cobrado em cada pedido.
- Variável vazia, com texto inválido ou com valor igual ou maior que o preço normal: sem promoção. A página e a cobrança ficam exatamente como antes.
- Pode ligar a promoção num plano só (por exemplo, só o Básico).

### Botão "Assinar" no site

No `site/index.html`, preencha `assinar: 'https://api.seudominio.com.br/assinar'` no `CONFIG`. Os planos Básico e Profissional ganham o botão **Assinar**, e o botão de contato vira **Tirar dúvidas**. Vazio, o site fica como antes.

---

## 13. Importar agenda de outro sistema

Em **Menu → Configurações → Importar agenda…** (administrador e recepção; o dentista não vê).

### Que arquivos aceita

| Arquivo | Observação |
|---|---|
| CSV ou TXT | separado por ponto e vírgula, vírgula, tab ou barra; acentos do Windows ou UTF-8 |
| Excel `.xlsx` | lê a primeira folha; datas e horas do Excel são entendidas |
| `.xls` salvo como página ou XML | é o que muitos sistemas brasileiros exportam com o nome `.xls` |
| `.zip` | backup com planilhas dentro: usa a planilha da agenda (nome com "agenda", "agendamento" ou "consulta", ou a maior) |

**Global e outros sistemas:** exporte a agenda, ou o relatório de agendamentos, para Excel ou CSV e escolha esse arquivo. O arquivo do banco de dados do sistema (`.fdb`, `.gdb`, `.bak`, `.mdb`, `.sql`...) não dá para ler direto. O programa avisa e pede a planilha. O `.xls` do formato antigo do Excel também não: o programa pede para salvar como CSV ou `.xlsx`.

### Passo a passo

1. Escolha o arquivo. Aparece uma **prévia** das primeiras linhas.
2. O programa marca sozinho qual coluna é cada informação. Ele olha o nome da coluna (Paciente, Telefone, Data, Hora, Dentista ou Profissional, Procedimento) e, se não tiver nome, o conteúdo. Confira e mude o que precisar:
   - **obrigatórios:** nome do paciente, data e hora (data e hora podem estar na mesma coluna);
   - **opcionais:** telefone, dentista, procedimento, duração e situação.
3. Ligue cada dentista do arquivo a um dentista do Dente Sempre. Nomes iguais, com ou sem "Dr." e "Dra.", já vêm ligados. Se o arquivo não tem a coluna do dentista, escolha um dentista para todas as consultas.
4. Antes de importar, a tela mostra **quantas vão entrar e quantas vão ser ignoradas**, com o motivo e as primeiras consultas como vão ficar.
5. Clique em **Importar**. No fim aparecem quantas foram importadas e quantas ignoradas, com a lista das linhas ignoradas (dá para copiar).

### Regras

- **Sem duplicar:** se já existe consulta do mesmo paciente na mesma data e hora, a linha é pulada. Linhas repetidas no próprio arquivo também. Importar o mesmo arquivo duas vezes não muda nada.
- **Paciente:** usa o cadastro que já existe (mesmo nome e telefone; sem telefone, o único com aquele nome). Se não existir, cria um novo. Nomes todos em maiúsculas viram "Maria da Silva", e o telefone fica no formato (11) 98765-4321.
- **Hora:** aceita 14:30, 14h30, 9h, 2:30 PM e faixas como "10:00 às 10:40", que viram 40 minutos.
- **Data:** aceita 31/10/2026, 31/10/26, 2026-10-31 e datas do Excel.
- **Duração:** a da coluna `Duracao` (ou Duração, Tempo, Minutos), em minutos, ou a da faixa de horário, ou a escolhida na tela (30 minutos se você não mudar). Exemplo de arquivo com duração: `Data;Hora;Paciente;Telefone;Dentista;Procedimento;Duracao`.
- **Procedimento:** usa o tipo de consulta com o mesmo nome. Um nome novo entra na lista de tipos, igual ao Novo horário. Sem procedimento, usa "Consulta" (dá para mudar na tela).
- **Encaixe:** consulta fora do expediente, no almoço ou em cima de outra entra como encaixe, como a agenda já faz.
- **Ignoradas:**
  - horário bloqueado;
  - hora antes das 06:00 ou depois das 23:00;
  - situação "cancelada", "desmarcada" ou "excluída", quando a coluna de situação é escolhida;
  - dentista ligado a "Não importar";
  - data ou hora que não deu para entender.
- **Dia que já passou:** a recepção só importa de hoje em diante. O administrador importa também o histórico. O histórico antigo não entra na tela de pendências; só as consultas sem status a partir do dia em que as Regras do dia começaram a valer neste aparelho.
- **Sem internet:** funciona normalmente. As consultas e os pacientes ficam salvos no aparelho e vão para o servidor na próxima sincronização, como qualquer outra mudança.
- Limite: 20 MB e 20 mil linhas por arquivo. Para uma agenda maior, importe em partes.

---

## 14. O que ficou pronto e o que falta para vender

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
- Controle de próteses (módulo opcional): protéticos, prazos, atrasos, cobrança pelo WhatsApp e histórico de envios e retornos, na ficha do paciente e na lista geral.
- Área do paciente (`/area`): entra com telefone e código, vê só as próprias consultas, confirma, pede remarque ou cancela pelas regras da clínica e fala com a recepção pelo WhatsApp.
- Regras do dia: dia passado só o administrador altera, e nenhuma consulta fica sem Veio / Não veio (tela de pendências ao abrir, aviso ao fechar o programa do computador e ao sair).
- Busca de consultas por paciente, procedimento, período, situação e dentista. Respeita as permissões e funciona sem internet.
- Importar agenda de outro sistema (Global, CSV, Excel): prévia, escolha das colunas, sem duplicar, funciona sem internet (seção 13).
- Preço promocional do primeiro mês na página de assinatura (`PRECO_BASICO_PROMO` e `PRECO_PROFISSIONAL_PROMO`, seção 12).
- Assinatura mensal com cobrança automática no Mercado Pago: primeiro mês com desconto, plano renovado a cada cobrança aprovada e cancelamento pela própria página (seção 12).
- Botão "Falar com o suporte para pagar via Pix" na página de assinatura, que abre o WhatsApp do suporte com o plano e o código da clínica (`SUPORTE_WHATSAPP`, seção 12).
- Telas ajustadas para o celular: barra embaixo, cartões maiores, janelas de baixo para cima e WhatsApp direto no app.
- Pagamento pelo Mercado Pago (`/assinar`): o administrador escolhe o plano e paga, e o plano e a validade mudam sozinhos quando o pagamento é aprovado (seção 12).
- Painel de administração (`/painel`, com senha): lista de clínicas, criar, suspender e reativar, aparelhos, chave nova, senha nova do administrador, mudar plano, ver pagamentos e ver o login e a senha de cada usuário.
- Desfazer e Refazer (Ctrl+Z e Ctrl+Y), Editar consulta pelo botão direito, Importar e Exportar pacientes e Começar do zero (seção 15).
- Instalação em VPS com HTTPS automático, cópias automáticas e Dockerfile.
- Todas as funções de antes continuam iguais, inclusive as permissões:
  - agenda, pacientes, dentistas e permissões;
  - Mensagem para grupo e personalização;
  - backup e modo "ocupada".

### Falta para começar a vender

1. **Contratar o servidor e o domínio** e rodar o `instalar-vps.sh`. Depois, gerar os apps com o endereço e a chave de verdade.
2. **Configurar o Mercado Pago**: criar a aplicação, marcar os avisos de **Pagamentos**, **Planos e assinaturas** e **Pagamentos recorrentes**, colocar o token, a assinatura secreta e os preços em `/etc/dente-sempre.env` e fazer uma assinatura pequena de verdade (seção 12). Para oferecer Pix na assinatura, pedir ao Mercado Pago a liberação do Pix Automático e ligar `ASSINATURA_PIX=1`. O pagamento foi testado aqui com um Mercado Pago simulado, porque este ambiente não acessa o Mercado Pago de verdade.
3. **Definir os preços** do Básico e do Profissional.
4. **Assinatura digital dos instaladores**:
   - Windows: certificado de assinatura de código, ≈ US$ 100 a 400 por ano. Sem ele, o Windows mostra "Editor desconhecido".
   - Mac: conta Apple Developer, US$ 99 por ano.
5. **Lojas**:
   - Google Play: US$ 25, uma vez só. Precisa gerar a chave de assinatura do Android e o pacote AAB.
   - App Store: US$ 99 por ano, e é preciso um Mac com Xcode para gerar o iPhone.
6. **Parte legal**: termos de uso, política de privacidade e contrato de tratamento de dados (LGPD). Dados de pacientes são dados pessoais, e um advogado deve revisar.
7. **Suporte**: um e-mail ou WhatsApp de suporte para colocar nas mensagens "Fale com o suporte".
8. **Testar o APK num celular de verdade.** Ele é gerado pelo GitHub ou pelo Android Studio, porque este ambiente não baixa o kit do Android. O visual do celular e o WhatsApp foram testados num navegador do tamanho de um celular, simulando o app. O app de computador foi testado no Linux; vale abrir o instalador num Windows de verdade antes de vender.

---

## 15. Desfazer, editar consulta, pacientes e começar do zero

### Desfazer e Refazer

- No computador: os botões ↶ e ↷ na barra de comandos, ao lado de Dentistas, e os atalhos **Ctrl+Z** (desfazer) e **Ctrl+Y** ou **Ctrl+Shift+Z** (refazer). Passando o mouse, o botão diz o que vai desfazer.
- No celular, e também no computador: **Menu → Agenda → Desfazer / Refazer**.
- Guarda as **últimas 30 ações** de quem está usando o programa: criar, editar e excluir consulta, Veio / Não veio, importar agenda e importar pacientes. Fechar o programa ou trocar de usuário começa uma lista nova.
- Digitando num campo (anotações, busca), o Ctrl+Z continua sendo o do campo.
- **Sincronização:** o desfazer grava a mudança como qualquer outra, e ela vai para o servidor e os outros aparelhos na sincronização. Desfazer a criação de uma consulta tira a consulta de todos os aparelhos. Se a consulta mudou depois, aqui ou em outro aparelho, o desfazer não passa por cima e avisa.
- **Dia passado:** só o administrador desfaz mudanças em consultas de dias que já passaram (a mesma regra da agenda).
- O dentista não vê Desfazer e Refazer.

### Editar consulta

Botão direito na consulta (toque longo no celular) → **Editar…**. Muda paciente, data, hora, dentista, procedimento e tempo na mesma consulta, sem criar outra. Era a opção "Alterar…", que passou a se chamar "Editar…". Se a recepção tenta editar uma consulta de dia passado, aparece "Este dia já passou. Só o administrador pode alterar."

### Importar e exportar pacientes

Em **Menu → Configurações**, só para o administrador:
- **Importar pacientes…**: CSV ou Excel com Nome, Telefone, Nascimento, CPF e Endereço. Mostra o resumo antes e deixa escolher entre "Só criar novos" e "Criar e atualizar" (preenche só o que está em branco no cadastro). Nome e telefone são obrigatórios.
- **Exportar pacientes**: `dente-sempre-pacientes-AAAA-MM-DD.csv`, com `Nome;Telefone;Nascimento;CPF;Endereço`, todos os pacientes, abre direto no Excel.

### Começar do zero

**Menu → Configurações → Começar do zero**, ou o botão **Configurações** no alto. Só o administrador vê.
- Apaga consultas, pacientes e dentistas, e o que depende deles: bloqueios, almoços do dia, respostas dos pacientes e próteses.
- Continuam: usuários e senhas, nome e cores da clínica, tipos de consulta (com a duração padrão), anotações e protéticos.
- Pede confirmação forte: mostra "Isso apaga tudo. Tem certeza?" e só libera o botão depois de escrever **APAGAR**.
- Por padrão salva um backup antes de apagar. Esse backup pode ser restaurado depois em Restaurar backup.
- **Com servidor:** a limpeza vai para o servidor e para os outros aparelhos da clínica na sincronização, e o aviso diz isso antes. Sem servidor, vale só para este aparelho.
- Depois, o programa volta para a tela de começar (cadastrar o primeiro dentista).

---

## 16. Tipos de consulta, campo de tipo e assistente

### Tipos de consulta

**Menu → Configurações → Tipos de consulta**, logo abaixo de "Cores e ícones dos tipos". Também no botão **Configurações**, no alto → **Tipos de consulta…**. O administrador e a recepção usam; o dentista não vê.

- **Ver a lista**: nome, duração padrão e em quantas consultas cada tipo está. Com mais de 8 tipos aparece uma busca.
- **Adicionar**: nome e, se quiser, os minutos. Não deixa repetir um nome que já existe (maiúscula e acento não contam).
- **Mudar o nome**: escreva na linha e clique em **Salvar** (ou Enter). As consultas desse tipo, a cor e o ícone mudam junto.
- **Excluir**: só se o tipo não estiver em nenhuma consulta. Se estiver, o aviso diz em quantas e sugere mudar o nome.
- **Duração padrão** (1 a 720 minutos, ou em branco): no Novo horário, escolher o tipo já preenche o tempo. Se a pessoa já escreveu o tempo, ele não muda. Editar uma consulta antiga também não muda o tempo dela.
- Os tipos de antes continuam iguais. Um tipo novo escrito no Novo horário ou trazido pelo Importar agenda entra na lista, como antes.
- **Sincronização:** a duração vai para o servidor e os outros aparelhos junto com as Configurações da clínica (registro `typeDurations:config`). Um aparelho com versão antiga ignora esse registro e continua funcionando.

### Campo do tipo no Novo horário

Os botões com todos os tipos saíram. No lugar, o campo **Tipo de consulta** ocupa uma linha:
- Clicar (ou tocar, no celular) abre a lista com todos os tipos, a cor e a duração padrão.
- Digitar filtra a lista. Setas para cima e para baixo escolhem, Enter confirma, Esc fecha só a lista.
- Se o tipo não existe, aparece **Usar "…" (tipo novo)**. Ao salvar o horário, ele entra na lista de tipos.

### Assistente da agenda

A assistente agora sabe onde fica cada função do programa e entende os pedidos novos. Como antes, ela não salva nada sozinha: abre a tela já preenchida e a pessoa confere e clica.

- **Onde fica / como faço**: "onde fica importar pacientes?", "como mando o acesso da área do paciente?", "como desfaço?". Responde com o caminho do menu, o que a função faz, quem pode usar e um botão para abrir. Escrever só o nome da função ("sincronização") também responde.
- **Abrir**: "abra a sincronização", "abra os tipos de consulta".
- **Tipos de consulta**: "quais são os tipos de consulta?", "adicione o tipo Clareamento com 60 minutos", "mude o nome do tipo Limpeza para Profilaxia", "duração padrão do Canal 90 minutos", "quanto tempo dura a limpeza?", "exclua o tipo Retorno" (avisa se estiver em uso).
- **Agendar** usa a duração padrão do tipo quando o pedido não diz o tempo.
- **Próteses**: "próteses em atraso", "próteses em andamento" (avisa se o módulo estiver desligado).
- **Pendências do dia**, **buscar consultas de canal**, **desfazer** / **refazer** (mostra o que vai voltar e um botão).
- Os pedidos de antes continuam iguais, e ela continua recusando o que não é da agenda (valores, pagamento, CPF, endereço, prontuário…).

**Regra para as próximas versões:** toda função nova do programa também entra na assistente. No código, é a lista `ASSIST_TOPICOS` (nome, caminho no menu, o que faz, quem pode e como abrir) e os exemplos da `aiHelp`.

---

## 17. Tela do celular: área do sistema e barra de cima

O app de celular desenha a tela de ponta a ponta (Capacitor 8, `SystemBars` com `insetsHandling: "css"`). Por isso o programa precisa deixar livre a área da hora, da data e da câmera.

- **Em cima:** a página começa abaixo da hora do telefone, e uma faixa da cor da clínica fica atrás da hora. Rolando a agenda, nada passa por cima da hora. O Menu, o Novo horário, as janelas e as telas de entrada também começam abaixo dela.
- **Embaixo:** a barra de botões, o botão Novo horário, os rodapés das janelas e o menu Mais ficam acima da barra de gestos (ou dos botões) do telefone.
- **Deitado:** nada fica embaixo da câmera de lado.
- As medidas vêm do telefone (`env(safe-area-inset-*)` ou `--safe-area-inset-*`, que o Capacitor coloca). No computador e no navegador elas valem 0, e a tela do computador ficou igual.
- **Barra de cima no celular:** lupa, sincronização e usuário com a mesma altura (44 px, bom para o dedo), numa linha só. O nome "Dente Sempre" não quebra em duas linhas. Em telas de até 349 px, a sincronização mostra só a bolinha colorida (verde, amarela ou vermelha); tocando nela abre a Sincronização. O aviso "Modo recepção ocupada" corta com "…" se não couber.
- **Tamanho da fonte do Android:** o app não aumenta mais o texto quando a fonte do sistema está grande (`MainActivity.java`, `setTextZoom(100)`). Com a fonte grande, o "Sincronizado" ficava maior que o botão. O app já usa letras e botões grandes no celular.
- Testado em 320, 360, 412 (Realme 11) e 430 px de largura, com a área do sistema simulada.


## 18. WhatsApp no computador e versões no site

**WhatsApp no programa do computador (Windows, e também Mac e Linux).** Todos os botões de WhatsApp (Confirmar pacientes, Mensagem para grupo, Aniversariantes, WhatsApp… da consulta, link de pagamento e acesso à área do paciente) agora abrem assim no computador:

1. O programa pergunta ao sistema se tem um aplicativo que abre links `whatsapp://` (o WhatsApp baixado do site ou o da Microsoft Store).
2. Se tiver, a conversa abre nele, com o mesmo número e a mesma mensagem.
3. Se não tiver, ou se ele não abrir, abre o WhatsApp Web no navegador, como antes.

- No celular nada mudou: continua abrindo o app do WhatsApp.
- Usando a agenda direto num navegador (sem o programa instalado), continua abrindo o WhatsApp Web.
- O código fica em `app/desktop/main.js` (`linkDoWhatsApp`, `temWhatsAppInstalado`, `abrirNoWhatsAppInstalado`). A página não mudou nada nessa parte: ela continua mandando o mesmo link, e é o programa do computador que decide onde abrir.
- O teste `npm test` (pasta `app/desktop/`) confere o link `whatsapp://` com o número e o texto certos e a consulta ao sistema.
- Para valer no Windows, gere o instalador de novo (GitHub Actions ou `npm run desktop:windows`).

**Versões no site.** O site ganhou a seção **Atualizações** (veja o `LEIA-ME.md` do site). A lista de versões fica no `index.html` do site, na lista `VERSOES`, e os downloads apontam para https://github.com/dentesempreias-creator/Dente-Sempre-Agenda/releases.

**Assistente.** Ela responde "o WhatsApp abre no aplicativo do computador?" (explica o caminho acima) e "qual a versão nova do aplicativo?" (aponta a seção Atualizações do site, mostra a versão instalada no computador e tem o botão **Ver as versões no GitHub**).


## 19. Pedidos da recepção: trancar o dia, indicação, duplicatas, "Termina às" e tela que se ajusta

Tudo funciona sem internet, como o resto. O código novo fica num bloco só no `app/fonte/dente-sempre.html`, com o comentário `Feedbacks da recepção (11/11)`, logo antes de `function baseMenuGroups()`. As funções antigas continuam iguais; o bloco só acrescenta conferências antes ou depois delas. Fora do bloco, só entrou uma linha na importação de agenda (consultas de dia trancado ficam de fora, menos para o administrador). O servidor não mudou.

**1. Trancar agenda do dia**
- Onde: Menu → Recepção do dia → **Trancar agenda do dia**, ou botão direito num horário livre → **Trancar agenda deste dia…**. Também pela assistente: "tranque a agenda de hoje".
- Quem tranca: o administrador e a recepção. Quem destranca: só o administrador (botão **Destrancar** no aviso amarelo, botão direito, ou Menu).
- Com o dia trancado, só o administrador cria, altera, exclui ou remarca consultas naquele dia, em todos os dentistas. Também ficam travados o encaixe, o bloqueio de horário, o almoço do dia, o Desfazer de consulta desse dia e a importação para esse dia.
- Continuam liberados: **Veio**, **Não veio**, WhatsApp e as anotações.
- Aviso: faixa amarela em cima da agenda ("Agenda do dia trancada", com quem trancou e quando). No detalhe da consulta aparece o mesmo aviso.
- Dados: `db.dayLocks = { "AAAA-MM-DD": { em, por, porId } }`. Vai na sincronização como `dayLocks:AAAA-MM-DD`, na área Agenda.

**2. Indicado por e desconto por indicação**
- Campo **Indicado por** (opcional) no cadastro do paciente novo (Novo horário → Cadastrar novo paciente) e em Pacientes → ficha → **Editar dados**. Busca outro paciente pelo nome ou telefone. Se a pessoa não estiver no cadastro, o texto fica anotado, mas sem desconto.
- Ficha do paciente, seção **Indicações**: quem indicou, quantas indicações ele fez (com os nomes), o desconto a usar e a próxima consulta.
- Regra: quem indicou ganha o desconto na próxima consulta, um desconto por indicação. Padrão: 10%. O administrador muda em Menu → Configurações → **Desconto por indicação** (porcentagem ou valor fixo em R$, ou desligado). Essa regra vai na sincronização como `referral:config` (área Configurações).
- O desconto aparece na ficha, no detalhe da próxima consulta marcada (etiqueta verde) e na mensagem de confirmação do WhatsApp ("Por ter indicado um paciente, você tem 10% de desconto nesta consulta").
- Conta como usado quando o paciente que indicou vem a uma consulta (Veio) depois da indicação, ou no botão **Marcar desconto como usado** da ficha. Não é sistema financeiro: só controle e aviso.
- Dados no paciente: `referredBy` (id de quem indicou), `referredByText` (texto livre), `referredAt`, `referralUsed`.

**3. Juntar duplicatas**
- Pacientes: botão **Juntar duplicatas** na janela Pacientes (e Menu → Pacientes → Juntar pacientes duplicados). Acha pacientes com o mesmo CPF, ou com o mesmo telefone e nome igual ou muito parecido ("Maria Souza" e "maria souza", "Carla Dias" e "Carla Dias Santos"). Mesmo telefone com outro nome (mãe e filha) não entra.
- Você marca qual cadastro fica. Antes de juntar, a confirmação mostra quantas consultas passam. As consultas, as próteses e as indicações dos outros passam para o que fica; dados vazios dele (nascimento, CPF, RG, endereço) são completados com os dos outros.
- Procedimentos: Menu → Configurações → Tipos de consulta → **Juntar duplicatas**. Junta tipos com o mesmo nome escrito diferente (maiúsculas, acentos, espaços). As consultas antigas passam a usar o nome que ficou.
- Dá para desfazer com Ctrl+Z (Menu → Desfazer).

**4. Termina às**
- No Novo horário e no Alterar, ao lado de **Tempo (min)**, o campo **Termina às** (HH:MM). Um atualiza o outro: Hora 14:00 + 30 min mostra 14:30; escrever 15:15 muda o tempo para 75 min. Sem a hora de início, o "Termina às" com o tempo calcula a hora de início.

**5 e 6. Interface e tela que se ajusta ao monitor (só CSS)**
- O que é clicável parece botão (Almoço · Alterar com borda); o que é só informação fica liso (Expediente, quando o usuário não pode mudar). Contorno de foco no teclado e barras de rolagem finas.
- Computador: as colunas acompanham a largura (dentistas 14% da tela, de 220 a 320 px; lado direito 19%, de 300 a 400 px). A coluna da direita cabe sem barra de rolagem: o calendário diminui em telas baixas e as anotações usam o espaço que sobra. A legenda fica em 3 colunas.
- Barra de comandos sem rolagem para o lado: em telas de 601 a 1180 px de largura, os botões secundários ficam só com o ícone (o nome aparece ao parar o mouse).
- Medido: sem barras de rolagem além da própria agenda em 1366x768, 1366x705, 1280x650, 1536x780, 1920x1080, 2560x1440 e 1024x700. Só em janelas com menos de 620 px de altura a coluna da direita ainda rola. No celular a tela continua como estava (o celular já tinha passado pelo ajuste de toque).

**Assistente.** Responde "tranque a agenda de hoje" (abre a confirmação), "a agenda de amanhã está trancada?", "destranque a agenda" (só administrador, com botão), "quem a Maria indicou?", "quem tem desconto por indicação?", "qual o desconto por indicação?", "juntar pacientes duplicados", "juntar procedimentos repetidos" e "onde coloco a hora que termina?". Pedindo para agendar num dia trancado, ela explica que o dia está trancado.
