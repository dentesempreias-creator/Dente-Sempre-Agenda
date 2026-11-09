# Site da Agenda Odontológica Dente Sempre

Site de apresentação, planos e downloads da agenda da Clínica Odontológica Dente Sempre. É uma página só. O pagamento acontece no servidor (`https://api.agendadentesempre.com.br/assinar`); o site só leva até lá.

O que tem na página: nome e frase ("A agenda da Clínica Odontológica Dente Sempre."), destaques (computador e celular, sincroniza, funciona sem internet), funções, como começar, downloads, planos com preços e desconto do primeiro mês, botão **Assinar**, botão **Falar com o suporte para pagar via Pix**, dúvidas (inclusive sobre assinatura, cancelamento, Pix e suporte), **a clínica** (endereço com mapa, Instagram, Facebook e site) e contato.

```
site/
├── index.html                 ← a página inteira (texto, estilo e o pequeno script)
├── termos.html                ← Termos de Uso (link no rodapé)
├── privacidade.html           ← Política de Privacidade (link no rodapé)
├── img/logo.svg               ← logo (também é o ícone da aba)
├── img/agenda-computador.jpg  ← tela do programa no computador
└── img/agenda-celular.jpg     ← tela do app no celular
```

As telas são do próprio Dente Sempre, com pacientes de exemplo.

## 1. Antes de publicar: troque o que falta

Abra `index.html` num editor de texto (Bloco de Notas, VS Code). Perto do fim tem este bloco, e só ele precisa ser trocado:

```js
var CONFIG = {
  whatsapp: '5500000000000',      // ← WhatsApp da clínica: 55 + DDD + número. Ex.: '5511987654321'
  mensagem: 'Olá! Quero conhecer a Agenda Dente Sempre.',
  instagram: 'https://www.instagram.com/dentesempre/',
  suporte: '',                    // ← WhatsApp do suporte (Pix e rodapé). Vazio = usa o de cima
  assinar: 'https://api.agendadentesempre.com.br/assinar',   // ← página de assinatura do servidor
  downloads: {
    windows: 'https://SEU-LINK/Dente-Sempre-Instalador-1.0.0.exe',   // ← link do instalador
    android: 'https://SEU-LINK/Dente-Sempre.apk',                    // ← link do APK
    mac: '',     // vazio = "Em breve"
    linux: ''    // vazio = "Em breve"
  }
};
```

- **Contato:** enquanto o número do WhatsApp não for colocado, todos os botões de contato (topo, planos, fim da página e o botão redondo) abrem o **Instagram @dentesempre** e dizem "Instagram". Colocando o número, eles viram WhatsApp sozinhos, com a mensagem pronta.
- Enquanto os links de download não forem trocados, os botões de download mostram um aviso ("ainda vai ser colocado") em vez de levar a um lugar errado.
- Com o WhatsApp, os botões dos planos abrem a conversa já com a mensagem "Tenho interesse no plano Básico" (ou o plano escolhido).
- Quando tiver o link do Mac ou do Linux, é só colocar: o "Em breve" vira botão de download sozinho.
- **Suporte e Pix:** o botão **Falar com o suporte para pagar via Pix** (embaixo dos planos) e o **Suporte** do rodapé usam o número de `suporte`. Pode escrever com ou sem o 55, com espaços ou traço: `'(11) 91234-5678'`. Vazio, eles usam o `whatsapp` da clínica. Sem nenhum dos dois, abrem o Instagram. O botão do Pix abre o WhatsApp com a mensagem *"Olá! Quero assinar um plano da Agenda Dente Sempre e pagar via Pix."*
- **Assinar:** já vem com `https://api.agendadentesempre.com.br/assinar`. Com esse endereço, os planos Básico e Profissional ganham o botão **Assinar**, que leva ao pagamento pelo Mercado Pago já com o plano escolhido. O botão de contato desses planos vira **Tirar dúvidas**. Vazio, o site fica como antes. Antes, configure o Mercado Pago no servidor (README do produto, seção 12).
- **Preços:** Básico R$ 99,90 por mês (primeiro mês R$ 49,90) e Profissional R$ 199,90 por mês (primeiro mês R$ 99,90). Eles estão escritos nos cartões dos planos e na dúvida "Quanto custa?". Para mudar, procure `99,90` ou `199,90` no `index.html` e troque em todos os lugares.
- **Os preços do site precisam ser os mesmos do servidor.** No `/etc/dente-sempre.env` do servidor: `PRECO_BASICO=99,90`, `PRECO_PROFISSIONAL=199,90`, `PRECO_BASICO_PROMO=49,90` e `PRECO_PROFISSIONAL_PROMO=99,90`. Quem cobra é o servidor: se os números forem diferentes, o cliente vê um preço no site e outro na página de assinatura.
- Os limites dos planos são os mesmos de `servidor/planos.js`. Se mudar lá, mude também aqui, na seção "Planos".

### Dados da clínica

Endereço, Instagram, Facebook e site estão escritos direto no `index.html`, na seção "A clínica" e no rodapé. Para mudar, procure o texto antigo (por exemplo `Emílio Ribas`) e troque em todos os lugares onde aparece. O mapa vem do Google Maps pelo endereço e aparece quando o site está na internet.

### Onde deixar os instaladores (links de download)

O mais simples é usar as **Releases do GitHub**, no mesmo repositório que já gera os apps:

1. No GitHub: **Releases → Draft a new release**. Crie uma versão, por exemplo `v1.0.0`.
2. Arraste o `Dente-Sempre-Instalador-1.0.0.exe` e o `.apk` (os dois saem do GitHub Actions) e clique em **Publish release**.
3. Copie o link de cada arquivo (botão direito → copiar link) e cole no `CONFIG`.

Os links ficam assim: `https://github.com/USUARIO/REPOSITORIO/releases/download/v1.0.0/Dente-Sempre-Instalador-1.0.0.exe`. Se o repositório for privado, os arquivos não abrem para os clientes. Nesse caso, use um repositório público só para as versões, ou outro lugar (Google Drive com "qualquer pessoa com o link", Dropbox, o próprio VPS).

### Termos de Uso e Política de Privacidade

Os dois textos ficam em páginas próprias, `termos.html` e `privacidade.html`, com o mesmo visual do site. O rodapé da página principal tem os links **Termos de Uso** e **Política de Privacidade**, e cada página tem **Voltar ao site** e um link para a outra.

Para mudar um texto depois, abra `termos.html` ou `privacidade.html` num editor de texto e troque as frases entre `<article class="texto">` e `</article>`. Cada parágrafo fica entre `<p>` e `</p>`, e cada título entre `<h2>` e `</h2>`. Lembre de mudar a data da **Última atualização**. Se preferir, mande o `.md` novo para o Claude gerar as páginas de novo.

### Atualizações: versões dos aplicativos

A seção **Atualizações** (no menu do alto e logo abaixo dos downloads) mostra a versão mais nova de cada aplicativo, com a data, o botão de download e a lista **O que mudou em cada versão**. Os dados ficam no `index.html`, logo depois do `CONFIG`, nesta lista:

```js
var VERSOES = [
  {
    versao: '1.0.0',                 // a tag da release no GitHub, sem o "v" (tag v1.0.0 → '1.0.0')
    data: '2026-11-09',              // ou '09/11/2026'
    resumo: 'Primeira versão da Agenda Dente Sempre: ...',   // ou uma lista: ['Coisa nova', 'Correção']
    arquivos: {
      windows: 'Dente-Sempre-Instalador-1.0.0.exe',          // nome do arquivo anexado na release
      android: 'Dente-Sempre.apk'
    }
  }
];
```

**Quando sair uma versão nova:**

1. No GitHub (https://github.com/dentesempreias-creator/Dente-Sempre-Agenda/releases), crie a release com a tag, por exemplo `v1.0.1`, e anexe os arquivos.
2. No `index.html`, copie um bloco `{ ... }` inteiro da lista `VERSOES` e cole **no começo** da lista, com uma vírgula depois do `}`.
3. Troque `versao`, `data`, `resumo` e os nomes em `arquivos`. Coloque só os aplicativos que saíram nessa versão: o site mostra, para cada aplicativo, a versão mais nova que tem arquivo dele.
4. Publique o site de novo (seção 2).

- O link de download é montado sozinho: `.../releases/download/v1.0.1/NOME-DO-ARQUIVO`. O nome precisa ser igual ao que aparece na release do GitHub. O GitHub troca espaço por ponto, então `Dente Sempre.apk` vira `Dente.Sempre.apk`. Também dá para colar o link completo no lugar do nome.
- Mac e Linux aparecem sozinhos quando uma versão tiver `mac:` ou `linux:` em `arquivos`.
- A ordem é pela data: a mais nova fica em cima com a etiqueta **Mais recente**. Aparecem as 6 últimas; o link **Ver todas as versões no GitHub** leva ao resto.
- Se a tag não for `v` + número, coloque `tag: 'nome-da-tag'` no bloco.
- A versão `1.0.0` que vem na lista é um exemplo: confira se a release `v1.0.0` existe no GitHub com esses nomes de arquivo antes de publicar.
- Os botões da seção **Baixar** continuam vindo do `CONFIG.downloads`. Quando trocar de versão, atualize os dois.

## 2. Publicar

### Opção A: Netlify (mais fácil, sem instalar nada)

1. Antes, confira o `CONFIG` (o número do WhatsApp e do suporte) e abra o `index.html` no computador para ver se está tudo certo.
2. Entre em **https://app.netlify.com/drop** e crie uma conta grátis (pode entrar com o Google).
3. Arraste a **pasta `site` inteira** (com o `index.html`, o `termos.html`, o `privacidade.html` e a pasta `img`) para a página. Não arraste só o `index.html`, senão o logo, as telas e os termos somem.
4. Pronto: sai um endereço como `https://dente-sempre-123.netlify.app`. Abra no celular e no computador e teste os botões **Assinar** e **Falar com o suporte para pagar via Pix** e os links **Termos de Uso** e **Política de Privacidade** do rodapé.
5. Para trocar o nome do endereço: **Site configuration → Change site name** (ex.: `agendadentesempre.netlify.app`).
6. Para usar o seu domínio (ex.: `agendadentesempre.com.br`): **Domain management → Add a domain**, digite o domínio e siga as instruções. No Registro.br, crie os registros que o Netlify mostrar. O HTTPS é automático e fica pronto depois que o domínio aponta para o Netlify.
   - **Atenção:** o `api.agendadentesempre.com.br` é o **servidor**, não o site. Não aponte o `api` para o Netlify: ele precisa apontar para o IP do VPS (registro `A`), como no manual do servidor.

**Para atualizar o site depois** (por exemplo, depois de trocar um preço): entre no site no Netlify → **Deploys** → arraste a pasta `site` de novo na área "Need to update your site? Drag and drop your site output folder here". O endereço continua o mesmo.

### Opção B: GitHub Pages (grátis)

1. No GitHub, crie um repositório **público**, por exemplo `dente-sempre-site`.
2. **Add file → Upload files:** arraste o **conteúdo** da pasta `site` (o `index.html`, o `termos.html`, o `privacidade.html` e a pasta `img`, não a pasta `site` em si). Depois clique em **Commit changes**.
3. Vá em **Settings → Pages**. Em "Build and deployment", escolha **Deploy from a branch**, a branch **main** e a pasta **/ (root)**, e clique em **Save**.
4. Em um ou dois minutos o site fica em `https://USUARIO.github.io/dente-sempre-site/`.
5. Domínio próprio: na mesma tela, preencha **Custom domain** e marque **Enforce HTTPS**.

Para atualizar, envie o `index.html` novo pelo mesmo **Upload files**.

### Domínio próprio (nas duas opções)

No lugar onde o domínio foi registrado (Registro.br, por exemplo), crie o registro que o Netlify ou o GitHub pedir: `CNAME` para o `www` e `A` / `ALIAS` para o domínio sem www. As duas telas mostram os valores exatos.

## 3. Ver antes de publicar

Dê dois cliques no `index.html`: ele abre no navegador como vai ficar no ar. A fonte (Inter) vem do Google Fonts; sem internet, o navegador usa a fonte do sistema e o site continua certo.

## O que não foi mexido

O programa, o servidor e os apps não mudaram por causa do site (nem nesta atualização de planos, Pix e dúvidas). O programa continua se chamando "Dente Sempre" por dentro; o nome "Agenda Odontológica Dente Sempre" é só do site. O site é uma pasta separada e não depende deles.
