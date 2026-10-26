#!/usr/bin/env node
// =====================================================================
//  Dente Sempre — preparar.js
//  Pega o programa original (fonte/dente-sempre.html), coloca o endereço do
//  servidor e a chave pública da licença, embaralha o código (opcional) e
//  grava a página pronta para os aplicativos:
//    desktop/www/index.html   (Windows, Mac, Linux)
//    celular/www/index.html   (Android, iPhone)
//    desktop/app-config.json  (endereço do servidor, usado pela proteção CSP)
//
//  Uso:
//    node preparar.js                       usa o que está em config.json
//    node preparar.js --servidor=https://agenda.minhaclinica.com.br --chave=MFkw...
//    node preparar.js --sem-ofuscar         não embaralha o código (para achar erros)
//    node preparar.js --permitir-http --servidor=http://192.168.0.10:3000 --permitir-sem-chave
//                                            (só para testes na rede local)
//  Também lê as variáveis DS_SERVIDOR e DS_CHAVE_PUBLICA (usadas no GitHub Actions).
//  Ordem de prioridade: opção na linha de comando > variável > config.json.
// =====================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PASTA = __dirname;
const FONTE = path.join(PASTA, 'fonte', 'dente-sempre.html');
const SAIDAS = [
  path.join(PASTA, 'desktop', 'www', 'index.html'),
  path.join(PASTA, 'celular', 'www', 'index.html'),
];
const CONFIG_DESKTOP = path.join(PASTA, 'desktop', 'app-config.json');
const ENDERECO_EXEMPLO = 'api.seudominio.com.br';

function erro(msg) {
  console.error('\n  ERRO: ' + msg + '\n');
  process.exit(1);
}
function aviso(msg) {
  console.warn('  ATENÇÃO: ' + msg);
}

// ---------- opções da linha de comando ----------
const opcoes = {};
for (const arg of process.argv.slice(2)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
  if (!m) erro('Opção não reconhecida: ' + arg);
  opcoes[m[1]] = m[2] === undefined ? true : m[2];
}
const conhecidas = ['servidor', 'chave', 'ofuscar', 'sem-ofuscar', 'permitir-http', 'permitir-sem-chave', 'config'];
for (const k of Object.keys(opcoes)) if (!conhecidas.includes(k)) erro('Opção não reconhecida: --' + k);

// ---------- configuração ----------
const arquivoConfig = opcoes.config ? path.resolve(String(opcoes.config)) : path.join(PASTA, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(arquivoConfig, 'utf8'));
} catch (e) {
  erro('Não consegui ler ' + arquivoConfig + ': ' + e.message);
}

const escolher = (...valores) => {
  for (const v of valores) if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return '';
};
const servidorTexto = escolher(opcoes.servidor, process.env.DS_SERVIDOR, config.servidor);
const chave = escolher(opcoes.chave, process.env.DS_CHAVE_PUBLICA, config.chavePublica).replace(/\s+/g, '');
let ofuscar = config.ofuscar !== false;
if (opcoes['sem-ofuscar']) ofuscar = false;
if (opcoes.ofuscar === true || opcoes.ofuscar === 'true') ofuscar = true;
if (opcoes.ofuscar === 'false') ofuscar = false;
const permitirHttp = !!opcoes['permitir-http'];

// ---------- confere o endereço do servidor ----------
if (!servidorTexto) erro('O endereço do servidor está vazio. Preencha "servidor" em config.json (ex.: https://agenda.minhaclinica.com.br).');
let url;
try {
  url = new URL(servidorTexto);
} catch (e) {
  erro('Endereço do servidor inválido: "' + servidorTexto + '"');
}
if (url.protocol !== 'https:') {
  if (url.protocol === 'http:' && permitirHttp) {
    aviso('usando http:// (sem cadeado). Só para teste na rede local — NUNCA entregue este aplicativo a clientes.');
  } else {
    erro('O endereço do servidor precisa começar com https:// (está "' + servidorTexto + '").\n' +
         '  Para testar com http:// na rede local, use a opção --permitir-http.');
  }
}
if (url.username || url.password || url.search || url.hash) {
  erro('O endereço do servidor não pode ter usuário, senha, "?" ou "#": ' + servidorTexto);
}
const caminho = url.pathname.replace(/\/+$/, '');
const servidor = url.origin + caminho;              // sem / no fim
if (/['"\\<>`\s]/.test(servidor)) erro('O endereço do servidor tem caracteres não permitidos: ' + servidor);
if (url.hostname === ENDERECO_EXEMPLO) {
  aviso('o servidor ainda é o endereço de EXEMPLO (' + ENDERECO_EXEMPLO + '). Troque em config.json antes de entregar.');
}

// ---------- confere a chave pública ----------
if (!chave) {
  if (opcoes['permitir-sem-chave']) {
    aviso('chave pública vazia (--permitir-sem-chave). A licença não poderá ser conferida neste aplicativo.');
  } else {
    erro('A chave pública da licença está vazia. Copie a chave que o servidor mostra para "chavePublica" em config.json.\n' +
         '  (Só para testes: use --permitir-sem-chave.)');
  }
} else {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(chave)) erro('A chave pública tem caracteres inválidos (deve ser o texto em base64 que o servidor mostra).');
  let k;
  try {
    k = crypto.createPublicKey({ key: Buffer.from(chave, 'base64'), format: 'der', type: 'spki' });
  } catch (e) {
    erro('A chave pública não é válida (esperado: chave SPKI em base64). Detalhe: ' + e.message);
  }
  if (k.asymmetricKeyType !== 'ec' || (k.asymmetricKeyDetails || {}).namedCurve !== 'prime256v1') {
    erro('A chave pública precisa ser ECDSA P-256 (é ' + k.asymmetricKeyType + ' ' + ((k.asymmetricKeyDetails || {}).namedCurve || '') + ').');
  }
}

// ---------- lê a página original e troca a linha do SERVIDOR ----------
let html;
try {
  html = fs.readFileSync(FONTE, 'utf8');
} catch (e) {
  erro('Não encontrei o programa original em ' + FONTE);
}
const MARCA = /^([ \t]*)const SERVIDOR = \{[^\n]*\};[ \t]*$/gm;
const achados = html.match(MARCA) || [];
if (achados.length !== 1) {
  erro('Não encontrei (ou encontrei mais de uma vez: ' + achados.length + ') a linha\n' +
       "    const SERVIDOR = { url: '', chavePublica: '' };\n" +
       '  em ' + FONTE + '. O build foi interrompido para não gerar um aplicativo errado.');
}
html = html.replace(MARCA, (_, recuo) => `${recuo}const SERVIDOR = { url: '${servidor}', chavePublica: '${chave}' };`);

// ---------- embaralha o código (javascript-obfuscator) ----------
function embaralhar(codigo) {
  let JavaScriptObfuscator;
  try {
    JavaScriptObfuscator = require('javascript-obfuscator');
  } catch (e) {
    erro('Falta instalar as ferramentas. Rode "npm install" na pasta app/ (ou use --sem-ofuscar).');
  }
  // Opções SEGURAS: não renomeia nomes globais nem propriedades, não usa eval
  // (a proteção CSP proíbe eval), sem "self defending" e sem "debug protection".
  const resultado = JavaScriptObfuscator.obfuscate(codigo, {
    target: 'browser-no-eval',
    compact: true,
    simplify: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    renameProperties: false,
    transformObjectKeys: false,
    controlFlowFlattening: false,     // pesado demais para um arquivo deste tamanho
    deadCodeInjection: false,
    numbersToExpressions: false,
    splitStrings: false,
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: false,
    stringArray: true,
    stringArrayThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayCallsTransform: false,
    stringArrayWrappersCount: 1,
    stringArrayWrappersType: 'variable',
    unicodeEscapeSequence: false,
    sourceMap: false,
    advertisement: false,
    log: false,
  });
  // Dentro de <script>, "</script" e "<!--" no meio do código quebrariam a página.
  return resultado.getObfuscatedCode().replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

let quantosScripts = 0;
if (ofuscar) {
  const inicio = Date.now();
  html = html.replace(/(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, abre, codigo, fecha) => {
    if (!codigo.trim()) return abre + codigo + fecha;
    quantosScripts++;
    return abre + embaralhar(codigo) + fecha;
  });
  if (quantosScripts === 0) erro('Não encontrei nenhum <script> para embaralhar.');
  console.log(`  Código embaralhado (${quantosScripts} script) em ${((Date.now() - inicio) / 1000).toFixed(1)} s.`);
} else {
  aviso('código NÃO embaralhado (--sem-ofuscar).');
}

// ---------- proteção CSP no celular (no computador ela vai no cabeçalho, ver desktop/main.js) ----------
const origemWs = url.origin.replace(/^http/, 'ws');
const cspCelular = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${url.origin} ${origemWs}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function gravar(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
  console.log('  Gravado: ' + path.relative(PASTA, arquivo) + ` (${(Buffer.byteLength(conteudo) / 1024).toFixed(0)} KB)`);
}

const htmlDesktop = html;
const htmlCelular = html.replace(/<meta charset="utf-8">/i,
  m => `${m}\n<meta http-equiv="Content-Security-Policy" content="${cspCelular}">`);
if (htmlCelular === html) erro('Não encontrei <meta charset="utf-8"> para colocar a proteção CSP do celular.');

gravar(SAIDAS[0], htmlDesktop);
gravar(SAIDAS[1], htmlCelular);
gravar(CONFIG_DESKTOP, JSON.stringify({
  servidor,
  origem: url.origin,
  origemWs,
  ofuscado: ofuscar,
  geradoEm: new Date().toISOString(),
}, null, 2) + '\n');

console.log(`\n  Pronto. Servidor: ${servidor}   Chave: ${chave ? chave.slice(0, 12) + '…' : '(vazia)'}\n`);
