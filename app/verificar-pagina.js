#!/usr/bin/env node
// =====================================================================
//  Dente Sempre — verificar-pagina.js
//  Abre a página gerada (já embaralhada) num navegador Chromium invisível,
//  com a mesma proteção CSP do aplicativo, e confere que:
//    - não aconteceu nenhum erro de JavaScript;
//    - a tela de entrada (#loginScreen) aparece com o campo de usuário (#lgUser);
//    - ao tentar entrar (sem servidor de verdade) aparece a mensagem de erro, sem travar.
//  Precisa do Playwright (npm i -g playwright && npx playwright install chromium),
//  ou da variável PLAYWRIGHT_DIR apontando para a pasta node_modules/playwright.
//  Uso: node verificar-pagina.js desktop/www/index.html [celular/www/index.html]
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');

function carregarPlaywright() {
  const tentativas = [process.env.PLAYWRIGHT_DIR, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean);
  for (const t of tentativas) {
    try { return require(t); } catch (e) { /* tenta o próximo */ }
  }
  console.error('Playwright não encontrado. Instale com: npm i -g playwright && npx playwright install chromium');
  process.exit(2);
}

const arquivos = process.argv.slice(2);
if (!arquivos.length) { console.error('Uso: node verificar-pagina.js <arquivo.html> [...]'); process.exit(2); }

// Mesma política do desktop/main.js (connect-src aberto aqui só para o teste).
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: http:; object-src 'none'; frame-ancestors 'none'";

(async () => {
  const { chromium } = carregarPlaywright();
  const navegador = await chromium.launch();
  let falhou = false;
  for (const arq of arquivos) {
    const html = fs.readFileSync(path.resolve(arq));
    const pagina = await navegador.newPage();
    const erros = [];
    pagina.on('pageerror', e => erros.push('pageerror: ' + e.message));
    pagina.on('console', m => {
      // Falha de rede é esperada aqui (o teste não tem servidor); qualquer outro erro conta.
      if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) erros.push('console: ' + m.text());
    });
    await pagina.route('**/*', rota => rota.abort());   // nenhum acesso à internet durante o teste
    await pagina.route('https://dente-sempre.teste/**', rota =>
      rota.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': CSP }, body: html }));
    const inicio = Date.now();
    await pagina.goto('https://dente-sempre.teste/index.html');
    await pagina.waitForSelector('#lgUser', { state: 'visible', timeout: 15000 }).catch(() => {});
    await pagina.waitForTimeout(1000);
    let tentativa = '';
    if (await pagina.isVisible('#lgUser')) {
      await pagina.fill('#lgUser', 'teste');
      await pagina.fill('#lgPass', 'senha-errada');
      await pagina.press('#lgPass', 'Enter');
      await pagina.waitForSelector('#lgError', { state: 'visible', timeout: 15000 }).catch(() => {});
      tentativa = await pagina.textContent('#lgError').catch(() => '');
    }
    const r = await pagina.evaluate(() => ({
      titulo: document.title,
      loginVisivel: !!document.querySelector('#loginScreen') && !document.querySelector('#loginScreen').hidden,
      campoUsuario: !!document.querySelector('#lgUser') && document.querySelector('#lgUser').offsetParent !== null,
      cryptoSubtle: !!(window.crypto && window.crypto.subtle),
    }));
    r.mensagemAoEntrar = (tentativa || '').trim();
    const ok = r.loginVisivel && r.campoUsuario && !!r.mensagemAoEntrar && erros.length === 0;
    if (!ok) falhou = true;
    console.log(`${ok ? 'OK   ' : 'FALHA'} ${arq}  (${Date.now() - inicio} ms)`, JSON.stringify(r));
    for (const e of erros) console.log('      ' + e);
    await pagina.close();
  }
  await navegador.close();
  process.exit(falhou ? 1 : 0);
})();
