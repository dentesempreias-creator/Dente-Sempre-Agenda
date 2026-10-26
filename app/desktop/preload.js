// =====================================================================
//  Dente Sempre — preload.js (roda isolado, antes da página)
//  Entrega para a página só estas informações, somente leitura:
//    window.denteSempreApp = { plataforma: 'desktop', sistema, versao, aparelho }
//  A página NÃO recebe acesso ao Node.js nem ao ipcRenderer.
// =====================================================================
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

let info = null;
try {
  info = ipcRenderer.sendSync('dente-sempre:informacoes');
} catch (e) {
  info = null;
}
if (info && typeof info === 'object') {
  contextBridge.exposeInMainWorld('denteSempreApp', Object.freeze({
    plataforma: String(info.plataforma),
    sistema: String(info.sistema),
    versao: String(info.versao),
    aparelho: String(info.aparelho),
  }));
}
