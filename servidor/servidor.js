'use strict';
// =====================================================================
//  Dente Sempre — servidor (versão 2: um banco de dados por clínica)
//  Node.js 22.13 ou mais novo. Sem dependências: não precisa de "npm install".
//  O banco é SQLite (já vem dentro do Node): dados/sistema.db + dados/clinicas/<id>.db
//
//  Ligar:                    node servidor.js            (HTTPS: node servidor.js --https)
//  Certificado de teste:     node servidor.js gerar-certificado
//  Chave pública do app:     node servidor.js chave-publica
//
//  Clínicas e licenças (funcionam COM O SERVIDOR LIGADO):
//    node servidor.js nova-clinica "Nome" [--codigo sorriso] [--plano teste|basico|profissional] [--dias 30]
//    node servidor.js nova-chave <codigo>
//    node servidor.js clinicas
//    node servidor.js plano <codigo> <plano> [--ate AAAA-MM-DD]
//    node servidor.js suspender <codigo>      |  node servidor.js reativar <codigo>
//    node servidor.js aparelhos <codigo>      |  node servidor.js revogar-aparelho <codigo> <aparelho>
//    node servidor.js liberar-aparelho <codigo> <aparelho>
//    node servidor.js senha-admin <codigo>    (senha provisória nova para o administrador)
//  Cópias:
//    node servidor.js copia                   (todas as clínicas e o sistema)
//    node servidor.js copia-clinica <codigo>
//    node servidor.js restaurar-clinica <codigo> <arquivo.db>   (pode ser com o servidor ligado)
//  Versão anterior (banco.json):  node servidor.js migrar-json [dados/banco.json]
// =====================================================================

// O SQLite do Node ainda avisa que é "experimental"; o aviso só confunde quem lê.
const avisoOriginal = process.emitWarning;
process.emitWarning = function (w, ...resto) { if (String(w && w.message || w).includes('SQLite')) return; return avisoOriginal.call(process, w, ...resto); };

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const planos = require('./planos.js');
const { criarLinkDoPaciente } = require('./paciente.js');

const PORTA = Number(process.env.PORTA || process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';                          // atrás do Caddy/Nginx: 127.0.0.1
const PASTA_DADOS = process.env.PASTA_DADOS || path.join(__dirname, 'dados');
const PASTA_CLINICAS = path.join(PASTA_DADOS, 'clinicas');
const PASTA_COPIAS = path.join(PASTA_DADOS, 'copias');
const ARQ_SISTEMA = path.join(PASTA_DADOS, 'sistema.db');
const ARQ_CHAVE_LICENCA = path.join(PASTA_DADOS, 'licenca-privada.pem');
const ARQ_HTML = process.env.ARQ_HTML || path.join(__dirname, 'publico', 'dente-sempre.html');
const LIMITE_CORPO = 30 * 1024 * 1024;     // 30 MB (backup com logo)
const SESSAO_DIAS = 30;                     // sessão sem uso por 30 dias acaba
const LICENCA_DIAS_OFFLINE = Number(process.env.LICENCA_DIAS_OFFLINE || 10);   // quantos dias o app funciona sem falar com o servidor
const BACKUPS_GUARDADOS = 30;               // backups na nuvem guardados por clínica
const TENTATIVAS = 5, BLOQUEIO_MIN = 5;     // 5 senhas erradas seguidas: espera 5 minutos
const TENTATIVAS_IP = 20;                   // 20 erros do mesmo endereço: espera também
const PARTES_ANOTACOES = ['notesDays', 'notesGeneral'];
const CONFIAR_PROXY = process.env.CONFIAR_PROXY === '1';            // atrás de um proxy (Caddy, Nginx, Railway...)
const HSTS = process.env.HSTS === '1';                              // só com certificado de verdade
const COPIA_HORAS = Number(process.env.COPIA_HORAS || 6);           // cópia automática a cada 6 horas (0 = desliga)
const COPIAS_GUARDADAS = Number(process.env.COPIAS_GUARDADAS || 28); // 28 cópias = 7 dias com 4 por dia
const MAX_CLINICAS = Number(process.env.MAX_CLINICAS || 0);         // 0 = sem limite
const SERVIR_PROGRAMA = process.env.SERVIR_PROGRAMA === '1';        // só para teste: entrega o programa no navegador
// Quem pode chamar a API pelo navegador interno dos aplicativos (CORS).
// app://dente-sempre = computador · https://localhost = Android · capacitor://localhost = iPhone
const ORIGENS = (process.env.ORIGENS_PERMITIDAS || 'app://dente-sempre,https://localhost,capacitor://localhost').split(',').map(s => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------
//  >>> O CERTIFICADO DO HTTPS ENTRA AQUI <<<
//   a) Teste:   node servidor.js gerar-certificado   e depois   node servidor.js --https
//   b) Arquivos de verdade (Let's Encrypt/certbot): HTTPS_CERT=... HTTPS_KEY=...
//   c) Recomendado na internet: o Caddy cuida do certificado (hospedagem/Caddyfile)
//      e este servidor fica sem certificado, só dentro da máquina (HOST=127.0.0.1).
// ---------------------------------------------------------------------
const PASTA_CERT = path.join(__dirname, 'certificados');
const HTTPS_CERT = process.env.HTTPS_CERT || (process.argv.includes('--https') ? path.join(PASTA_CERT, 'certificado.pem') : '');
const HTTPS_KEY = process.env.HTTPS_KEY || (process.argv.includes('--https') ? path.join(PASTA_CERT, 'chave.pem') : '');

// ---------- Chave de ativação ----------
// DSEM-XXXX-XXXX-CCCC: XXXX-XXXX são 8 letras sorteadas (40 bits); CCCC confere a digitação.
// A chave sozinha não vale nada: ela é de UMA clínica e só funciona junto com o login dessa clínica.
const KEY_ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function keySum(payload) {
  let h = 0x811c9dc5;
  const str = 'dente-sempre|' + payload;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let out = '';
  for (let i = 0; i < 4; i++) { out += KEY_ALPHA[h & 31]; h >>>= 5; }
  return out;
}
function chaveFormatada(raw) {
  const c = String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (c.length !== 16 || !c.startsWith('DSEM')) return null;
  const payload = c.slice(4, 12), sum = c.slice(12);
  if ([...payload, ...sum].some(ch => !KEY_ALPHA.includes(ch)) || keySum(payload) !== sum) return null;
  return `DSEM-${payload.slice(0, 4)}-${payload.slice(4)}-${sum}`;
}
function gerarChave() {
  let payload = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) payload += KEY_ALPHA[bytes[i] & 31];
  return `DSEM-${payload.slice(0, 4)}-${payload.slice(4)}-${keySum(payload)}`;
}

// ---------- Senhas: guardadas só como resumo (scrypt com sal) ----------
const resumo = (senha, sal) => crypto.scryptSync(String(senha), sal, 64).toString('hex');
function novaSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  return { alg: 'scrypt', sal, resumo: resumo(senha, sal) };
}
function senhaConfere(reg, senha) {
  if (!reg || !reg.sal || typeof senha !== 'string') return false;
  const a = Buffer.from(resumo(senha, reg.sal), 'hex'), b = Buffer.from(reg.resumo, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const senhaProvisoria = () => {
  const alfa = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.randomBytes(10)].map(b => alfa[b % alfa.length]).join('');
};
const agora = () => new Date().toISOString();
const novoId = () => crypto.randomUUID();
const resumoToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// =====================================================================
//  BANCO DE DADOS
//  dados/sistema.db          → clínicas, planos, chaves e aparelhos (o "cadastro" do Dente Sempre)
//  dados/clinicas/<id>.db    → TUDO de uma clínica: usuários, sessões, agenda e backups.
//  Cada clínica num arquivo próprio: os dados não se misturam, e copiar ou
//  restaurar uma clínica não mexe nas outras.
//  O servidor lê o banco a cada pedido (não guarda nada só na memória), por
//  isso os comandos de clínica e chave funcionam com ele ligado.
// =====================================================================
const SCHEMA_SISTEMA = `
  CREATE TABLE IF NOT EXISTS clinicas (id TEXT PRIMARY KEY, codigo TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
    plano TEXT NOT NULL, situacao TEXT NOT NULL, validaAte TEXT, limitesExtra TEXT, criadaEm TEXT NOT NULL, obs TEXT);
  CREATE TABLE IF NOT EXISTS licencas (chave TEXT PRIMARY KEY, clinicaId TEXT NOT NULL, bloqueada INTEGER NOT NULL DEFAULT 0, criadaEm TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS aparelhos (clinicaId TEXT NOT NULL, aparelho TEXT NOT NULL, hw TEXT, chave TEXT, nome TEXT,
    ativadoEm TEXT, vistoEm TEXT, revogado INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (clinicaId, aparelho));
  CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT);`;
const SCHEMA_CLINICA = `
  CREATE TABLE IF NOT EXISTS usuarios (id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL,
    dentistId TEXT, active INTEGER NOT NULL DEFAULT 1, mustChange INTEGER NOT NULL DEFAULT 0, senha TEXT NOT NULL,
    criadoEm TEXT, editadoEm TEXT, senhaTrocadaEm TEXT);
  CREATE TABLE IF NOT EXISTS sessoes (resumo TEXT PRIMARY KEY, userId TEXT NOT NULL, aparelho TEXT, criadaEm TEXT, vistoEm TEXT, ip TEXT);
  CREATE TABLE IF NOT EXISTS registros (key TEXT PRIMARY KEY, op TEXT NOT NULL, data TEXT, rev INTEGER NOT NULL, by TEXT, user TEXT, at TEXT);
  CREATE INDEX IF NOT EXISTS registros_rev ON registros (rev);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, criadoEm TEXT, por TEXT, arquivo TEXT);`;

function abrirBanco(arquivo, schema) {
  const d = new DatabaseSync(arquivo);
  d.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  if (schema) d.exec(schema);
  try { fs.chmodSync(arquivo, 0o600); } catch (e) { /* Windows: sem efeito */ }
  return d;
}
let sis = null;
function sistema() {
  if (!sis) {
    fs.mkdirSync(PASTA_CLINICAS, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(PASTA_DADOS, 0o700); } catch (e) { /* Windows */ }
    sis = abrirBanco(ARQ_SISTEMA, SCHEMA_SISTEMA);
  }
  return sis;
}
// Transação: tudo ou nada
function emTransacao(d, fn) {
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(); d.exec('COMMIT'); return r; }
  catch (e) { try { d.exec('ROLLBACK'); } catch (x) { /* nada */ } throw e; }
}

// [ISOLAMENTO] o id da clínica só tem letras e números: não dá para "subir pastas" com ele
const ID_CLINICA = /^c-[a-z0-9]{10}$/;
function arqClinica(id) {
  if (!ID_CLINICA.test(String(id))) throw recusa(400, 'dados', 'Clínica inválida.');
  return path.join(PASTA_CLINICAS, id + '.db');
}
const abertas = new Map();
function fecharClinica(id) {
  const d = abertas.get(id);
  if (d) { try { d.close(); } catch (e) { /* nada */ } abertas.delete(id); }
}
// Restauração pedida pelo comando "restaurar-clinica": a troca do arquivo acontece aqui,
// no próximo pedido daquela clínica (ou na próxima vez que o servidor ligar).
function trocarSeRestaurada(id) {
  const arq = arqClinica(id), novo = arq + '.restaurar';
  if (!fs.existsSync(novo)) return false;
  fecharClinica(id);
  const carimbo = agora().slice(0, 19).replace(/[:T]/g, '-');
  if (fs.existsSync(arq)) fs.renameSync(arq, `${arq}.antes-de-restaurar-${carimbo}`);
  for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(arq + ext); } catch (e) { /* não havia */ } }
  fs.renameSync(novo, arq);
  const d = bancoDaClinica(id);
  // Nova "época": os aparelhos percebem que o servidor voltou no tempo e recebem tudo de novo
  setMeta(d, 'epoca', crypto.randomBytes(6).toString('hex'));
  setMeta(d, 'restauradaEm', agora());
  return true;
}
function bancoDaClinica(id, criar) {
  const arq = arqClinica(id);
  if (fs.existsSync(arq + '.restaurar') && !criar) trocarSeRestaurada(id);
  let d = abertas.get(id);
  if (!d) {
    if (!criar && !fs.existsSync(arq)) throw recusa(401, 'sessao', 'Clínica não encontrada neste servidor.');
    d = abrirBanco(arq, SCHEMA_CLINICA);
    abertas.set(id, d);
  }
  return d;
}
const getMeta = (d, k) => { const r = d.prepare('SELECT v FROM meta WHERE k = ?').get(k); return r ? r.v : null; };
const setMeta = (d, k, v) => d.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v == null ? null : String(v));

const clinicaPorId = id => sistema().prepare('SELECT * FROM clinicas WHERE id = ?').get(id) || null;
const clinicaPorCodigo = c => sistema().prepare('SELECT * FROM clinicas WHERE codigo = ?').get(String(c || '').trim().toLowerCase()) || null;
function lerUsuario(row) {
  if (!row) return null;
  return Object.assign({}, row, { active: !!row.active, mustChange: !!row.mustChange, senha: JSON.parse(row.senha) });
}

// =====================================================================
//  LICENÇA ASSINADA
//  O servidor assina a licença de cada aparelho com uma chave PRIVADA que
//  nunca sai daqui (dados/licenca-privada.pem, ou a variável LICENCA_CHAVE_PRIVADA).
//  O aplicativo tem só a chave PÚBLICA: ele consegue conferir a assinatura,
//  mas não consegue criar uma licença. Qualquer mudança no texto da licença
//  (plano, data, aparelho) quebra a assinatura.
//  A licença vale LICENCA_DIAS_OFFLINE dias sem falar com o servidor; a cada
//  sincronização o servidor manda uma nova. Formato: base64url(JSON) + "." + base64url(assinatura ECDSA P-256)
// =====================================================================
let chavePrivada = null;
function chavesLicenca() {
  if (chavePrivada) return chavePrivada;
  let pem = process.env.LICENCA_CHAVE_PRIVADA ? process.env.LICENCA_CHAVE_PRIVADA.replace(/\\n/g, '\n') : '';
  if (!pem) {
    if (!fs.existsSync(ARQ_CHAVE_LICENCA)) {
      fs.mkdirSync(PASTA_DADOS, { recursive: true, mode: 0o700 });
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      fs.writeFileSync(ARQ_CHAVE_LICENCA, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
    pem = fs.readFileSync(ARQ_CHAVE_LICENCA, 'utf8');
  }
  chavePrivada = crypto.createPrivateKey(pem);
  return chavePrivada;
}
const chavePublicaB64 = () => crypto.createPublicKey(chavesLicenca()).export({ type: 'spki', format: 'der' }).toString('base64');
function assinar(payload) {
  const corpo = b64url(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(corpo), { key: chavesLicenca(), dsaEncoding: 'ieee-p1363' });
  return corpo + '.' + b64url(sig);
}
function licencaDoAparelho(clinica, ap) {
  const lim = planos.limites(clinica);
  const agoraMs = Date.now();
  let renovarAte = agoraMs + LICENCA_DIAS_OFFLINE * 86400000;
  if (clinica.validaAte) renovarAte = Math.min(renovarAte, Date.parse(clinica.validaAte));
  const payload = {
    v: 1, clinicaId: clinica.id, codigo: clinica.codigo, clinica: clinica.nome,
    plano: clinica.plano, planoNome: planos.nomeDoPlano(clinica.plano), limites: lim,
    situacao: clinica.situacao, validaAte: clinica.validaAte || null,
    aparelho: ap.aparelho, hw: ap.hw || '', chaveFim: String(ap.chave || '').slice(-4),
    emitidaEm: new Date(agoraMs).toISOString(), renovarAte: new Date(renovarAte).toISOString()
  };
  return { token: assinar(payload), dados: payload };
}

// =====================================================================
//  CÓPIAS (o SQLite copia certinho mesmo com o servidor ligado: VACUUM INTO)
// =====================================================================
const carimbo = () => agora().slice(0, 19).replace(/[:T]/g, '-');
function copiarBanco(d, destino) {
  if (fs.existsSync(destino)) fs.unlinkSync(destino);
  d.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  try { fs.chmodSync(destino, 0o600); } catch (e) { /* Windows */ }
}
function listarClinicas() { return sistema().prepare('SELECT * FROM clinicas ORDER BY criadaEm').all(); }
function fazerCopia() {
  const pasta = path.join(PASTA_COPIAS, carimbo());
  fs.mkdirSync(path.join(pasta, 'clinicas'), { recursive: true, mode: 0o700 });
  copiarBanco(sistema(), path.join(pasta, 'sistema.db'));
  for (const c of listarClinicas()) {
    if (fs.existsSync(arqClinica(c.id))) copiarBanco(bancoDaClinica(c.id), path.join(pasta, 'clinicas', c.id + '.db'));
  }
  // A chave que assina as licenças vai junto: sem ela, os aplicativos instalados param de aceitar o servidor
  if (fs.existsSync(ARQ_CHAVE_LICENCA)) fs.copyFileSync(ARQ_CHAVE_LICENCA, path.join(pasta, 'licenca-privada.pem'));
  // Guarda só as últimas COPIAS_GUARDADAS
  const todas = fs.readdirSync(PASTA_COPIAS).filter(n => /^\d{4}-\d\d-\d\d-/.test(n) && fs.statSync(path.join(PASTA_COPIAS, n)).isDirectory()).sort();
  todas.slice(0, Math.max(0, todas.length - COPIAS_GUARDADAS)).forEach(n => fs.rmSync(path.join(PASTA_COPIAS, n), { recursive: true, force: true }));
  return pasta;
}

// =====================================================================
//  RESPOSTAS, SEGURANÇA E SESSÃO
// =====================================================================
class Recusa extends Error {
  constructor(status, codigo, erro) { super(erro); this.status = status; this.codigo = codigo; }
}
const recusa = (status, codigo, erro) => new Recusa(status, codigo, erro);
function seguranca(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  const seguro = req.socket.encrypted || (CONFIAR_PROXY && req.headers['x-forwarded-proto'] === 'https');
  if (HSTS && seguro) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}
function cors(req, res) {
  // Só os aplicativos do Dente Sempre podem chamar a API de dentro de um navegador.
  // (Programas fora do navegador não usam CORS: a proteção de verdade é o login + a licença.)
  const origem = req.headers.origin;
  if (!origem) return;
  if (ORIGENS.includes('*') || ORIGENS.includes(origem)) {
    res.setHeader('Access-Control-Allow-Origin', ORIGENS.includes('*') ? '*' : origem);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}
function ipDoPedido(req) {
  if (CONFIAR_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',').pop().trim();
  return req.socket.remoteAddress || '';
}
function json(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', p => {
      tam += p.length;
      if (tam > LIMITE_CORPO) { reject(recusa(413, 'grande-demais', 'Os dados enviados são grandes demais.')); req.destroy(); return; }
      partes.push(p);
    });
    req.on('end', () => {
      if (!tam) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); }
      catch (e) { reject(recusa(400, 'json', 'Dados em formato errado.')); }
    });
    req.on('error', reject);
  });
}

const publico = u => ({ id: u.id, login: u.login, name: u.name, role: u.role, dentistId: u.dentistId || null,
  active: u.active !== false, mustChange: !!u.mustChange });
const exigir = (cond, erro) => { if (!cond) throw recusa(403, 'sem-permissao', erro || 'Seu usuário não tem permissão para isso.'); };
const textoAparelho = v => { const s = String(v || '').slice(0, 80); return /^[A-Za-z0-9._:-]{8,80}$/.test(s) ? s : ''; };

// O token da sessão tem a clínica na frente: "c-xxxxxxxxxx.<64 letras>". Só o resumo fica guardado.
// [ISOLAMENTO] a clínica vem do token que o próprio servidor criou, nunca de algo que o aparelho escolheu
function autenticar(req, corpo, opcoes = {}) {
  const m = /^Bearer\s+(c-[a-z0-9]{10})\.([0-9a-f]{64})$/i.exec(req.headers.authorization || '');
  if (!m) throw recusa(401, 'sessao', 'Sua sessão no servidor acabou. Entre de novo.');
  const clinica = clinicaPorId(m[1]);
  if (!clinica) throw recusa(401, 'sessao', 'Sua sessão no servidor acabou. Entre de novo.');
  const d = bancoDaClinica(clinica.id);
  const chave = resumoToken(m[1] + '.' + m[2]);
  const s = d.prepare('SELECT * FROM sessoes WHERE resumo = ?').get(chave);
  if (!s) throw recusa(401, 'sessao', 'Sua sessão no servidor acabou. Entre de novo.');
  if (Date.now() - Date.parse(s.vistoEm) > SESSAO_DIAS * 86400000) {
    d.prepare('DELETE FROM sessoes WHERE resumo = ?').run(chave);
    throw recusa(401, 'sessao', 'Sua sessão no servidor acabou. Entre de novo.');
  }
  const u = lerUsuario(d.prepare('SELECT * FROM usuarios WHERE id = ?').get(s.userId));
  if (!u || !u.active) throw recusa(401, 'sessao', 'Este usuário não pode mais entrar. Fale com o administrador.');
  if (!opcoes.semSituacao) {
    const st = planos.situacao(clinica);
    if (!st.ok) throw recusa(403, 'licenca', st.motivo);
  }
  let ap = null;
  if (opcoes.aparelho) {   // sincronizar exige um aparelho ativado e não revogado desta clínica
    const id = textoAparelho(corpo.deviceId);
    ap = id && sistema().prepare('SELECT * FROM aparelhos WHERE clinicaId = ? AND aparelho = ?').get(clinica.id, id);
    if (!ap || ap.revogado) throw recusa(403, 'aparelho', ap ? 'Este aparelho foi desativado para esta clínica. Fale com o administrador.' : 'Este aparelho ainda não foi ativado para esta clínica.');
    sistema().prepare('UPDATE aparelhos SET vistoEm = ? WHERE clinicaId = ? AND aparelho = ?').run(agora(), clinica.id, ap.aparelho);
  }
  if (Date.now() - Date.parse(s.vistoEm) > 5 * 60000) d.prepare('UPDATE sessoes SET vistoEm = ? WHERE resumo = ?').run(agora(), chave);
  return { u, clinica, d, ap, chaveSessao: chave };
}

// Limite de tentativas (senha e chave), por usuário e por endereço
const tentativas = new Map();
function conferirBloqueio(chave) {
  const t = tentativas.get(chave);
  if (t && t.ate > Date.now()) throw recusa(429, 'muitas-tentativas', `Muitas tentativas erradas. Espere ${BLOQUEIO_MIN} minutos e tente de novo.`);
}
function anotarErro(chave, limite) {
  const t = tentativas.get(chave) || { erros: 0, ate: 0 };
  t.erros++;
  if (t.erros >= (limite || TENTATIVAS)) { t.ate = Date.now() + BLOQUEIO_MIN * 60000; t.erros = 0; }
  tentativas.set(chave, t);
  if (tentativas.size > 50000) tentativas.clear();   // não deixa a memória crescer sem fim
}
function problemaSenha(nova, u) {
  if (typeof nova !== 'string' || nova.length < 6) return 'A senha precisa ter pelo menos 6 letras ou números.';
  if (nova.length > 100) return 'A senha é longa demais.';
  if (u && senhaConfere(u.senha, nova)) return 'Escolha uma senha diferente da atual.';
  return '';
}
const contarUsuariosAtivos = d => d.prepare('SELECT COUNT(*) n FROM usuarios WHERE active = 1').get().n;
function contarDentistasAtivos(d) {
  let n = 0;
  for (const r of d.prepare("SELECT data FROM registros WHERE key LIKE 'dentists:%' AND op = 'salvar'").all()) {
    try { const x = JSON.parse(r.data); if (x && x.active !== false) n++; } catch (e) { /* ignora */ }
  }
  return n;
}

// =====================================================================
//  ROTAS (todas POST, JSON). Recusa: { ok:false, codigo, erro }
// =====================================================================
const ROTAS = {
  // { clinica, login, senha, deviceId } → { ok, usuario, token, trocarSenha, clinica, licenca? }
  '/api/login'(corpo, req) {
    const codigo = String(corpo.clinica || '').trim().toLowerCase().slice(0, 40);
    const login = String(corpo.login || '').trim().toLowerCase().slice(0, 30);
    const ip = ipDoPedido(req);
    const chave = ip + '|' + codigo + '|' + login, chaveIp = 'ip|' + ip;
    conferirBloqueio(chave);
    conferirBloqueio(chaveIp);
    const clinica = codigo && clinicaPorCodigo(codigo);
    const d = clinica && bancoDaClinica(clinica.id);
    const u = d && lerUsuario(d.prepare('SELECT * FROM usuarios WHERE login = ? AND active = 1').get(login));
    if (!u || !senhaConfere(u.senha, corpo.senha)) {
      anotarErro(chave);
      anotarErro(chaveIp, TENTATIVAS_IP);
      throw recusa(401, 'senha', 'Clínica, usuário ou senha não conferem.');
    }
    tentativas.delete(chave);
    const st = planos.situacao(clinica);
    if (!st.ok) throw recusa(403, 'licenca', st.motivo);
    const token = clinica.id + '.' + crypto.randomBytes(32).toString('hex');
    const aparelho = textoAparelho(corpo.deviceId);
    d.prepare('INSERT INTO sessoes (resumo, userId, aparelho, criadaEm, vistoEm, ip) VALUES (?, ?, ?, ?, ?, ?)').run(resumoToken(token), u.id, aparelho, agora(), agora(), ip);
    // Aparelho já ativado nesta clínica: já devolve a licença (não precisa digitar a chave de novo)
    const ap = aparelho && sistema().prepare('SELECT * FROM aparelhos WHERE clinicaId = ? AND aparelho = ? AND revogado = 0').get(clinica.id, aparelho);
    return { ok: true, usuario: publico(u), token, trocarSenha: !!u.mustChange,
      clinica: { codigo: clinica.codigo, nome: clinica.nome }, licenca: ap ? licencaDoAparelho(clinica, ap) : null };
  },

  '/api/sair'(corpo, req) {
    try {
      const m = /^Bearer\s+(c-[a-z0-9]{10})\.([0-9a-f]{64})$/i.exec(req.headers.authorization || '');
      if (m && clinicaPorId(m[1])) bancoDaClinica(m[1]).prepare('DELETE FROM sessoes WHERE resumo = ?').run(resumoToken(m[1] + '.' + m[2]));
    } catch (e) { /* sair nunca falha */ }
    return { ok: true };
  },

  // { senhaAtual, senhaNova } — na primeira entrada (senha provisória) não pede a atual
  '/api/senha'(corpo, req) {
    const { u, d } = autenticar(req, corpo, { semSituacao: true });
    if (!u.mustChange && !senhaConfere(u.senha, corpo.senhaAtual)) throw recusa(400, 'senha', 'A senha atual não confere.');
    const p = problemaSenha(corpo.senhaNova, u);
    if (p) throw recusa(400, 'senha-fraca', p);
    d.prepare('UPDATE usuarios SET senha = ?, mustChange = 0, senhaTrocadaEm = ? WHERE id = ?').run(JSON.stringify(novaSenha(corpo.senhaNova)), agora(), u.id);
    return { ok: true };
  },

  // { chave, deviceId, hw, nome } → { ok, licenca: { token, dados } }
  // [VENDA] a chave é da clínica; o aparelho entra no limite do plano
  '/api/ativacao'(corpo, req) {
    const { clinica } = autenticar(req, corpo);
    const ip = ipDoPedido(req), chaveIp = 'chave|' + ip;
    conferirBloqueio(chaveIp);
    const chave = chaveFormatada(corpo.chave);
    const lic = chave && sistema().prepare('SELECT * FROM licencas WHERE chave = ?').get(chave);
    if (!lic || lic.clinicaId !== clinica.id) { anotarErro(chaveIp, 10); throw recusa(400, 'chave', 'Chave inválida para esta clínica. Confira se digitou certo.'); }
    if (lic.bloqueada) throw recusa(403, 'chave', 'Esta chave foi bloqueada. Fale com o suporte.');
    const aparelho = textoAparelho(corpo.deviceId);
    if (!aparelho) throw recusa(400, 'dados', 'Faltou a identificação do aparelho.');
    const hw = String(corpo.hw || '').replace(/[^0-9a-f]/gi, '').slice(0, 64);
    const nome = String(corpo.nome || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const S = sistema();
    const ap = emTransacao(S, () => {
      let atual = S.prepare('SELECT * FROM aparelhos WHERE clinicaId = ? AND aparelho = ?').get(clinica.id, aparelho);
      // Mesmo computador reinstalado (id novo, mesma máquina): reaproveita o lugar dele
      if (!atual && hw) {
        const mesmo = S.prepare('SELECT * FROM aparelhos WHERE clinicaId = ? AND hw = ?').get(clinica.id, hw);
        if (mesmo) { S.prepare('UPDATE aparelhos SET aparelho = ? WHERE clinicaId = ? AND aparelho = ?').run(aparelho, clinica.id, mesmo.aparelho); atual = Object.assign(mesmo, { aparelho }); }
      }
      if (atual && atual.revogado) throw recusa(403, 'aparelho', 'Este aparelho foi desativado para esta clínica. Fale com o suporte.');
      if (!atual) {
        const lim = planos.limites(clinica).aparelhos;
        const n = S.prepare('SELECT COUNT(*) n FROM aparelhos WHERE clinicaId = ? AND revogado = 0').get(clinica.id).n;
        if (n >= lim) throw recusa(403, 'limite', `O plano ${planos.nomeDoPlano(clinica.plano)} permite ${lim} ${lim === 1 ? 'aparelho' : 'aparelhos'}, e a clínica já usa ${n}. Desative um aparelho antigo ou mude de plano.`);
        S.prepare('INSERT INTO aparelhos (clinicaId, aparelho, hw, chave, nome, ativadoEm, vistoEm) VALUES (?, ?, ?, ?, ?, ?, ?)').run(clinica.id, aparelho, hw, chave, nome, agora(), agora());
      } else {
        S.prepare('UPDATE aparelhos SET hw = COALESCE(NULLIF(?, \'\'), hw), chave = ?, nome = COALESCE(NULLIF(?, \'\'), nome), vistoEm = ? WHERE clinicaId = ? AND aparelho = ?').run(hw, chave, nome, agora(), clinica.id, aparelho);
      }
      return S.prepare('SELECT * FROM aparelhos WHERE clinicaId = ? AND aparelho = ?').get(clinica.id, aparelho);
    });
    tentativas.delete(chaveIp);
    return { ok: true, licenca: licencaDoAparelho(clinica, ap) };
  },

  // { deviceId } → { ok, licenca } — renova a licença (o app chama quando ela está perto de vencer)
  '/api/licenca'(corpo, req) {
    const { clinica, ap } = autenticar(req, corpo, { aparelho: true });
    return { ok: true, licenca: licencaDoAparelho(clinica, ap) };
  },

  // { deviceId } — "Desativar este aparelho" no programa: libera o lugar dele no plano (só administrador)
  '/api/aparelho/desativar'(corpo, req) {
    const { u, clinica } = autenticar(req, corpo, { semSituacao: true });
    exigir(u.role === 'admin', 'Só o administrador desativa um aparelho.');
    sistema().prepare('DELETE FROM aparelhos WHERE clinicaId = ? AND aparelho = ? AND revogado = 0').run(clinica.id, textoAparelho(corpo.deviceId));
    return { ok: true };
  },

  // { clinicId, deviceId, userId, modo, changes } → { ok, rev }
  // Regra de conflito: a última alteração enviada vence (registro por registro).
  '/api/sync/enviar'(corpo, req) {
    const { u, clinica, d } = autenticar(req, corpo, { aparelho: true });
    exigir(u.role !== 'dentista', 'O usuário dentista só recebe a agenda; não envia alterações.');
    const substituir = corpo.modo === 'substituir';
    if (substituir) exigir(u.role === 'admin', 'Só o administrador pode enviar um backup restaurado para todos.');
    const changes = Array.isArray(corpo.changes) ? corpo.changes : null;
    if (!changes || typeof corpo.clinicId !== 'string' || !corpo.clinicId) throw recusa(400, 'dados', 'Pacote de alterações incompleto.');
    for (const c of changes) {
      if (!c || typeof c.key !== 'string' || c.key.length > 200 || c.key.indexOf(':') < 1 || (c.op !== 'salvar' && c.op !== 'apagar')) throw recusa(400, 'dados', 'Alteração em formato errado.');
    }
    const rev = emTransacao(d, () => {
      // [ISOLAMENTO] a primeira agenda enviada passa a ser a agenda desta clínica, e só dela
      let agendaId = getMeta(d, 'agendaId');
      if (!agendaId) { agendaId = corpo.clinicId; setMeta(d, 'agendaId', agendaId); }
      if (corpo.clinicId !== agendaId) throw recusa(409, 'outra-clinica', 'O servidor tem a agenda de outra clínica. Nada foi mudado.');
      let r = Number(getMeta(d, 'rev') || 0);
      const at = agora(), by = String(corpo.deviceId || ''), user = u.id;
      const grava = d.prepare('INSERT INTO registros (key, op, data, rev, by, user, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET op = excluded.op, data = excluded.data, rev = excluded.rev, by = excluded.by, user = excluded.user, at = excluded.at');
      if (substituir) {   // o servidor fica igual ao pacote: o que não veio é apagado
        const manter = new Set(changes.map(c => c.key));
        for (const x of d.prepare("SELECT key FROM registros WHERE op != 'apagar'").all()) {
          if (!manter.has(x.key)) grava.run(x.key, 'apagar', null, ++r, by, user, at);
        }
        setMeta(d, 'substituidaEm', at);
      }
      for (const c of changes) grava.run(c.key, c.op, c.op === 'salvar' ? JSON.stringify(c.data === undefined ? null : c.data) : null, ++r, by, user, at);
      // [VENDA] limite de dentistas do plano (o app já avisa antes; aqui é a garantia)
      const limD = planos.limites(clinica).dentistas;
      if (changes.some(c => c.key.startsWith('dentists:')) && contarDentistasAtivos(d) > limD) {
        throw recusa(403, 'limite-plano', `O plano ${planos.nomeDoPlano(clinica.plano)} permite até ${limD} ${limD === 1 ? 'dentista ativo' : 'dentistas ativos'}. Inative um dentista ou mude de plano.`);
      }
      setMeta(d, 'rev', r);
      return r;
    });
    return { ok: true, rev };
  },

  // { clinicId, deviceId, desde, epoca } → { ok, clinicId, rev, epoca, changes, licenca }
  '/api/sync/receber'(corpo, req) {
    const { u, clinica, d, ap } = autenticar(req, corpo, { aparelho: true });
    const desde = Number(corpo.desde) || 0;
    const semAnotacoes = u.role === 'dentista';   // dentista não recebe anotações
    const changes = [];
    for (const r of d.prepare('SELECT * FROM registros WHERE rev > ? ORDER BY rev').all(desde)) {
      if (semAnotacoes && PARTES_ANOTACOES.includes(r.key.slice(0, r.key.indexOf(':')))) continue;
      const c = { key: r.key, op: r.op, rev: r.rev, by: r.by, user: r.user, at: r.at };
      if (r.op === 'salvar') c.data = JSON.parse(r.data);
      changes.push(c);
    }
    return { ok: true, clinicId: getMeta(d, 'agendaId'), rev: Number(getMeta(d, 'rev') || 0), epoca: getMeta(d, 'epoca') || '',
      changes, licenca: licencaDoAparelho(clinica, ap) };
  },

  // { deviceId, apptId } → { ok, caminho: '/p/<código>' } — link de confirmação para o paciente (paciente.js)
  '/api/link/criar'(corpo, req) {
    return linkPaciente().criar(autenticar(req, corpo, { aparelho: true }), corpo);
  },

  // { clinicId, deviceId, arquivo } — guarda os últimos backups da clínica (no banco da própria clínica)
  '/api/backup'(corpo, req) {
    const { u, d } = autenticar(req, corpo, { aparelho: true });
    exigir(u.role === 'admin', 'Só o administrador envia o backup para a nuvem.');
    const arq = corpo.arquivo;
    if (!arq || arq.app !== 'dente-sempre' || !arq.data) throw recusa(400, 'dados', 'Isso não é um backup do Dente Sempre.');
    const r = d.prepare('INSERT INTO backups (criadoEm, por, arquivo) VALUES (?, ?, ?)').run(agora(), u.id, JSON.stringify(arq));
    d.prepare('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT ?)').run(BACKUPS_GUARDADOS);
    return { ok: true, arquivo: 'backup-' + r.lastInsertRowid };
  },

  // Usuários e senhas (só administrador, só da própria clínica)  [ISOLAMENTO]
  '/api/usuarios'(corpo, req) {
    const { u, d } = autenticar(req, corpo);
    exigir(u.role === 'admin');
    return { ok: true, usuarios: d.prepare('SELECT * FROM usuarios ORDER BY criadoEm').all().map(lerUsuario).map(publico) };
  },
  '/api/usuarios/salvar'(corpo, req) {
    const { u: eu, d, clinica } = autenticar(req, corpo);
    exigir(eu.role === 'admin');
    const todos = d.prepare('SELECT * FROM usuarios').all().map(lerUsuario);
    const alvo = corpo.id ? todos.find(x => x.id === corpo.id) : null;
    if (corpo.id && !alvo) throw recusa(404, 'usuario', 'Usuário não encontrado.');
    const name = String(corpo.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const login = String(corpo.login || '').trim().toLowerCase();
    const role = corpo.role;
    const active = alvo ? corpo.active !== false : true;
    const senha = corpo.senha ? String(corpo.senha) : '';
    if (!name) throw recusa(400, 'dados', 'Escreva o nome.');
    if (!/^[a-z0-9._-]{3,30}$/.test(login)) throw recusa(400, 'dados', 'O usuário precisa ter de 3 a 30 letras sem acento, números, ponto, traço ou sublinhado (sem espaço).');
    if (!['admin', 'recepcao', 'dentista'].includes(role)) throw recusa(400, 'dados', 'Perfil inválido.');
    // O nome de usuário só precisa ser único DENTRO da clínica
    if (todos.some(x => x.login === login && x !== alvo)) throw recusa(409, 'login', 'Já existe alguém com esse usuário nesta clínica. Escolha outro.');
    if (role === 'dentista' && !corpo.dentistId) throw recusa(400, 'dados', 'Escolha a agenda do dentista.');
    if (!alvo && senha.length < 6) throw recusa(400, 'senha-fraca', 'A senha provisória precisa ter pelo menos 6 letras ou números.');
    if (alvo && senha && senha.length < 6) throw recusa(400, 'senha-fraca', 'A senha provisória precisa ter pelo menos 6 letras ou números.');
    if (alvo && alvo.id === eu.id && (!active || role !== 'admin')) throw recusa(400, 'proprio', 'Você não pode tirar o seu próprio acesso de administrador nem desativar o seu usuário.');
    const outrosAdmins = todos.filter(x => x.role === 'admin' && x.active && x !== alvo).length;
    if (alvo && alvo.role === 'admin' && (role !== 'admin' || !active) && !outrosAdmins) throw recusa(400, 'admin', 'Precisa ficar pelo menos um administrador ativo.');
    // [VENDA] limite de usuários do plano
    const limU = planos.limites(clinica).usuarios;
    if (active && (!alvo || !alvo.active) && contarUsuariosAtivos(d) >= limU) {
      throw recusa(403, 'limite-plano', `O plano ${planos.nomeDoPlano(clinica.plano)} permite até ${limU} usuários ativos. Desative um usuário ou mude de plano.`);
    }
    const dentistId = role === 'dentista' ? String(corpo.dentistId) : null;
    let id;
    if (alvo) {
      id = alvo.id;
      d.prepare('UPDATE usuarios SET name = ?, login = ?, role = ?, dentistId = ?, active = ?, editadoEm = ? WHERE id = ?').run(name, login, role, dentistId, active ? 1 : 0, agora(), id);
      if (senha) d.prepare('UPDATE usuarios SET senha = ?, mustChange = 1 WHERE id = ?').run(JSON.stringify(novaSenha(senha)), id);
      if (!active) d.prepare('DELETE FROM sessoes WHERE userId = ?').run(id);
    } else {
      id = novoId();
      d.prepare('INSERT INTO usuarios (id, login, name, role, dentistId, active, mustChange, senha, criadoEm) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)').run(id, login, name, role, dentistId, JSON.stringify(novaSenha(senha)), agora());
    }
    const lista = d.prepare('SELECT * FROM usuarios ORDER BY criadoEm').all().map(lerUsuario);
    return { ok: true, usuario: publico(lista.find(x => x.id === id)), usuarios: lista.map(publico) };
  }
};

let lp = null;
const linkPaciente = () => lp || (lp = criarLinkDoPaciente({ sistema, bancoDaClinica, clinicaPorId, emTransacao, getMeta, setMeta, planos, agora, recusa }));

// Só para teste no navegador (SERVIR_PROGRAMA=1). Em uso real, a clínica usa o aplicativo.
function servirHtml(res) {
  let html;
  try { html = fs.readFileSync(ARQ_HTML, 'utf8'); }
  catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Coloque o dente-sempre.html na pasta "publico".'); }
  html = html.replace(/const SERVIDOR = \{ url: '', chavePublica: '' \};/, `const SERVIDOR = { url: location.origin, chavePublica: '${chavePublicaB64()}' };`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
const PAGINA_INICIAL = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dente Sempre</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 16px;color:#1f2a3d">
<h1 style="color:#1b4f9f">Dente Sempre</h1><p>Este é o servidor do Dente Sempre. Para usar a agenda, abra o <b>aplicativo</b> no computador ou no celular.</p></body></html>`;

function criarServidor(opcoesTls) {
  const atender = async (req, res) => {
    seguranca(req, res);
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dente-sempre.html')) {
      if (SERVIR_PROGRAMA) return servirHtml(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGINA_INICIAL);
    }
    // Página pública do paciente (link enviado pelo WhatsApp): só aquela consulta
    const mLink = /^\/p\/([^/]+)$/.exec(url.pathname);
    if (mLink) return linkPaciente().atender(req, res, mLink[1], ipDoPedido(req));
    if (req.method === 'GET' && url.pathname === '/api/situacao') return json(res, 200, { ok: true, servidor: 'Dente Sempre', versao: 2, hora: agora() });
    if (req.method === 'GET' && url.pathname === '/api/chave-publica') return json(res, 200, { ok: true, chavePublica: chavePublicaB64() });
    // [PAINEL] reservado para o painel de administração das clínicas (ainda não existe)
    if (url.pathname.startsWith('/api/painel/')) return json(res, 501, { ok: false, codigo: 'painel', erro: 'O painel de administração das clínicas ainda não está disponível.' });
    const rota = Object.prototype.hasOwnProperty.call(ROTAS, url.pathname) ? ROTAS[url.pathname] : null;
    if (req.method !== 'POST' || !rota) return json(res, 404, { ok: false, codigo: 'nao-encontrado', erro: 'Endereço não encontrado.' });
    try {
      const corpo = await lerCorpo(req);
      json(res, 200, rota(corpo && typeof corpo === 'object' ? corpo : {}, req));
    } catch (e) {
      if (e instanceof Recusa) return json(res, e.status, { ok: false, codigo: e.codigo, erro: e.message });
      console.error(new Date().toISOString(), url.pathname, e);
      json(res, 500, { ok: false, codigo: 'interno', erro: 'Erro no servidor. Tente de novo.' });
    }
  };
  // Só existem as rotas acima: nenhum arquivo das pastas "dados" ou "certificados" é entregue.
  return opcoesTls ? https.createServer(opcoesTls, atender) : http.createServer(atender);
}

// =====================================================================
//  COMANDOS (funcionam com o servidor ligado: o SQLite cuida de dois programas ao mesmo tempo)
// =====================================================================
function opcao(args, nome) {
  const i = args.indexOf('--' + nome);
  return i >= 0 ? args[i + 1] : undefined;
}
const semOpcoes = args => args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--https'));
function exigirClinica(codigo) {
  const c = clinicaPorCodigo(codigo);
  if (!c) { console.log(`Não achei a clínica "${codigo}". Veja os códigos com: node servidor.js clinicas`); process.exit(1); }
  return c;
}
function slug(texto) {
  const t = String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return t.replace(/^(clinica|consultorio|odontologia)-(?=.)/, '').slice(0, 30) || 'clinica';
}
function novaChaveDaClinica(clinica) {
  let k;
  do { k = gerarChave(); } while (sistema().prepare('SELECT 1 FROM licencas WHERE chave = ?').get(k));
  sistema().prepare('INSERT INTO licencas (chave, clinicaId, criadaEm) VALUES (?, ?, ?)').run(k, clinica.id, agora());
  return k;
}
function criarClinica({ nome, codigo, plano, dias, adminLogin = 'admin', adminSenha }) {
  const S = sistema();
  if (MAX_CLINICAS > 0 && S.prepare('SELECT COUNT(*) n FROM clinicas').get().n >= MAX_CLINICAS) {
    throw new Error(`Este servidor já tem o máximo de clínicas configurado (MAX_CLINICAS=${MAX_CLINICAS}).`);
  }
  plano = plano || planos.PLANO_PADRAO;
  if (!planos.PLANOS[plano]) throw new Error(`Plano "${plano}" não existe. Planos: ${Object.keys(planos.PLANOS).join(', ')}`);
  let cod = codigo ? slug(codigo) : slug(nome);
  if (codigo && clinicaPorCodigo(cod)) throw new Error(`Já existe uma clínica com o código "${cod}".`);
  for (let i = 2; clinicaPorCodigo(cod); i++) cod = slug(nome).slice(0, 26) + '-' + i;
  const id = 'c-' + [...crypto.randomBytes(10)].map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const diasValidos = plano === 'teste' ? (Number(dias) || planos.PLANOS.teste.dias) : Number(dias) || 0;
  const validaAte = diasValidos ? new Date(Date.now() + diasValidos * 86400000).toISOString() : null;
  const senha = adminSenha || senhaProvisoria();
  // Primeiro o arquivo da clínica, depois o cadastro (se algo falhar no meio, não fica clínica sem arquivo)
  const d = bancoDaClinica(id, true);
  d.prepare('INSERT INTO usuarios (id, login, name, role, active, mustChange, senha, criadoEm) VALUES (?, ?, ?, ?, 1, 1, ?, ?)')
    .run(novoId(), adminLogin, 'Administrador', 'admin', JSON.stringify(novaSenha(senha)), agora());
  setMeta(d, 'rev', 0);
  S.prepare('INSERT INTO clinicas (id, codigo, nome, plano, situacao, validaAte, criadaEm) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, cod, nome, plano, plano === 'teste' ? 'teste' : 'ativa', validaAte, agora());
  const clinica = clinicaPorId(id);
  const chave = novaChaveDaClinica(clinica);
  return { clinica, login: adminLogin, senha, chave };
}

// Converte o banco.json da versão anterior (um arquivo para todas as clínicas)
function migrarJson(arquivo) {
  const velho = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const out = [];
  for (const [idVelho, cv] of Object.entries(velho.clinicas || {})) {
    const { clinica } = criarClinica({ nome: cv.nome || 'Clínica', plano: 'profissional' });
    const d = bancoDaClinica(clinica.id);
    d.prepare('DELETE FROM usuarios').run();
    sistema().prepare('DELETE FROM licencas WHERE clinicaId = ?').run(clinica.id);
    emTransacao(d, () => {
      for (const u of (velho.usuarios || []).filter(x => x.clinica === idVelho)) {
        d.prepare('INSERT INTO usuarios (id, login, name, role, dentistId, active, mustChange, senha, criadoEm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(u.id, u.login.replace(/^admin\.[a-z0-9]+$/, 'admin'), u.name, u.role, u.dentistId || null, u.active === false ? 0 : 1, u.mustChange ? 1 : 0, JSON.stringify(u.senha), u.criadoEm || agora());
      }
      for (const [k, r] of Object.entries(cv.registros || {})) {
        d.prepare('INSERT INTO registros (key, op, data, rev, by, user, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(k, r.op, r.op === 'salvar' ? JSON.stringify(r.data) : null, r.rev, r.by || '', r.user || '', r.at || agora());
      }
      setMeta(d, 'rev', cv.rev || 0);
      if (cv.agendaId) setMeta(d, 'agendaId', cv.agendaId);
    });
    for (const [k, l] of Object.entries(velho.licencas || {})) {
      if (l.clinica !== idVelho) continue;
      sistema().prepare('INSERT OR IGNORE INTO licencas (chave, clinicaId, bloqueada, criadaEm) VALUES (?, ?, ?, ?)').run(k, clinica.id, l.bloqueada ? 1 : 0, l.criadaEm || agora());
    }
    out.push(clinica);
  }
  return out;
}

function enderecosDaRede() {
  const out = [];
  for (const lista of Object.values(os.networkInterfaces())) for (const a of lista || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
const linhaClinica = c => {
  const lim = planos.limites(c), st = planos.situacao(c);
  const n = sistema().prepare('SELECT COUNT(*) n FROM aparelhos WHERE clinicaId = ? AND revogado = 0').get(c.id).n;
  return `${c.codigo.padEnd(22)} ${c.nome.slice(0, 28).padEnd(28)} ${planos.nomeDoPlano(c.plano).padEnd(13)} ${(st.ok ? c.situacao : c.situacao + ' (bloqueada)').padEnd(20)} ${c.validaAte ? 'até ' + planos.dataBR(c.validaAte) : 'sem data   '}  aparelhos ${n}/${lim.aparelhos}`;
};

function main() {
  const args = process.argv.slice(2);
  const [cmd, a1, a2] = semOpcoes(args).filter(a => a !== '--https');
  if (cmd === 'gerar-certificado') {
    const { gerarAutoassinado } = require('./certificado.js');
    const r = gerarAutoassinado(semOpcoes(args).slice(1));
    fs.mkdirSync(PASTA_CERT, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(PASTA_CERT, 'certificado.pem'), r.certificado);
    fs.writeFileSync(path.join(PASTA_CERT, 'chave.pem'), r.chave, { mode: 0o600 });
    console.log('Certificado de TESTE criado na pasta "certificados" (vale até ' + r.validoAte.toLocaleDateString('pt-BR') + ').');
    console.log('Vale para: ' + r.nomes.join(', '));
    console.log('Agora ligue com:  node servidor.js --https');
    return;
  }
  if (cmd === 'chave-publica') {
    console.log('Chave pública da licença (coloque em app/config.json, campo "chavePublica"):');
    console.log(chavePublicaB64());
    return;
  }
  if (cmd === 'nova-clinica') {
    if (!a1) { console.log('Use: node servidor.js nova-clinica "Nome da clínica" [--codigo sorriso] [--plano teste|basico|profissional] [--dias 30]'); process.exitCode = 1; return; }
    try {
      const r = criarClinica({ nome: String(a1).trim(), codigo: opcao(args, 'codigo'), plano: opcao(args, 'plano'), dias: opcao(args, 'dias') });
      console.log(`Clínica "${r.clinica.nome}" criada.`);
      console.log(`  Código da clínica: ${r.clinica.codigo}`);
      console.log(`  Plano: ${planos.nomeDoPlano(r.clinica.plano)}${r.clinica.validaAte ? ' (até ' + planos.dataBR(r.clinica.validaAte) + ')' : ''}`);
      console.log(`  Primeiro acesso: usuário ${r.login}, senha provisória ${r.senha}`);
      console.log(`  Chave de ativação: ${r.chave}`);
    } catch (e) { console.log('Não criei a clínica: ' + e.message); process.exitCode = 1; }
    return;
  }
  if (cmd === 'nova-chave') {
    const c = exigirClinica(a1);
    console.log(`Chave nova para ${c.nome}: ${novaChaveDaClinica(c)}`);
    return;
  }
  if (cmd === 'clinicas') {
    const lista = listarClinicas();
    if (!lista.length) console.log('Nenhuma clínica ainda. Crie com: node servidor.js nova-clinica "Nome"');
    lista.forEach(c => console.log(linhaClinica(c)));
    return;
  }
  if (cmd === 'plano') {
    const c = exigirClinica(a1);
    if (!planos.PLANOS[a2]) { console.log(`Use: node servidor.js plano <codigo> <${Object.keys(planos.PLANOS).join('|')}> [--ate AAAA-MM-DD]`); process.exitCode = 1; return; }
    const ate = opcao(args, 'ate');
    const validaAte = ate ? new Date(ate + 'T23:59:59').toISOString() : (a2 === 'teste' ? new Date(Date.now() + planos.PLANOS.teste.dias * 86400000).toISOString() : null);
    sistema().prepare('UPDATE clinicas SET plano = ?, situacao = ?, validaAte = ? WHERE id = ?').run(a2, a2 === 'teste' ? 'teste' : 'ativa', validaAte, c.id);
    console.log(linhaClinica(clinicaPorId(c.id)));
    return;
  }
  if (cmd === 'suspender' || cmd === 'reativar') {
    const c = exigirClinica(a1);
    sistema().prepare('UPDATE clinicas SET situacao = ? WHERE id = ?').run(cmd === 'suspender' ? 'suspensa' : (c.plano === 'teste' ? 'teste' : 'ativa'), c.id);
    console.log(linhaClinica(clinicaPorId(c.id)));
    return;
  }
  if (cmd === 'aparelhos') {
    const c = exigirClinica(a1);
    const lista = sistema().prepare('SELECT * FROM aparelhos WHERE clinicaId = ? ORDER BY ativadoEm').all(c.id);
    if (!lista.length) console.log('Nenhum aparelho ativado.');
    lista.forEach(x => console.log(`${x.aparelho.padEnd(34)} ${(x.nome || '').padEnd(24)} ativado ${String(x.ativadoEm).slice(0, 10)}  visto ${String(x.vistoEm).slice(0, 16).replace('T', ' ')}${x.revogado ? '  REVOGADO' : ''}`));
    return;
  }
  if (cmd === 'revogar-aparelho' || cmd === 'liberar-aparelho') {
    const c = exigirClinica(a1);
    const r = sistema().prepare('UPDATE aparelhos SET revogado = ? WHERE clinicaId = ? AND aparelho = ?').run(cmd === 'revogar-aparelho' ? 1 : 0, c.id, String(a2 || ''));
    console.log(r.changes ? (cmd === 'revogar-aparelho' ? 'Aparelho desativado. Ele para de sincronizar no próximo contato e o lugar dele fica livre.' : 'Aparelho liberado de novo.') : 'Não achei esse aparelho. Veja a lista com: node servidor.js aparelhos ' + c.codigo);
    if (cmd === 'liberar-aparelho' && r.changes) console.log('Atenção: ele volta a contar no limite de aparelhos do plano.');
    return;
  }
  if (cmd === 'senha-admin') {
    const c = exigirClinica(a1);
    const d = bancoDaClinica(c.id);
    const adm = d.prepare("SELECT * FROM usuarios WHERE role = 'admin' ORDER BY criadoEm LIMIT 1").get();
    const senha = senhaProvisoria();
    d.prepare('UPDATE usuarios SET senha = ?, mustChange = 1, active = 1 WHERE id = ?').run(JSON.stringify(novaSenha(senha)), adm.id);
    console.log(`Senha provisória nova do administrador de ${c.nome}: usuário ${adm.login}, senha ${senha}`);
    return;
  }
  if (cmd === 'copia') { console.log('Cópia feita em: ' + fazerCopia()); return; }
  if (cmd === 'copia-clinica') {
    const c = exigirClinica(a1);
    fs.mkdirSync(PASTA_COPIAS, { recursive: true, mode: 0o700 });
    const destino = path.join(PASTA_COPIAS, `clinica-${c.codigo}-${carimbo()}.db`);
    copiarBanco(bancoDaClinica(c.id), destino);
    console.log('Cópia da clínica feita em: ' + destino);
    return;
  }
  if (cmd === 'restaurar-clinica') {
    const c = exigirClinica(a1);
    if (!a2 || !fs.existsSync(a2)) { console.log('Use: node servidor.js restaurar-clinica <codigo> <arquivo.db>'); process.exitCode = 1; return; }
    const teste = new DatabaseSync(a2, { readOnly: true });
    try { teste.prepare('SELECT COUNT(*) n FROM registros').get(); teste.prepare('SELECT COUNT(*) n FROM usuarios').get(); }
    catch (e) { console.log('Esse arquivo não é uma cópia de clínica do Dente Sempre.'); process.exitCode = 1; return; }
    finally { teste.close(); }
    fs.copyFileSync(a2, arqClinica(c.id) + '.restaurar');
    console.log(`Restauração preparada para ${c.nome}. Ela acontece no próximo acesso da clínica (com o servidor ligado ou ao ligar).`);
    console.log('O arquivo atual fica guardado ao lado, com o nome ".antes-de-restaurar-<data>".');
    console.log('Atenção: o que os aparelhos ainda não tinham enviado ao servidor será substituído pela cópia.');
    return;
  }
  if (cmd === 'migrar-json') {
    const arq = a1 || path.join(PASTA_DADOS, 'banco.json');
    const r = migrarJson(arq);
    r.forEach(c => console.log(`Migrada: ${c.nome} → código ${c.codigo} (plano Profissional). Os usuários entram com o código da clínica e as senhas de antes.`));
    console.log('Os aparelhos precisam ser ativados de novo (com a mesma chave).');
    return;
  }
  if (cmd) { console.log(`Comando "${cmd}" não existe. Veja a lista no começo do servidor.js ou no README.`); process.exitCode = 1; return; }

  // ---------- Ligar o servidor ----------
  sistema();
  chavesLicenca();
  for (const c of listarClinicas()) { try { trocarSeRestaurada(c.id); } catch (e) { console.error('Restauração de', c.codigo, 'falhou:', e.message); } }
  let tls = null;
  if (HTTPS_CERT || HTTPS_KEY) {
    try { tls = { cert: fs.readFileSync(HTTPS_CERT), key: fs.readFileSync(HTTPS_KEY) }; }
    catch (e) {
      console.error('Não achei o certificado para o HTTPS (' + (HTTPS_CERT || '?') + ' e ' + (HTTPS_KEY || '?') + ').');
      console.error('Para testar, crie um com:  node servidor.js gerar-certificado');
      process.exit(1);
    }
  }
  if (COPIA_HORAS > 0) {
    const copiar = () => { try { fazerCopia(); } catch (e) { console.error('Cópia automática falhou:', e.message); } };
    setTimeout(copiar, 5000).unref();
    setInterval(copiar, COPIA_HORAS * 3600000).unref();
  }
  const srv = criarServidor(tls);
  const prot = tls ? 'https' : 'http';
  srv.listen(PORTA, HOST, () => {
    console.log('Dente Sempre — servidor ligado' + (tls ? ' com HTTPS.' : '.'));
    console.log(`  Neste computador:  ${prot}://localhost:${PORTA}`);
    if (HOST === '0.0.0.0') for (const ip of enderecosDaRede()) console.log(`  Na rede:           ${prot}://${ip}:${PORTA}`);
    console.log(`  Clínicas: ${listarClinicas().length}${listarClinicas().length ? '' : ' (crie com: node servidor.js nova-clinica "Nome")'}`);
    console.log(`  Dados em: ${PASTA_DADOS}` + (COPIA_HORAS > 0 ? ` (cópia automática a cada ${COPIA_HORAS} h em dados/copias)` : ''));
    console.log('  Para desligar: Ctrl+C');
  });
  const desligar = () => { srv.close(); for (const id of [...abertas.keys()]) fecharClinica(id); try { sis.close(); } catch (e) { /* nada */ } process.exit(0); };
  process.on('SIGINT', desligar);
  process.on('SIGTERM', desligar);
}

if (require.main === module) main();
module.exports = { criarServidor, chaveFormatada, gerarChave, criarClinica, fazerCopia, chavePublicaB64 };
