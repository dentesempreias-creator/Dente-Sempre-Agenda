#!/usr/bin/env node
// =====================================================================
//  Dente Sempre — gera os ícones do aplicativo a partir do desenho abaixo
//  (um dente branco num quadrado azul #1b4f9f).
//  Só precisa rodar de novo se mudar o desenho. Os arquivos gerados já vão
//  junto no projeto:
//    icones/icone.svg, icones/icone-512.png
//    desktop/build/icon.png (512x512)  e  desktop/build/icon.ico (Windows)
//    celular/android/app/src/main/res/  (ícones e tela de abertura do Android), se a pasta existir
//    celular/ios/App/App/Assets.xcassets/ (ícone e tela de abertura do iPhone), se a pasta existir
//  Precisa do Playwright (usa o Chromium para desenhar o SVG).
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const AZUL = '#1b4f9f';
const DENTE = 'M30 18C20 18 14 26 14 38C14 50 20 56 23 66C26 78 27 88 33 88C39 88 39 76 42 68C44 62 46 60 50 60' +
  'C54 60 56 62 58 68C61 76 61 88 67 88C73 88 74 78 77 66C80 56 86 50 86 38C86 26 80 18 70 18C62 18 58 22 50 22C42 22 38 18 30 18Z';

// fundo: 'quadrado' (cantos redondos), 'redondo' (círculo), 'cheio' (sem cantos) ou 'nenhum' (transparente)
// escala: tamanho do dente (1 = ocupa ~74% do ícone)
function svg(fundo, escala = 1, corDente = '#ffffff') {
  const f = fundo === 'quadrado' ? `<rect x="2" y="2" width="96" height="96" rx="22" fill="${AZUL}"/>`
    : fundo === 'redondo' ? `<circle cx="50" cy="50" r="48" fill="${AZUL}"/>`
    : fundo === 'cheio' ? `<rect width="100" height="100" fill="${AZUL}"/>` : '';
  const t = `translate(50 52) scale(${0.82 * escala}) translate(-50 -53)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${f}<path transform="${t}" d="${DENTE}" fill="${corDente}"/></svg>`;
}

function carregarPlaywright() {
  for (const t of [process.env.PLAYWRIGHT_DIR, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(t); } catch (e) { /* próximo */ }
  }
  console.error('Playwright não encontrado (npm i -g playwright && npx playwright install chromium).');
  process.exit(2);
}

// Monta um .ico com imagens PNG dentro (aceito pelo Windows Vista em diante).
function montarIco(pngs) {
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(pngs.length, 4);
  const entradas = []; let pos = 6 + 16 * pngs.length;
  for (const { tamanho, dados } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(tamanho >= 256 ? 0 : tamanho, 0); e.writeUInt8(tamanho >= 256 ? 0 : tamanho, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(dados.length, 8); e.writeUInt32LE(pos, 12);
    pos += dados.length; entradas.push(e);
  }
  return Buffer.concat([cab, ...entradas, ...pngs.map(p => p.dados)]);
}

(async () => {
  const raiz = path.join(__dirname, '..');
  const { chromium } = carregarPlaywright();
  const nav = await chromium.launch();
  const pag = await nav.newPage();
  const desenhar = async (codigo, tamanho) => {
    await pag.setViewportSize({ width: tamanho, height: tamanho });
    await pag.setContent(`<html><body style="margin:0;background:transparent">${codigo.replace('<svg ', `<svg width="${tamanho}" height="${tamanho}" `)}</body></html>`);
    return pag.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: tamanho, height: tamanho } });
  };
  // Tela de abertura: fundo azul inteiro com o dente no meio (sem transparência).
  const abertura = async (largura, altura) => {
    const lado = Math.round(Math.min(largura, altura) * 0.28);
    await pag.setViewportSize({ width: largura, height: altura });
    await pag.setContent(`<html><body style="margin:0;background:${AZUL};width:${largura}px;height:${altura}px;display:flex;align-items:center;justify-content:center">` +
      svg('nenhum').replace('<svg ', `<svg width="${lado}" height="${lado}" `) + '</body></html>');
    return pag.screenshot({ clip: { x: 0, y: 0, width: largura, height: altura } });
  };
  const tamanhoPng = (arquivo) => { const b = fs.readFileSync(arquivo); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const grava = (rel, dados) => {
    const f = path.join(raiz, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, dados);
    console.log('  ' + rel + ' (' + dados.length + ' bytes)');
  };

  grava('icones/icone.svg', svg('quadrado'));
  const png512 = await desenhar(svg('quadrado'), 512);
  grava('icones/icone-512.png', png512);
  grava('desktop/build/icon.png', png512);
  const ico = [];
  for (const t of [16, 24, 32, 48, 64, 128, 256]) ico.push({ tamanho: t, dados: await desenhar(svg('quadrado'), t) });
  grava('desktop/build/icon.ico', montarIco(ico));

  // Android (se o projeto já foi criado com "npx cap add android")
  const res = path.join(raiz, 'celular', 'android', 'app', 'src', 'main', 'res');
  if (fs.existsSync(res)) {
    const densidades = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [d, k] of Object.entries(densidades)) {
      grava(`celular/android/app/src/main/res/mipmap-${d}/ic_launcher.png`, await desenhar(svg('quadrado'), Math.round(48 * k)));
      grava(`celular/android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, await desenhar(svg('redondo'), Math.round(48 * k)));
      // Ícone adaptável (Android 8+): 108dp, o dente fica dentro da área segura de 66dp.
      grava(`celular/android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, await desenhar(svg('nenhum', 0.66), Math.round(108 * k)));
    }
    grava('celular/android/app/src/main/res/values/ic_launcher_background.xml',
      Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${AZUL}</color>\n</resources>\n`));
    for (const pasta of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
      const f = path.join(res, pasta, 'splash.png');
      if (fs.existsSync(f)) grava(path.relative(raiz, f), await abertura(...tamanhoPng(f)));
    }
  } else {
    console.log('  (pasta celular/android ainda não existe: ícones do Android não gerados)');
  }

  // iPhone/iPad (se o projeto já foi criado com "npx cap add ios")
  const xc = path.join(raiz, 'celular', 'ios', 'App', 'App', 'Assets.xcassets');
  if (fs.existsSync(xc)) {
    // A Apple exige ícone sem transparência; o iOS arredonda os cantos sozinho.
    grava('celular/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', await desenhar(svg('cheio'), 1024));
    const sp = path.join(xc, 'Splash.imageset');
    if (fs.existsSync(sp)) {
      for (const f of fs.readdirSync(sp).filter((n) => n.endsWith('.png'))) {
        grava(path.relative(raiz, path.join(sp, f)), await abertura(...tamanhoPng(path.join(sp, f))));
      }
    }
  }
  await nav.close();
})();
