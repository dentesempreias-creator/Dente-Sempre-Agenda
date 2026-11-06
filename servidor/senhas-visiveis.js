'use strict';
// =====================================================================
//  Dente Sempre — SENHAS VISÍVEIS NO PAINEL (06/11)
//
//  O servidor continua conferindo a senha só pelo resumo (scrypt com sal),
//  como antes. Além do resumo, agora ele guarda uma cópia da senha
//  criptografada (AES-256-GCM), para o dono do Dente Sempre ver no /painel
//  o login e a senha de cada usuário, sem gerar senha nova.
//
//  A cópia é feita sempre que o servidor recebe a senha:
//    - clínica criada (painel ou comando), senha provisória nova do
//      administrador, usuário criado ou com senha trocada pelo administrador
//      da clínica, troca da própria senha;
//    - e no login, para quem já tinha senha antes desta versão.
//
//  A chave da criptografia:
//    - SENHAS_CHAVE (variável de ambiente), se existir. Recomendado: assim a
//      chave não fica junto com os dados nem com as cópias de segurança;
//    - senão, o arquivo "chave-senhas.key" na pasta de dados, criado sozinho
//      na primeira vez (só o dono do servidor lê).
//  Se a chave mudar, as senhas guardadas antes deixam de abrir e voltam a
//  aparecer quando cada pessoa entrar de novo.
// =====================================================================
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function criarCofre(pastaDados) {
  let chave = null;
  function obterChave() {
    if (chave) return chave;
    const env = String(process.env.SENHAS_CHAVE || '').trim();
    if (env) { chave = crypto.createHash('sha256').update('dente-sempre-cofre|' + env).digest(); return chave; }
    const arq = path.join(pastaDados, 'chave-senhas.key');
    const ler = () => { const b = Buffer.from(fs.readFileSync(arq, 'utf8').trim(), 'hex'); return b.length === 32 ? b : null; };
    try { chave = ler(); if (chave) return chave; } catch (e) { /* ainda não existe */ }
    fs.mkdirSync(pastaDados, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(arq, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }   // outro processo criou ao mesmo tempo: usa a dele
    chave = ler();
    if (!chave) throw new Error('chave-senhas.key inválida');
    return chave;
  }
  // senha → "v1.<iv>.<etiqueta>.<cifrado>" (base64url)
  function fechar(senha) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', obterChave(), iv);
    const cifrado = Buffer.concat([c.update(String(senha), 'utf8'), c.final()]);
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), cifrado.toString('base64url')].join('.');
  }
  // "v1...." → senha, ou null se não tiver cópia ou a chave for outra
  function abrir(txt) {
    try {
      const p = String(txt || '').split('.');
      if (p.length !== 4 || p[0] !== 'v1') return null;
      const d = crypto.createDecipheriv('aes-256-gcm', obterChave(), Buffer.from(p[1], 'base64url'));
      d.setAuthTag(Buffer.from(p[2], 'base64url'));
      return Buffer.concat([d.update(Buffer.from(p[3], 'base64url')), d.final()]).toString('utf8');
    } catch (e) { return null; }
  }
  return { fechar, abrir };
}

module.exports = { criarCofre };
