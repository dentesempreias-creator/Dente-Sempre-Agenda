// =====================================================================
//  Dente Sempre — aplicativo para computador (Electron)
//  Abre a agenda (www/index.html) numa janela própria, com endereço fixo
//  app://dente-sempre/ (assim os dados guardados no computador não se perdem)
//  e várias travas de segurança:
//    - a página não tem acesso ao Node.js nem ao computador (sandbox);
//    - só conversa com o servidor configurado (proteção CSP + filtro de rede);
//    - links externos (WhatsApp etc.) abrem no navegador normal;
//    - não navega para outros sites, não abre janelas extras, não pede permissões.
// =====================================================================
'use strict';

const { app, BrowserWindow, Menu, protocol, session, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ESQUEMA = 'app';
const HOST = 'dente-sempre';
const ORIGEM_APP = `${ESQUEMA}://${HOST}`;            // origem fixa da página
const PASTA_WWW = path.join(__dirname, 'www');
const MODO_TESTE = !app.isPackaged && process.env.DS_TESTE === '1';  // nunca liga no aplicativo instalado
// No teste, usa uma pasta de dados temporária (não mexe nos dados de verdade).
if (MODO_TESTE) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dente-sempre-teste-')));

// No aplicativo instalado, ninguém pode abrir a "porta de depuração" (daria acesso aos dados).
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'js-flags']
  .some((s) => app.commandLine.hasSwitch(s))) {
  app.exit(1);
}

// ---------- endereço do servidor (gerado pelo preparar.js) ----------
let configApp = {};
try {
  configApp = JSON.parse(fs.readFileSync(path.join(__dirname, 'app-config.json'), 'utf8'));
} catch (e) {
  console.error('app-config.json não encontrado. Rode "npm run preparar" na pasta app/.');
}
const ORIGEM_SERVIDOR = typeof configApp.origem === 'string' ? configApp.origem : '';
const ORIGEM_SERVIDOR_WS = typeof configApp.origemWs === 'string' ? configApp.origemWs : '';

const CSP = [
  `default-src 'self' ${ESQUEMA}:`,
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${ORIGEM_SERVIDOR} ${ORIGEM_SERVIDOR_WS}`.trim(),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Tem que ser chamado antes do app ficar pronto.
protocol.registerSchemesAsPrivileged([{
  scheme: ESQUEMA,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);
app.enableSandbox();

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Entrega os arquivos de www/ pelo endereço app://dente-sempre/...
async function servirArquivo(requisicao) {
  const naoAchou = () => new Response('Não encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  let url;
  try { url = new URL(requisicao.url); } catch (e) { return naoAchou(); }
  if (url.host !== HOST) return naoAchou();
  let caminho;
  try { caminho = decodeURIComponent(url.pathname); } catch (e) { return naoAchou(); }
  if (caminho.includes('\0')) return naoAchou();
  if (caminho === '/' || caminho === '') caminho = '/index.html';
  const arquivo = path.resolve(PASTA_WWW, '.' + path.posix.normalize(caminho));
  // Trava contra "../": o arquivo tem que estar DENTRO de www/.
  if (arquivo !== PASTA_WWW && !arquivo.startsWith(PASTA_WWW + path.sep)) return naoAchou();
  let conteudo;
  try { conteudo = await fs.promises.readFile(arquivo); } catch (e) { return naoAchou(); }
  const tipo = TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
  const cabecalhos = {
    'Content-Type': tipo,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  };
  if (tipo.startsWith('text/html')) {
    cabecalhos['Content-Security-Policy'] = CSP;
    cabecalhos['Referrer-Policy'] = 'no-referrer';
  }
  return new Response(conteudo, { status: 200, headers: cabecalhos });
}

// ---------- identificação do aparelho ----------
// Um número fixo deste computador (32 letras/números), usado pela licença.
// Não é o número original da máquina: é um resumo (sha256) dele.
function idDaMaquina() {
  try {
    if (process.platform === 'win32') {
      const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
      const saida = execFileSync(reg, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(saida);
      if (m) return m[1].toLowerCase();
    } else if (process.platform === 'darwin') {
      const saida = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(saida);
      if (m) return m[1].toLowerCase();
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try {
          const v = fs.readFileSync(f, 'utf8').trim();
          if (/^[0-9a-fA-F]{16,}$/.test(v)) return v.toLowerCase();
        } catch (e) { /* tenta o próximo */ }
      }
    }
  } catch (e) { /* usa o número guardado abaixo */ }
  return '';
}

function idGuardado() {
  const arquivo = path.join(app.getPath('userData'), 'aparelho.txt');
  try {
    const v = fs.readFileSync(arquivo, 'utf8').trim();
    if (/^[0-9a-f]{32,}$/.test(v)) return v;
  } catch (e) { /* ainda não existe */ }
  const novo = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, novo + '\n', { mode: 0o600 });
  } catch (e) { /* sem permissão: vale só nesta sessão */ }
  return novo;
}

let infoAparelho = null;
function informacoes() {
  if (!infoAparelho) {
    const base = idDaMaquina() || ('arquivo:' + idGuardado());
    infoAparelho = {
      plataforma: 'desktop',
      sistema: process.platform,
      versao: app.getVersion(),
      aparelho: crypto.createHash('sha256').update('dente-sempre|' + base).digest('hex').slice(0, 32),
    };
  }
  return infoAparelho;
}

// ---------- links e navegação ----------
function ehDoApp(endereco) {
  // (new URL(...).origin dá "null" para esquemas próprios no Node, por isso compara as partes)
  try { const u = new URL(endereco); return u.protocol === ESQUEMA + ':' && u.host === HOST; } catch (e) { return false; }
}
function abrirFora(endereco) {
  let url;
  try { url = new URL(endereco); } catch (e) { return; }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    if (abrirNoWhatsAppInstalado(url)) return;   // WhatsApp: primeiro o aplicativo instalado
    if (MODO_TESTE) { abertosFora.push(url.href); return; }
    shell.openExternal(url.href).catch(() => {});
  }
  // qualquer outro tipo de link (file:, javascript:, etc.) é ignorado
}
const abertosFora = [];

// ---------- WhatsApp no computador: primeiro o aplicativo instalado ----------
// Os botões de WhatsApp (confirmação, mensagem para grupo, aniversário etc.) mandam um link do
// WhatsApp Web (ou wa.me). Aqui o programa pergunta ao sistema se tem um aplicativo que abre
// links "whatsapp://" (o WhatsApp do site ou da Microsoft Store). Se tiver, a conversa abre nele,
// com o mesmo número e o mesmo texto. Se não tiver (ou ele não abrir), vai pelo navegador, como antes.
function linkDoWhatsApp(url) {
  const host = url.hostname.toLowerCase();
  let fone = '', texto = '';
  if ((host === 'web.whatsapp.com' || host === 'api.whatsapp.com') && url.pathname.replace(/\/+$/, '') === '/send') {
    fone = url.searchParams.get('phone') || '';
    texto = url.searchParams.get('text') || '';
  } else if (host === 'wa.me' || host === 'www.wa.me') {
    fone = url.pathname.replace(/^\/+|\/+$/g, '');
    texto = url.searchParams.get('text') || '';
  } else {
    return '';
  }
  fone = fone.replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(fone)) return '';
  return 'whatsapp://send?phone=' + fone + (texto ? '&text=' + encodeURIComponent(texto) : '');
}
function temWhatsAppInstalado() {
  try {
    return String(app.getApplicationNameForProtocol('whatsapp://') || '').trim() !== '';
  } catch (e) {
    return false;
  }
}
const abertosNoWhatsApp = [];   // só para o teste automático
function abrirNoWhatsAppInstalado(url) {   // true = já abriu no aplicativo
  const noApp = linkDoWhatsApp(url);
  if (!noApp) return false;
  const instalado = temWhatsAppInstalado();
  if (MODO_TESTE) { abertosNoWhatsApp.push({ de: url.href, app: noApp, instalado }); return false; }
  if (!instalado) return false;
  shell.openExternal(noApp).catch(() => { shell.openExternal(url.href).catch(() => {}); });
  return true;
}

function protegerConteudo(contents) {
  contents.on('will-navigate', (e, endereco) => {
    const destino = e.url || endereco;
    if (!ehDoApp(destino)) { e.preventDefault(); abrirFora(destino); }
  });
  // (o Electron avisa primeiro will-frame-navigate; se ela barrar, will-navigate nem é chamada)
  contents.on('will-frame-navigate', (e) => {
    if (ehDoApp(e.url)) return;
    e.preventDefault();
    if (e.isMainFrame) abrirFora(e.url);   // link para site: abre no navegador normal
  });
  contents.on('will-redirect', (e, endereco) => {
    if (!ehDoApp(e.url || endereco) && e.isMainFrame) e.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    abrirFora(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
}

// Menu do botão direito em campos de texto: Recortar / Copiar / Colar.
function menuDeContexto(contents) {
  contents.on('context-menu', (_e, p) => {
    const itens = [];
    if (p.isEditable) {
      itens.push({ role: 'cut', label: 'Recortar', enabled: p.editFlags.canCut });
      itens.push({ role: 'copy', label: 'Copiar', enabled: p.editFlags.canCopy });
      itens.push({ role: 'paste', label: 'Colar', enabled: p.editFlags.canPaste });
      itens.push({ type: 'separator' });
      itens.push({ role: 'selectAll', label: 'Selecionar tudo' });
    } else if (p.selectionText && p.selectionText.trim()) {
      itens.push({ role: 'copy', label: 'Copiar' });
    }
    if (itens.length) Menu.buildFromTemplate(itens).popup();
  });
}

function montarMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  // No Mac o menu de cima é obrigatório para Copiar/Colar funcionarem pelo teclado.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about', label: 'Sobre o Dente Sempre' },
      { type: 'separator' },
      { role: 'hide', label: 'Ocultar Dente Sempre' },
      { role: 'hideOthers', label: 'Ocultar outros' },
      { role: 'unhide', label: 'Mostrar tudo' },
      { type: 'separator' },
      { role: 'quit', label: 'Sair do Dente Sempre' },
    ] },
    { label: 'Editar', submenu: [
      { role: 'undo', label: 'Desfazer' },
      { role: 'redo', label: 'Refazer' },
      { type: 'separator' },
      { role: 'cut', label: 'Recortar' },
      { role: 'copy', label: 'Copiar' },
      { role: 'paste', label: 'Colar' },
      { role: 'selectAll', label: 'Selecionar tudo' },
    ] },
    { label: 'Janela', submenu: [
      { role: 'minimize', label: 'Minimizar' },
      { role: 'zoom', label: 'Zoom' },
      { role: 'close', label: 'Fechar janela' },
    ] },
  ]));
}

function prepararSessao(ses) {
  // Nenhuma permissão especial (câmera, microfone, localização, notificações...).
  ses.setPermissionRequestHandler((_wc, _permissao, responder) => responder(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);

  // Filtro de rede: só a própria página e o servidor configurado.
  ses.webRequest.onBeforeRequest((det, responder) => {
    const u = det.url;
    const permitido = u.startsWith(ORIGEM_APP + '/') || u.startsWith('blob:') || u.startsWith('data:') ||
      u.startsWith('devtools:') || u.startsWith('chrome-extension:') ||
      (ORIGEM_SERVIDOR && (u === ORIGEM_SERVIDOR || u.startsWith(ORIGEM_SERVIDOR + '/'))) ||
      (ORIGEM_SERVIDOR_WS && (u === ORIGEM_SERVIDOR_WS || u.startsWith(ORIGEM_SERVIDOR_WS + '/')));
    responder({ cancel: !permitido });
  });

  // Salvar o backup: pergunta onde gravar (começa na pasta Downloads).
  ses.on('will-download', (_e, item) => {
    const nome = item.getFilename() || 'dente-sempre-backup.json';
    if (MODO_TESTE) {
      const destino = path.join(os.tmpdir(), 'dente-sempre-teste-' + nome);
      item.setSavePath(destino);
      item.once('done', (_ev, estado) => { downloadsTeste.push({ nome, destino, estado }); });
      return;
    }
    item.setSaveDialogOptions({
      title: 'Salvar cópia de segurança',
      buttonLabel: 'Salvar',
      defaultPath: path.join(app.getPath('downloads'), nome),
    });
  });
}
const downloadsTeste = [];
const mensagensTeste = [];

let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    title: 'Dente Sempre',
    width: 1366,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#e4e9ef',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  janela.on('page-title-updated', (e) => e.preventDefault());   // título fixo "Dente Sempre"
  janela.once('ready-to-show', () => janela.show());
  janela.on('closed', () => { janela = null; });
  menuDeContexto(janela.webContents);
  if (MODO_TESTE) {
    janela.webContents.on('console-message', (e) => { mensagensTeste.push(e.level + ': ' + e.message); });
    janela.webContents.on('preload-error', (_e, p, erro) => { mensagensTeste.push('preload-error: ' + p + ' ' + erro); });
    janela.webContents.once('did-finish-load', () => setTimeout(rodarTeste, 1500));
  }
  janela.loadURL(ORIGEM_APP + '/index.html');
}

// ---------- teste automático (só com DS_TESTE=1 e fora do aplicativo instalado) ----------
async function rodarTeste() {
  const wc = janela.webContents;
  // Mensagens até aqui = abertura da página (não pode ter erro). Depois vêm as provas de bloqueio.
  const mensagensAbertura = mensagensTeste.splice(0);
  const js = (codigo) => wc.executeJavaScript(codigo, true);
  const r = {};
  try {
    r.endereco = wc.getURL();
    r.titulo = await js('document.title');
    r.tituloJanela = janela.getTitle();
    r.loginVisivel = await js("!!document.querySelector('#loginScreen') && !document.querySelector('#loginScreen').hidden && !!document.querySelector('#lgUser') && document.querySelector('#lgUser').offsetParent !== null");
    r.denteSempreApp = await js('JSON.stringify(window.denteSempreApp)');
    r.aparelhoOk = await js("typeof window.denteSempreApp === 'object' && /^[0-9a-f]{32}$/.test(window.denteSempreApp.aparelho)");
    r.congelado = await js("Object.isFrozen(window.denteSempreApp) || (() => { try { window.denteSempreApp.aparelho = 'x'; } catch (e) {} return window.denteSempreApp.aparelho !== 'x'; })()");
    r.semNode = await js("typeof require === 'undefined' && typeof process === 'undefined' && typeof window.ipcRenderer === 'undefined'");
    r.cryptoSubtle = await js("!!(window.crypto && crypto.subtle && typeof crypto.subtle.verify === 'function')");
    r.localStorage = await js("(() => { localStorage.setItem('ds-teste', '1'); return localStorage.getItem('ds-teste') === '1' && location.origin; })()");
    r.indexedDB = await js("new Promise(ok => { const q = indexedDB.open('ds-teste', 1); q.onsuccess = () => ok(true); q.onerror = () => ok(false); })");
    r.cspCabecalho = await js("fetch('/index.html').then(x => x.headers.get('content-security-policy'))");
    r.travaPasta = await js("fetch('/../main.js').then(x => x.status).catch(e => 'erro: ' + e.message)");
    r.travaPasta2 = await js("fetch('/%2e%2e/main.js').then(x => x.status).catch(e => 'erro: ' + e.message)");
    r.bloqueiaOutroSite = await js("fetch('https://example.com/').then(() => 'NAO BLOQUEOU').catch(() => 'bloqueado')");
    r.janelaExtra = await js("String(window.open('https://wa.me/5511999999999?text=oi', '_blank', 'noopener'))");
    r.janelaArquivo = await js("String(window.open('file:///etc/passwd'))");
    await js("location.href = 'https://example.com/pagina'; 1");
    await new Promise(ok => setTimeout(ok, 1000));
    r.continuaNoApp = wc.getURL();
    // Download do backup (Blob + <a download>), como faz o botão "Exportar backup".
    await js("(() => { const b = new Blob([JSON.stringify({teste: true})], {type: 'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'backup-teste.json'; document.body.appendChild(a); a.click(); a.remove(); return 1; })()");
    await new Promise(ok => setTimeout(ok, 1500));
    r.downloads = downloadsTeste.map(d => ({ nome: d.nome, estado: d.estado, conteudo: fs.existsSync(d.destino) ? fs.readFileSync(d.destino, 'utf8') : null }));
    r.abertosNoNavegador = abertosFora.slice();
    r.whatsAppNoApp = abertosNoWhatsApp.slice();
    r.whatsAppLinks = [
      'https://web.whatsapp.com/send?phone=5511999999999&text=Ol%C3%A1%2C%20Maria!%0AConsulta%20%26%20retorno',
      'https://wa.me/5511999999999?text=oi',
      'https://web.whatsapp.com/',
      'https://wa.me/abc?text=oi',
      'https://example.com/send?phone=5511999999999',
    ].map((u) => linkDoWhatsApp(new URL(u)));
    const foto = path.join(os.tmpdir(), 'dente-sempre-teste.png');
    fs.writeFileSync(foto, (await wc.capturePage()).toPNG());
    r.fotoDaTela = foto;
  } catch (e) {
    r.falhaNoTeste = String(e && e.stack || e);
  }
  r.mensagensNaAbertura = mensagensAbertura;
  r.mensagensDosBloqueios = mensagensTeste.slice();
  console.log('DS_TESTE_RESULTADO ' + JSON.stringify(r, null, 2));
  app.quit();
}

// ---------- início ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();   // já tem um Dente Sempre aberto: só traz ele para frente
} else {
  app.on('second-instance', () => {
    if (janela) { if (janela.isMinimized()) janela.restore(); janela.show(); janela.focus(); }
  });

  // Dados que a página pede ao abrir (pelo preload.js). Só responde à própria página.
  ipcMain.on('dente-sempre:informacoes', (e) => {
    const origem = e.senderFrame && e.senderFrame.url;
    e.returnValue = ehDoApp(origem || '') ? informacoes() : null;
  });

  app.on('web-contents-created', (_e, contents) => protegerConteudo(contents));

  app.whenReady().then(() => {
    if (!ORIGEM_SERVIDOR) {
      dialog.showErrorBox('Dente Sempre', 'Este aplicativo foi gerado sem o endereço do servidor. Gere de novo com "npm run preparar".');
    }
    protocol.handle(ESQUEMA, servirArquivo);
    prepararSessao(session.defaultSession);
    montarMenu();
    criarJanela();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) criarJanela(); });
  });

  app.on('window-all-closed', () => app.quit());
}
