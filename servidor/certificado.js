'use strict';
// =====================================================================
//  Certificado AUTOASSINADO para testar o HTTPS (sem instalar nada).
//  O navegador vai avisar "conexão não é particular": é esperado, porque
//  ninguém de fora garantiu este certificado. Para uso de verdade, use um
//  domínio com certificado gratuito do Let's Encrypt (ver README).
//
//  Uso: node servidor.js gerar-certificado [nomes ou IPs extras...]
// =====================================================================
const crypto = require('node:crypto');
const os = require('node:os');

// ---- Pedacinhos do formato DER (ASN.1) ----
function tamanho(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, conteudo) => Buffer.concat([Buffer.from([tag]), tamanho(conteudo.length), conteudo]);
const seq = (...partes) => tlv(0x30, Buffer.concat(partes));
const set = (...partes) => tlv(0x31, Buffer.concat(partes));
function inteiro(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(texto) {
  const n = texto.split('.').map(Number);
  const bytes = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) {
    const pedacos = [v & 0x7f];
    let x = v >>> 7;
    while (x > 0) { pedacos.unshift((x & 0x7f) | 0x80); x >>>= 7; }
    bytes.push(...pedacos);
  }
  return tlv(0x06, Buffer.from(bytes));
}
const utf8 = t => tlv(0x0c, Buffer.from(t, 'utf8'));
const octetos = buf => tlv(0x04, buf);
const bits = buf => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const explicito = (n, conteudo) => tlv(0xa0 + n, conteudo);
function hora(d) {   // UTCTime AAMMDDhhmmssZ
  const p = x => String(x).padStart(2, '0');
  return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`));
}
const nome = cn => seq(set(seq(oid('2.5.4.3'), utf8(cn))), set(seq(oid('2.5.4.10'), utf8('Dente Sempre (teste)'))));
const ehIPv4 = t => /^\d{1,3}(\.\d{1,3}){3}$/.test(t);

function enderecosLocais() {
  const out = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const a of lista || []) if (a.family === 'IPv4') out.push(a.address);
  }
  return out;
}

// Gera { chave, certificado } em PEM, válido por 397 dias, para localhost, os IPs deste computador e os extras
function gerarAutoassinado(extras) {
  const nomes = [...new Set(['localhost', os.hostname(), ...enderecosLocais(), '127.0.0.1', ...(extras || [])].filter(Boolean))];
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const algoritmo = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));   // sha256WithRSAEncryption
  const inicio = new Date(Date.now() - 60 * 60 * 1000);
  const fim = new Date(Date.now() + 397 * 86400000);
  const san = seq(...nomes.map(n => ehIPv4(n)
    ? tlv(0x87, Buffer.from(n.split('.').map(Number)))    // iPAddress
    : tlv(0x82, Buffer.from(n, 'ascii'))));               // dNSName
  const extensoes = seq(
    seq(oid('2.5.29.17'), octetos(san)),                                            // nomes do servidor
    seq(oid('2.5.29.19'), octetos(seq())),                                          // não é autoridade
    seq(oid('2.5.29.37'), octetos(seq(oid('1.3.6.1.5.5.7.3.1')))),                  // uso: servidor HTTPS
    seq(oid('2.5.29.15'), Buffer.from([0x01, 0x01, 0xff]), octetos(tlv(0x03, Buffer.from([0x05, 0xa0]))))   // assinatura + cifra de chave
  );
  const tbs = seq(
    explicito(0, inteiro(Buffer.from([2]))),                 // versão 3
    inteiro(crypto.randomBytes(16)),                         // número de série
    algoritmo,
    nome('Dente Sempre (teste)'),
    seq(hora(inicio), hora(fim)),
    nome(nomes[0]),
    publicKey.export({ type: 'spki', format: 'der' }),
    explicito(3, extensoes)
  );
  const assinatura = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, algoritmo, bits(assinatura));
  const pem = (rotulo, buf) => `-----BEGIN ${rotulo}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${rotulo}-----\n`;
  return {
    chave: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certificado: pem('CERTIFICATE', der),
    nomes,
    validoAte: fim
  };
}

module.exports = { gerarAutoassinado };
