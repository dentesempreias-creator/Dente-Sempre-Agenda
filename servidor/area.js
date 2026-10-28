'use strict';
// =====================================================================
//  Dente Sempre — ÁREA DO PACIENTE  (endereço: /area)
//
//  A recepção abre o paciente no app e toca em "Enviar acesso à área do
//  paciente". O servidor cria um CÓDIGO de 6 números, e o WhatsApp abre com
//  a mensagem pronta (link + código). O paciente entra com o TELEFONE e o
//  CÓDIGO. Depois de entrar, ele vê só as consultas dele (próximas e
//  anteriores) e pode:
//    - confirmar presença;
//    - pedir para remarcar;
//    - cancelar (se a clínica deixar, e com a antecedência que ela escolher);
//    - abrir o WhatsApp da recepção.
//  Cada ação vira um registro "replies:<id da consulta>" na agenda, igual ao
//  link simples (paciente.js), e chega a todos os aparelhos pela sincronização.
//
//  Segurança:
//   - o código vale UMA vez e por AREA_CODIGO_HORAS horas, e só junto com o
//     telefone cadastrado do paciente;
//   - o banco guarda só resumos (SHA-256) do código e da sessão, nunca eles;
//   - 5 erros seguidos no mesmo telefone, ou 20 do mesmo endereço, fazem esperar;
//   - a sessão fica num cookie HttpOnly (o JavaScript da página não lê), só
//     para /area, e todo formulário leva uma senha da sessão (contra CSRF);
//   - a sessão acaba se o telefone do paciente mudar no cadastro, se o
//     paciente for apagado, se ele tocar em Sair ou depois de AREA_SESSAO_DIAS
//     dias sem uso;
//   - a página não tem JavaScript e não mostra telefone, CPF, endereço,
//     anotações nem nada de outros pacientes.
// =====================================================================
const crypto = require('node:crypto');

const CODIGO_HORAS = Number(process.env.AREA_CODIGO_HORAS || 48);   // validade do código enviado pelo WhatsApp
const SESSAO_DIAS = Number(process.env.AREA_SESSAO_DIAS || 30);     // sessão do paciente sem uso por 30 dias acaba
const FUSO = process.env.FUSO || 'America/Sao_Paulo';               // para saber que dia e hora é na clínica
const PASSADAS = 30;                                                // consultas anteriores mostradas
const ERROS_TEL = 5, ERROS_IP = 20, ESPERA_MIN = 15;
const COOKIE = 'ds_area';
// Regras da clínica quando ela ainda não escolheu (Menu → Configurações → Área do paciente)
const REGRAS_PADRAO = { cancelar: true, horas: 24, whatsapp: '' };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS area_codigos (resumo TEXT PRIMARY KEY, clinicaId TEXT NOT NULL, patientId TEXT NOT NULL,
  criadoEm TEXT NOT NULL, expira TEXT NOT NULL, por TEXT);
CREATE INDEX IF NOT EXISTS area_codigos_pac ON area_codigos (clinicaId, patientId);
CREATE TABLE IF NOT EXISTS area_sessoes (resumo TEXT PRIMARY KEY, clinicaId TEXT NOT NULL, patientId TEXT NOT NULL,
  tel TEXT NOT NULL, criadoEm TEXT NOT NULL, vistoEm TEXT NOT NULL);`;

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const resumoCodigo = (tel, codigo) => sha('dente-sempre-area|' + tel + '|' + codigo);
const resumoSessao = token => sha('dente-sempre-area-sessao|' + token);
const resumoTel = tel => sha('dente-sempre-area-tel|' + tel);
const senhaForm = token => sha('dente-sempre-area-form|' + token).slice(0, 32);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || '';

// Telefone só com números, sem o 55 do Brasil e sem o 0 da operadora.
// Celular antigo sem o 9 (10 números, começando com 6-9) ganha o 9: assim "(11) 8765-4321" e "11 98765-4321" batem.
function telefone(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);
  return d.length === 10 || d.length === 11 ? d : '';
}
const waNumero = s => { const t = telefone(s); return t ? '55' + t : ''; };

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function dataPorExtenso(ymd) {
  const [a, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return `${DIAS[dt.getUTCDay()]}, ${d} de ${MESES[m - 1]}${a !== Number(agoraNaClinica().data.slice(0, 4)) ? ' de ' + a : ''}`;
}
const dm = ymd => { const [, m, d] = String(ymd).split('-'); return `${d}/${m}`; };
// Data e minuto do dia agora, no fuso da clínica
function agoraNaClinica() {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map(x => [x.type, x.value]));
    return { data: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
  } catch (e) { const d = new Date(); return { data: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
}
function horaNaClinica(iso) {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', ' às'); }
  catch (e) { return String(iso).slice(0, 16).replace('T', ' '); }
}
// Minutos que faltam para a consulta começar (negativo = já começou)
function minutosAte(a) {
  const n = agoraNaClinica();
  const dias = Math.round((Date.parse(a.date + 'T00:00:00Z') - Date.parse(n.data + 'T00:00:00Z')) / 86400000);
  const [h, m] = String(a.start || '00:00').split(':').map(Number);
  return dias * 1440 + (h * 60 + m) - n.min;
}

function criarAreaDoPaciente(ctx) {
  const { sistema, bancoDaClinica, clinicaPorId, emTransacao, getMeta, setMeta, planos, agora, recusa } = ctx;
  let preparado = false;
  const s = () => { const db = sistema(); if (!preparado) { db.exec(SCHEMA); preparado = true; } return db; };
  const registro = (d, key) => {
    const r = d.prepare("SELECT data FROM registros WHERE key = ? AND op = 'salvar'").get(key);
    try { return r ? JSON.parse(r.data) : null; } catch (e) { return null; }
  };
  function regras(d) {
    const r = registro(d, 'area:config') || {};
    const horas = Number(r.horas);
    return {
      cancelar: r.cancelar === undefined ? REGRAS_PADRAO.cancelar : r.cancelar !== false,
      horas: Number.isFinite(horas) && horas >= 0 && horas <= 240 ? horas : REGRAS_PADRAO.horas,
      whatsapp: waNumero(r.whatsapp)
    };
  }
  function visual(d, clinica) {
    const conf = registro(d, 'settings:clinica') || {};
    return {
      nomeClinica: String(conf.clinicName || '').trim() || clinica.nome,
      cor: /^#[0-9a-f]{6}$/i.test(conf.accent || '') ? conf.accent : '#1b4f9f',
      logo: /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(conf.logo || '') && conf.logo.length < 1500000 ? conf.logo : ''
    };
  }

  // ---------- POST /api/area/convite  { deviceId, patientId } → { ok, codigo, caminho, horas } ----------
  // (chamado por servidor.js já com o usuário autenticado e o aparelho conferido)
  function convite({ u, clinica, d }, corpo) {
    if (u.role === 'dentista') throw recusa(403, 'sem-permissao', 'O usuário dentista não envia acesso para pacientes.');
    const patientId = String(corpo.patientId || '').slice(0, 80);
    if (!patientId) throw recusa(400, 'dados', 'Paciente não informado.');
    const p = registro(d, 'patients:' + patientId);
    if (!p) throw recusa(409, 'nao-sincronizado', 'Este paciente ainda não chegou ao servidor. Espere sincronizar e tente de novo.');
    const tel = telefone(p.phone);
    if (!tel) throw recusa(400, 'telefone', 'O telefone do paciente está incompleto. Confira o DDD no cadastro e tente de novo.');
    const db = s(), quando = agora();
    const expira = new Date(Date.now() + CODIGO_HORAS * 3600000).toISOString();
    let codigo = '';
    emTransacao(db, () => {
      // Um código por paciente: o novo substitui o anterior
      db.prepare('DELETE FROM area_codigos WHERE clinicaId = ? AND patientId = ?').run(clinica.id, patientId);
      db.prepare('DELETE FROM area_codigos WHERE expira < ?').run(quando);
      for (let i = 0; i < 5 && !codigo; i++) {
        const c = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const h = resumoCodigo(tel, c);
        if (db.prepare('SELECT 1 FROM area_codigos WHERE resumo = ?').get(h)) continue;
        db.prepare('INSERT INTO area_codigos (resumo, clinicaId, patientId, criadoEm, expira, por) VALUES (?, ?, ?, ?, ?, ?)').run(h, clinica.id, patientId, quando, expira, u.id);
        codigo = c;
      }
    });
    if (!codigo) throw recusa(500, 'interno', 'Não consegui criar o código. Tente de novo.');
    return { ok: true, codigo, caminho: '/area?codigo=' + codigo, horas: CODIGO_HORAS };
  }

  // ---------- Limites de tentativas (na memória) ----------
  const erros = new Map();
  function bloqueado(chave) { const t = erros.get(chave); return !!(t && t.ate > Date.now()); }
  function anotarErro(chave, limite) {
    const t = erros.get(chave) || { n: 0, ate: 0 };
    t.n++;
    if (t.n >= limite) { t.ate = Date.now() + ESPERA_MIN * 60000; t.n = 0; }
    erros.set(chave, t);
    if (erros.size > 50000) erros.clear();
  }
  const pedidos = new Map();   // 120 pedidos a cada 10 minutos por endereço
  function muitosPedidos(ip) {
    const ms = Date.now(), t = pedidos.get(ip) || { n: 0, desde: ms };
    if (ms - t.desde > 600000) { t.n = 0; t.desde = ms; }
    t.n++; pedidos.set(ip, t);
    if (pedidos.size > 20000) pedidos.clear();
    return t.n > 120;
  }

  // ---------- Entrar: telefone + código → sessão ----------
  function entrar(telDigitado, codigoDigitado, ip) {
    if (bloqueado('ip|' + ip)) return { erro: `Muitas tentativas. Espere ${ESPERA_MIN} minutos e tente de novo.` };
    const tel = telefone(telDigitado);
    const codigo = String(codigoDigitado || '').replace(/\D/g, '');
    if (!tel) return { erro: 'Digite o seu telefone com DDD, como está no cadastro da clínica.' };
    if (codigo.length !== 6) return { erro: 'O código tem 6 números. Ele está na mensagem que a clínica mandou.' };
    if (bloqueado('tel|' + tel)) return { erro: `Muitas tentativas com este telefone. Espere ${ESPERA_MIN} minutos e tente de novo.` };
    const db = s(), h = resumoCodigo(tel, codigo);
    const c = db.prepare('SELECT * FROM area_codigos WHERE resumo = ?').get(h);
    const falhou = msg => { anotarErro('tel|' + tel, ERROS_TEL); anotarErro('ip|' + ip, ERROS_IP); return { erro: msg }; };
    if (!c) return falhou('Telefone ou código não conferem. Confira os números ou peça um código novo para a clínica.');
    if (c.expira < agora()) { db.prepare('DELETE FROM area_codigos WHERE resumo = ?').run(h); return falhou('Este código venceu. Peça um código novo para a clínica.'); }
    const clinica = clinicaPorId(c.clinicaId);
    if (!clinica || !planos.situacao(clinica).ok) return { erro: 'A área do paciente desta clínica não está disponível agora. Fale com a clínica.' };
    const d = bancoDaClinica(clinica.id);
    const p = registro(d, 'patients:' + c.patientId);
    if (!p || telefone(p.phone) !== tel) { db.prepare('DELETE FROM area_codigos WHERE resumo = ?').run(h); return falhou('Este código não vale mais. Peça um código novo para a clínica.'); }
    const token = crypto.randomBytes(32).toString('base64url'), quando = agora();
    emTransacao(db, () => {
      db.prepare('DELETE FROM area_codigos WHERE resumo = ?').run(h);   // o código vale uma vez só
      db.prepare('INSERT INTO area_sessoes (resumo, clinicaId, patientId, tel, criadoEm, vistoEm) VALUES (?, ?, ?, ?, ?, ?)')
        .run(resumoSessao(token), clinica.id, c.patientId, resumoTel(tel), quando, quando);
      db.prepare('DELETE FROM area_sessoes WHERE vistoEm < ?').run(new Date(Date.now() - SESSAO_DIAS * 86400000).toISOString());
    });
    erros.delete('tel|' + tel);
    return { token };
  }

  // Sessão do cookie → { clinica, d, p, ... } ou null
  function sessao(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) return null;
    const db = s(), h = resumoSessao(token);
    const x = db.prepare('SELECT * FROM area_sessoes WHERE resumo = ?').get(h);
    if (!x) return null;
    const fim = () => { db.prepare('DELETE FROM area_sessoes WHERE resumo = ?').run(h); return null; };
    if (Date.now() - Date.parse(x.vistoEm) > SESSAO_DIAS * 86400000) return fim();
    const clinica = clinicaPorId(x.clinicaId);
    if (!clinica || !planos.situacao(clinica).ok) return null;
    let d;
    try { d = bancoDaClinica(clinica.id); } catch (e) { return null; }
    const p = registro(d, 'patients:' + x.patientId);
    // [SEGURANÇA] telefone mudou no cadastro ou paciente apagado: a sessão acaba
    if (!p || resumoTel(telefone(p.phone)) !== x.tel) return fim();
    if (Date.now() - Date.parse(x.vistoEm) > 5 * 60000) db.prepare('UPDATE area_sessoes SET vistoEm = ? WHERE resumo = ?').run(agora(), h);
    return { h, clinica, d, p, patientId: x.patientId, form: senhaForm(token), regras: regras(d), ...visual(d, clinica) };
  }

  // [SEGURANÇA] só as consultas DESTE paciente; nada de outros pacientes
  function consultasDoPaciente(info) {
    const out = [];
    for (const r of info.d.prepare("SELECT data FROM registros WHERE key LIKE 'appointments:%' AND op = 'salvar'").all()) {
      let a; try { a = JSON.parse(r.data); } catch (e) { continue; }
      if (!a || a.patientId !== info.patientId || a.status === 'deleted' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) continue;
      out.push(a);
    }
    return out;
  }
  function respostaDe(d, a) {
    const r = registro(d, 'replies:' + a.id);
    return r && r.date === a.date && r.start === a.start && ['confirmado', 'remarcar', 'cancelado'].includes(r.tipo) ? r : null;
  }
  // O que o paciente pode fazer nesta consulta, pelas regras da clínica
  function podeFazer(info, a, resp) {
    const falta = minutosAte(a);
    const futura = a.status === 'scheduled' && falta > 0;
    const cancelada = resp && resp.tipo === 'cancelado';
    const noPrazo = falta >= info.regras.horas * 60;
    return {
      futura,
      confirmar: futura && !cancelada && (!resp || resp.tipo !== 'confirmado'),
      remarcar: futura && !cancelada && noPrazo && (!resp || resp.tipo !== 'remarcar'),
      cancelar: futura && !cancelada && noPrazo && info.regras.cancelar,
      foraDoPrazo: futura && !cancelada && !noPrazo && info.regras.horas > 0
    };
  }

  // A ação entra na agenda como um registro, igual à resposta do link simples
  function gravarResposta(info, a, tipo) {
    const { d } = info, quando = agora();
    emTransacao(d, () => {
      const r = Number(getMeta(d, 'rev') || 0) + 1;
      const dado = { apptId: a.id, tipo, em: quando, date: a.date, start: a.start, origem: 'area' };
      d.prepare(`INSERT INTO registros (key, op, data, rev, by, user, at) VALUES (?, 'salvar', ?, ?, 'paciente', '', ?)
        ON CONFLICT(key) DO UPDATE SET op = excluded.op, data = excluded.data, rev = excluded.rev, by = excluded.by, user = excluded.user, at = excluded.at`)
        .run('replies:' + a.id, JSON.stringify(dado), r, quando);
      setMeta(d, 'rev', r);
    });
  }

  // =====================================================================
  //  PÁGINAS (sem JavaScript: só HTML e formulários)
  // =====================================================================
  function moldura(v, titulo, corpo, rodape) {
    const cab = `<header style="background:${v && v.cor || '#1b4f9f'}">${v && v.logo ? `<img src="${v.logo}" alt="">` : ''}<div><small>Área do paciente</small><b>${esc(v && v.nomeClinica || 'Dente Sempre')}</b></div></header>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)}${v && v.nomeClinica ? ' · ' + esc(v.nomeClinica) : ''}</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#eef1f5;color:#1f2a3d;font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:560px;margin:0 auto;min-height:100vh;background:#fff}
  header{display:flex;align-items:center;gap:12px;padding:18px 20px;color:#fff}
  header img{max-height:44px;max-width:120px;background:#fff;border-radius:6px;padding:4px}
  header small{display:block;opacity:.85;font-size:13px} header b{font-size:20px}
  section{padding:22px 20px 28px} h1{font-size:24px;margin:0 0 4px} h2{font-size:19px;margin:26px 0 10px} p{margin:0 0 14px;color:#4a5568}
  label{display:block;font-weight:600;margin:0 0 14px} label span{display:block;font-size:15px;margin-bottom:4px}
  input{width:100%;font:inherit;font-size:20px;padding:12px 14px;border:1px solid #b9c2ce;border-radius:8px;min-height:54px;letter-spacing:.02em}
  input:focus{outline:2px solid #1b4f9f;outline-offset:1px}
  form{margin:0} button,.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;margin:0 0 10px;border-radius:8px;font:inherit;font-weight:700;font-size:17px;cursor:pointer;text-decoration:none;text-align:center;padding:8px 12px}
  .b1{background:#1f8a4c;border:1px solid #17703d;color:#fff} .b2{background:#fff;border:1px solid #b9c2ce;color:#1f2a3d}
  .b3{background:#fff;border:1px solid #c64545;color:#a12d2d} .bp{background:#1b4f9f;border:1px solid #163f80;color:#fff}
  .wa{background:#fff;border:1px solid #25a35a;color:#17703d}
  .card{border:1px solid #dfe4ea;border-radius:10px;padding:14px 16px;margin:0 0 14px}
  .card .quando{font-size:19px;font-weight:700} .card .hora{font-size:26px;font-weight:700;line-height:1.2}
  .card .info{color:#4a5568;margin:2px 0 10px}
  .duas{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
  .ok,.rem,.can,.aviso,.erro{border-radius:8px;padding:10px 12px;margin:0 0 12px;font-weight:600;font-size:16px}
  .ok{background:#e6f5ec;color:#17603a;border:1px solid #b6e0c5} .rem{background:#fff4d6;color:#5c4300;border:1px solid #efd58c}
  .can{background:#fdecec;color:#8a2323;border:1px solid #f0b9b9} .aviso{background:#eef3fb;color:#1f3b6b;border:1px solid #c9d6ec}
  .erro{background:#fdecec;color:#8a2323;border:1px solid #f0b9b9} .nota{background:#f3f5f8;border-radius:8px;padding:10px 12px;font-size:15px}
  ul.ant{list-style:none;margin:0;padding:0} ul.ant li{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #eef1f5;font-size:16px}
  ul.ant small{color:#6b7584;display:block} .tag{font-size:14px;font-weight:700;white-space:nowrap;color:#4a5568}
  .sair{background:none;border:0;color:#4a5568;text-decoration:underline;font-weight:600;min-height:44px;width:auto;margin:0 auto}
  footer{padding:0 20px 24px;font-size:13px;color:#8a94a3}
</style></head><body><main>${cab}<section>${corpo}</section>
<footer>${rodape || 'Área pessoal. Não passe o seu código para outras pessoas.'}</footer></main></body></html>`;
  }

  function paginaEntrar(v, { erro, codigo, tel } = {}) {
    return moldura(v, 'Entrar', `
      <h1>Suas consultas</h1>
      <p>Entre com o seu telefone e o código que a clínica mandou pelo WhatsApp.</p>
      ${erro ? `<div class="erro" role="alert">${esc(erro)}</div>` : ''}
      <form method="post" action="/area/entrar">
        <label><span>Telefone com DDD</span><input name="telefone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 91234-5678" value="${esc(tel || '')}" required></label>
        <label><span>Código de 6 números</span><input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" value="${esc(codigo || '')}" required></label>
        <button class="bp">Entrar</button>
      </form>
      <p class="nota">Não tem o código, ou ele venceu? Peça um código novo para a recepção da clínica.</p>`);
  }

  function waLink(info, texto) {
    return info.regras.whatsapp ? `https://wa.me/${info.regras.whatsapp}?text=${encodeURIComponent(texto)}` : '';
  }

  function paginaPainel(info, aviso) {
    const todas = consultasDoPaciente(info);
    const nome = String(info.p.name || '').trim();
    const futuras = [], passadas = [];
    todas.forEach(a => (a.status === 'scheduled' && minutosAte(a) > -30 ? futuras : passadas).push(a));
    futuras.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
    passadas.sort((x, y) => (y.date + y.start).localeCompare(x.date + x.start));
    const dentistas = {};
    const nomeDentista = id => (id in dentistas) ? dentistas[id] : (dentistas[id] = String((registro(info.d, 'dentists:' + id) || {}).name || ''));
    const waGeral = waLink(info, `Olá! Sou ${nome}, paciente da clínica.`);
    const cartoes = futuras.map(a => {
      const resp = respostaDe(info.d, a), pode = podeFazer(info, a, resp);
      const dent = nomeDentista(a.dentistId);
      let estado = '';
      if (resp && resp.tipo === 'confirmado') estado = `<div class="ok">✓ Presença confirmada em ${esc(horaNaClinica(resp.em))}.</div>`;
      if (resp && resp.tipo === 'remarcar') estado = `<div class="rem">Pedido de remarque enviado em ${esc(horaNaClinica(resp.em))}. A clínica vai falar com você para combinar um novo horário.</div>`;
      if (resp && resp.tipo === 'cancelado') estado = `<div class="can">Você cancelou esta consulta em ${esc(horaNaClinica(resp.em))}. Para marcar de novo, fale com a recepção.</div>`;
      const form = (acao, cls, txt) => `<form method="post" action="/area/acao"><input type="hidden" name="t" value="${info.form}"><input type="hidden" name="consulta" value="${esc(a.id)}"><button name="acao" value="${acao}" class="${cls}">${txt}</button></form>`;
      const botoes = [
        pode.confirmar ? form('confirmar', 'b1', resp && resp.tipo === 'remarcar' ? 'Consigo ir, quero confirmar' : 'Confirmar presença') : '',
        pode.remarcar ? form('remarcar', 'b2', resp ? 'Na verdade, preciso remarcar' : 'Pedir para remarcar') : '',
        pode.cancelar ? form('cancelar', 'b3', 'Cancelar consulta') : ''
      ].join('');
      const prazo = pode.foraDoPrazo ? `<p class="nota">Faltam menos de ${info.regras.horas} horas para esta consulta. Para ${info.regras.cancelar ? 'remarcar ou cancelar' : 'remarcar'}, fale com a recepção.</p>` : '';
      const wa = waLink(info, `Olá! Sou ${nome}. Sobre a minha consulta de ${dm(a.date)} às ${a.start}: `);
      return `<div class="card">
        <div class="quando">${esc(dataPorExtenso(a.date))}</div>
        <div class="hora">${esc(a.start)}</div>
        <div class="info">${[a.typeName, dent].filter(Boolean).map(esc).join(' · ')}</div>
        ${estado}${botoes}${prazo}
        ${wa && (pode.foraDoPrazo || (resp && resp.tipo !== 'confirmado')) ? `<a class="btn wa" href="${esc(wa)}" rel="noopener noreferrer">Falar com a recepção sobre esta consulta</a>` : ''}
      </div>`;
    }).join('');
    const rotulo = a => a.status === 'arrived' ? 'Realizada' : a.status === 'no_show' ? 'Não compareceu' : (respostaDe(info.d, a) || {}).tipo === 'cancelado' ? 'Cancelada' : '';
    const anteriores = passadas.slice(0, PASSADAS).map(a => `<li><div><b>${dm(a.date)}/${a.date.slice(0, 4)}</b> às ${esc(a.start)}<small>${[a.typeName, nomeDentista(a.dentistId)].filter(Boolean).map(esc).join(' · ')}</small></div><span class="tag">${rotulo(a)}</span></li>`).join('');
    const corpo = `
      <h1>Olá, ${esc(primeiroNome(nome)) || 'paciente'}!</h1>
      ${aviso ? `<div class="aviso" role="status">${esc(aviso)}</div>` : ''}
      ${waGeral ? `<a class="btn wa" href="${esc(waGeral)}" rel="noopener noreferrer">Falar com a recepção pelo WhatsApp</a>` : ''}
      <h2>Próximas consultas</h2>
      ${cartoes || '<p class="nota">Você não tem consulta marcada. Para marcar, fale com a recepção.</p>'}
      <h2>Consultas anteriores</h2>
      ${anteriores ? `<ul class="ant">${anteriores}</ul>` : '<p class="nota">Nenhuma consulta anterior.</p>'}
      ${passadas.length > PASSADAS ? `<p class="nota">Mostrando as ${PASSADAS} mais recentes.</p>` : ''}
      <form method="post" action="/area/sair" style="margin-top:22px;text-align:center"><input type="hidden" name="t" value="${info.form}"><button class="sair">Sair deste aparelho</button></form>`;
    return moldura(info, 'Suas consultas', corpo);
  }

  function paginaConfirmarCancelamento(info, a) {
    const dent = String((registro(info.d, 'dentists:' + a.dentistId) || {}).name || '');
    return moldura(info, 'Cancelar consulta', `
      <h1>Cancelar esta consulta?</h1>
      <div class="card"><div class="quando">${esc(dataPorExtenso(a.date))}</div><div class="hora">${esc(a.start)}</div>
        <div class="info">${[a.typeName, dent].filter(Boolean).map(esc).join(' · ')}</div></div>
      <p>O horário fica livre para outro paciente. Para marcar de novo, você vai precisar falar com a recepção.</p>
      <form method="post" action="/area/acao"><input type="hidden" name="t" value="${info.form}"><input type="hidden" name="consulta" value="${esc(a.id)}"><input type="hidden" name="certeza" value="1">
        <button name="acao" value="cancelar" class="b3">Sim, cancelar a consulta</button></form>
      <a class="btn b2" href="/area">Não, voltar</a>`);
  }

  // =====================================================================
  //  GET/POST /area, /area/entrar, /area/acao, /area/sair
  // =====================================================================
  function atender(req, res, url, ip, seguro) {
    const cabecalhos = extra => Object.assign({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Robots-Tag': 'noindex, nofollow'
    }, extra || {});
    const enviar = (status, html, extra) => { res.writeHead(status, cabecalhos(extra)); res.end(html); };
    const ir = (local, extra) => { res.writeHead(303, Object.assign({ Location: local }, extra || {})); res.end(); };
    const cookie = (token, idade) => `${COOKIE}=${token}; Path=/area; HttpOnly; SameSite=Lax; Max-Age=${idade}${seguro ? '; Secure' : ''}`;
    const tokenDoCookie = () => {
      const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]{43})(?:;|$)').exec(req.headers.cookie || '');
      return m ? m[1] : '';
    };
    if (muitosPedidos(ip)) return enviar(429, moldura(null, 'Espere', '<h1>Muitas tentativas</h1><p>Espere alguns minutos e tente de novo.</p>'));
    const caminho = url.pathname.replace(/\/+$/, '') || '/area';
    const lerForm = fn => {
      let corpo = '';
      req.on('data', p => { corpo += p; if (corpo.length > 4000) req.destroy(); });
      req.on('end', () => { try { fn(new URLSearchParams(corpo)); } catch (e) { console.error(new Date().toISOString(), 'área do paciente', e); enviar(500, moldura(null, 'Erro', '<h1>Algo deu errado</h1><p>Tente de novo em instantes.</p><a class="btn b2" href="/area">Voltar</a>')); } });
    };
    let info = null;
    try { info = sessao(tokenDoCookie()); } catch (e) { console.error(new Date().toISOString(), 'área do paciente', e); }

    if (caminho === '/area' && req.method === 'GET') {
      if (info) {
        const avisos = { confirmado: 'Pronto! Sua presença foi confirmada.', remarcar: 'Pedido de remarque enviado. A clínica vai falar com você.', cancelado: 'Consulta cancelada. A clínica já foi avisada.' };
        return enviar(200, paginaPainel(info, avisos[url.searchParams.get('ok')] || ''));
      }
      return enviar(200, paginaEntrar(null, { codigo: String(url.searchParams.get('codigo') || '').replace(/\D/g, '').slice(0, 6) }),
        tokenDoCookie() ? { 'Set-Cookie': cookie('', 0) } : undefined);
    }
    if (caminho === '/area/entrar' && req.method === 'POST') {
      return lerForm(f => {
        const r = entrar(f.get('telefone'), f.get('codigo'), ip);
        if (r.erro) return enviar(r.erro.startsWith('Muitas') ? 429 : 401, paginaEntrar(null, { erro: r.erro, tel: String(f.get('telefone') || '').slice(0, 30) }));
        ir('/area', { 'Set-Cookie': cookie(r.token, SESSAO_DIAS * 86400) });
      });
    }
    if (caminho === '/area/acao' && req.method === 'POST') {
      return lerForm(f => {
        if (!info) return ir('/area');
        if (f.get('t') !== info.form) return enviar(403, paginaPainel(info, 'A página estava desatualizada. Tente de novo.'));
        const acao = f.get('acao');
        const a = consultasDoPaciente(info).find(x => x.id === String(f.get('consulta') || ''));
        // [SEGURANÇA] consulta de outro paciente ou que não existe: nada acontece
        if (!a || !['confirmar', 'remarcar', 'cancelar'].includes(acao)) return enviar(404, paginaPainel(info, 'Consulta não encontrada.'));
        const pode = podeFazer(info, a, respostaDe(info.d, a));
        if (!pode[acao]) return enviar(409, paginaPainel(info, pode.futura ? 'Pelas regras da clínica, isso não pode ser feito por aqui. Fale com a recepção.' : 'Esta consulta já passou ou mudou. Veja abaixo como ela está agora.'));
        if (acao === 'cancelar' && f.get('certeza') !== '1') return enviar(200, paginaConfirmarCancelamento(info, a));
        const tipo = { confirmar: 'confirmado', remarcar: 'remarcar', cancelar: 'cancelado' }[acao];
        gravarResposta(info, a, tipo);
        ir('/area?ok=' + tipo);   // depois de gravar, volta (assim "atualizar" não envia de novo)
      });
    }
    if (caminho === '/area/sair' && req.method === 'POST') {
      return lerForm(f => {
        if (info && f.get('t') === info.form) s().prepare('DELETE FROM area_sessoes WHERE resumo = ?').run(info.h);
        ir('/area', { 'Set-Cookie': cookie('', 0) });
      });
    }
    return enviar(404, moldura(null, 'Não encontrado', '<h1>Página não encontrada</h1><a class="btn b2" href="/area">Ir para a área do paciente</a>'));
  }

  return { convite, atender };
}

module.exports = { criarAreaDoPaciente, telefone, CODIGO_HORAS };
