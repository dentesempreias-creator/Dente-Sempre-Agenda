#!/usr/bin/env node
// =====================================================================
//  Dente Sempre — teste automático do aplicativo de computador
//  Abre o app (electron .) no modo de teste (DS_TESTE=1), que confere sozinho:
//  tela de entrada, endereço app://dente-sempre, número do aparelho, crypto.subtle,
//  bloqueios (outros sites, pastas fora de www/, janelas extras) e o download do backup.
//  O modo de teste NÃO existe no aplicativo instalado (só funciona com "electron .").
//  No Linux sem tela, roda dentro do xvfb-run. Não rode como root (o Chromium recusa).
//  Uso: npm test   (na pasta desktop/, depois de "npm run preparar" na pasta app/)
// =====================================================================
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');            // caminho do executável do Electron
const env = { ...process.env, DS_TESTE: '1' };
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;

let comando = electron, args = [path.join(__dirname)];
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  comando = 'xvfb-run'; args = ['-a', electron, ...args];
}
if (process.platform === 'linux' && process.getuid && process.getuid() === 0) {
  console.error('Não rode este teste como root: o Chromium não abre com a proteção (sandbox) ligada.');
  process.exit(2);
}

const filho = spawn(comando, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let saida = '';
filho.stdout.on('data', (d) => { saida += d; });
filho.stderr.on('data', () => {});
const limite = setTimeout(() => { filho.kill(); console.error('Tempo esgotado.'); process.exit(1); }, 90000);

filho.on('close', () => {
  clearTimeout(limite);
  const i = saida.indexOf('DS_TESTE_RESULTADO ');
  if (i < 0) { console.error('O app não respondeu ao teste.\n' + saida); process.exit(1); }
  const r = JSON.parse(saida.slice(i + 'DS_TESTE_RESULTADO '.length).trim().split('\n}')[0] + '\n}');
  const provas = [
    ['abre em app://dente-sempre/', r.endereco === 'app://dente-sempre/index.html'],
    ['título da janela "Dente Sempre"', r.tituloJanela === 'Dente Sempre'],
    ['tela de entrada aparece', r.loginVisivel === true],
    ['window.denteSempreApp.aparelho tem 32 caracteres', r.aparelhoOk === true],
    ['window.denteSempreApp não pode ser alterado', r.congelado === true],
    ['página sem acesso ao Node.js', r.semNode === true],
    ['crypto.subtle disponível', r.cryptoSubtle === true],
    ['localStorage na origem app://dente-sempre', r.localStorage === 'app://dente-sempre'],
    ['IndexedDB funciona', r.indexedDB === true],
    ['cabeçalho CSP enviado', typeof r.cspCabecalho === 'string' && r.cspCabecalho.includes("object-src 'none'")],
    ['não sai da pasta www/ (../)', r.travaPasta === 404 && r.travaPasta2 === 404],
    ['bloqueia conexão com outro site', r.bloqueiaOutroSite === 'bloqueado'],
    ['link do WhatsApp abre no navegador', (r.abertosNoNavegador || []).some((u) => u.startsWith('https://wa.me/'))],
    ['não abre janela extra', r.janelaExtra === 'null' && r.janelaArquivo === 'null'],
    ['não navega para outro site', r.continuaNoApp === 'app://dente-sempre/index.html'],
    ['download do backup (Blob) funciona', (r.downloads || []).some((d) => d.estado === 'completed' && d.conteudo === '{"teste":true}')],
    ['nenhum erro ao abrir a página', Array.isArray(r.mensagensNaAbertura) && !r.mensagensNaAbertura.some((m) => m.startsWith('error'))],
  ];
  let falhas = 0;
  for (const [nome, ok] of provas) { console.log((ok ? '  ok    ' : '  FALHA ') + nome); if (!ok) falhas++; }
  if (r.falhaNoTeste) { console.log('  FALHA ' + r.falhaNoTeste); falhas++; }
  console.log(`\n  denteSempreApp = ${r.denteSempreApp}\n  foto da tela: ${r.fotoDaTela}`);
  console.log(falhas ? `\n  ${falhas} problema(s).` : '\n  Tudo certo.');
  process.exit(falhas ? 1 : 0);
});
