'use strict';
// =====================================================================
//  Dente Sempre — LINK DO PACIENTE (confirmação pelo WhatsApp)
//
//  A recepção toca em "Enviar link para o paciente" numa consulta. O servidor
//  cria um link único (/p/<código>), e o WhatsApp abre com a mensagem pronta.
//  O paciente abre o link e vê SÓ aquela consulta: clínica, data e hora,
//  dentista e procedimento (e o primeiro nome dele). Ele toca em
//  "Confirmar presença" ou "Preciso remarcar".
//
//  A resposta vira um registro "replies:<id da consulta>" na agenda da clínica,
//  e chega a todos os aparelhos pela sincronização normal.
//
//  Segurança:
//   - o código do link tem 144 bits aleatórios: não dá para adivinhar;
//   - o banco guarda só o resumo (SHA-256) do código, nunca o código em si;
//   - a página não mostra telefone, CPF, endereço nem nada de outros pacientes;
//   - abrir o link (GET) não muda nada: só o botão (POST) grava a resposta.
//     Assim a prévia que o WhatsApp gera do link não confirma sozinha;
//   - o link vale até o dia da consulta (no máximo LINK_DIAS dias);
//   - há limite de pedidos por endereço.
// =====================================================================
const crypto = require('node:crypto');

const LINK_DIAS = Number(process.env.LINK_DIAS || 90);           // validade máxima de um link
const FUSO = process.env.FUSO || 'America/Sao_Paulo';            // para saber que dia é "hoje" na clínica
const CODIGO = /^[A-Za-z0-9_-]{24}$/;
const resumo = t => crypto.createHash('sha256').update('dente-sempre-link|' + t).digest('hex');

const SCHEMA_SISTEMA = `CREATE TABLE IF NOT EXISTS links_paciente (resumo TEXT PRIMARY KEY, clinicaId TEXT NOT NULL, criadoEm TEXT NOT NULL);`;
const SCHEMA_CLINICA = `CREATE TABLE IF NOT EXISTS links (resumo TEXT PRIMARY KEY, apptId TEXT NOT NULL, criadoEm TEXT NOT NULL,
  por TEXT, vistoEm TEXT, resposta TEXT, respondidoEm TEXT);`;

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function hojeNaClinica() {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
function horaNaClinica(iso) {
  try { return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)).replace(',', ' às'); }
  catch (e) { return String(iso).slice(0, 16).replace('T', ' '); }
}
function dataPorExtenso(ymd) {
  const [a, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return `${DIAS[dt.getUTCDay()]}, ${d} de ${MESES[m - 1]} de ${a}`;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || '';

function criarLinkDoPaciente(ctx) {
  const { sistema, bancoDaClinica, clinicaPorId, emTransacao, getMeta, setMeta, planos, agora, recusa } = ctx;
  let preparado = false;
  const preparar = () => { if (!preparado) { sistema().exec(SCHEMA_SISTEMA); preparado = true; } };
  const prontas = new Set();
  const banco = id => { const d = bancoDaClinica(id); if (!prontas.has(d)) { d.exec(SCHEMA_CLINICA); prontas.add(d); } return d; };
  const registro = (d, key) => {
    const r = d.prepare("SELECT data FROM registros WHERE key = ? AND op = 'salvar'").get(key);
    try { return r ? JSON.parse(r.data) : null; } catch (e) { return null; }
  };

  // ---------- POST /api/link/criar  { deviceId, apptId } → { ok, caminho } ----------
  // (chamado por servidor.js já com o usuário autenticado e o aparelho conferido)
  function criar({ u, clinica }, corpo) {
    if (u.role === 'dentista') throw recusa(403, 'sem-permissao', 'O usuário dentista não envia links para pacientes.');
    const apptId = String(corpo.apptId || '').slice(0, 80);
    if (!apptId) throw recusa(400, 'dados', 'Consulta não informada.');
    preparar();
    const d = banco(clinica.id);
    const a = registro(d, 'appointments:' + apptId);
    if (!a) throw recusa(409, 'nao-sincronizada', 'Esta consulta ainda não chegou ao servidor. Espere sincronizar e tente de novo.');
    if (a.date < hojeNaClinica()) throw recusa(409, 'passou', 'Esta consulta já passou.');
    const codigo = crypto.randomBytes(18).toString('base64url');
    const h = resumo(codigo), quando = agora();
    d.prepare('INSERT INTO links (resumo, apptId, criadoEm, por) VALUES (?, ?, ?, ?)').run(h, apptId, quando, u.id);
    sistema().prepare('INSERT INTO links_paciente (resumo, clinicaId, criadoEm) VALUES (?, ?, ?)').run(h, clinica.id, quando);
    // Limpa os links vencidos desta clínica
    const limite = new Date(Date.now() - (LINK_DIAS + 30) * 86400000).toISOString();
    const velhos = d.prepare('SELECT resumo FROM links WHERE criadoEm < ?').all(limite);
    if (velhos.length) {
      d.prepare('DELETE FROM links WHERE criadoEm < ?').run(limite);
      const apaga = sistema().prepare('DELETE FROM links_paciente WHERE resumo = ?');
      velhos.forEach(v => apaga.run(v.resumo));
    }
    return { ok: true, caminho: '/p/' + codigo };
  }

  // Acha a consulta de um link. Devolve { erro } ou { clinica, d, link, a, ... }
  function abrir(codigo) {
    if (!CODIGO.test(codigo)) return { erro: 'invalido' };
    preparar();
    const h = resumo(codigo);
    const ix = sistema().prepare('SELECT * FROM links_paciente WHERE resumo = ?').get(h);
    if (!ix) return { erro: 'invalido' };
    const clinica = clinicaPorId(ix.clinicaId);
    if (!clinica || !planos.situacao(clinica).ok) return { erro: 'invalido' };
    let d;
    try { d = banco(clinica.id); } catch (e) { return { erro: 'invalido' }; }
    const link = d.prepare('SELECT * FROM links WHERE resumo = ?').get(h);
    if (!link) return { erro: 'invalido' };   // ex.: clínica restaurada de uma cópia antiga
    if (Date.now() - Date.parse(link.criadoEm) > LINK_DIAS * 86400000) return { erro: 'vencido' };
    const a = registro(d, 'appointments:' + link.apptId);
    const conf = registro(d, 'settings:clinica') || {};
    const nomeClinica = String(conf.clinicName || '').trim() || clinica.nome;
    const cor = /^#[0-9a-f]{6}$/i.test(conf.accent || '') ? conf.accent : '#1b4f9f';
    const logo = /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(conf.logo || '') && conf.logo.length < 1500000 ? conf.logo : '';
    if (!a) return { clinica, d, link, nomeClinica, cor, logo, erro: 'apagada' };
    const dentista = registro(d, 'dentists:' + a.dentistId);
    const paciente = registro(d, 'patients:' + a.patientId);
    const resp = registro(d, 'replies:' + a.id);
    return { clinica, d, link, a, h, nomeClinica, cor, logo,
      dentista: dentista ? dentista.name : '', nome: primeiroNome(paciente && paciente.name),
      resposta: resp && resp.date === a.date && resp.start === a.start ? resp : null };
  }

  // A resposta entra na agenda como um registro, igual a uma alteração feita num aparelho
  function responder(info, tipo) {
    const { d, a, link } = info;
    const quando = agora();
    emTransacao(d, () => {
      let r = Number(getMeta(d, 'rev') || 0) + 1;
      const dado = { apptId: a.id, tipo, em: quando, date: a.date, start: a.start };
      d.prepare(`INSERT INTO registros (key, op, data, rev, by, user, at) VALUES (?, 'salvar', ?, ?, 'paciente', '', ?)
        ON CONFLICT(key) DO UPDATE SET op = excluded.op, data = excluded.data, rev = excluded.rev, by = excluded.by, user = excluded.user, at = excluded.at`)
        .run('replies:' + a.id, JSON.stringify(dado), r, quando);
      setMeta(d, 'rev', r);
      d.prepare('UPDATE links SET resposta = ?, respondidoEm = ? WHERE resumo = ?').run(tipo, quando, link.resumo);
    });
  }

  // ---------- A página que o paciente vê ----------
  function pagina(info, aviso) {
    const cab = `<header style="background:${info.cor || '#1b4f9f'}">${info.logo ? `<img src="${info.logo}" alt="">` : ''}<div><small>Consulta odontológica</small><b>${esc(info.nomeClinica || 'Dente Sempre')}</b></div></header>`;
    let corpo;
    if (info.erro === 'invalido' || info.erro === 'vencido') {
      corpo = `<h1>Link indisponível</h1><p>${info.erro === 'vencido' ? 'Este link venceu.' : 'Este link não vale mais ou foi digitado errado.'} Para saber da sua consulta, fale com a clínica.</p>`;
    } else if (info.erro === 'apagada') {
      corpo = '<h1>Consulta não encontrada</h1><p>Esta consulta não está mais na agenda. Para marcar um novo horário, fale com a clínica.</p>';
    } else {
      const a = info.a;
      const passou = a.date < hojeNaClinica() || a.status === 'no_show' || a.status === 'arrived';
      const dados = `<dl>
        <dt>Data</dt><dd>${esc(dataPorExtenso(a.date))}</dd>
        <dt>Horário</dt><dd class="hora">${esc(a.start)}</dd>
        ${info.dentista ? `<dt>Dentista</dt><dd>${esc(info.dentista)}</dd>` : ''}
        ${a.typeName ? `<dt>Procedimento</dt><dd>${esc(a.typeName)}</dd>` : ''}
      </dl>`;
      const r = info.resposta;
      let estado = '';
      if (r && r.tipo === 'confirmado') estado = `<div class="ok">✓ Presença confirmada${r.em ? ` em ${esc(horaNaClinica(r.em))}` : ''}.</div>`;
      if (r && r.tipo === 'remarcar') estado = `<div class="rem">Pedido de remarque enviado${r.em ? ` em ${esc(horaNaClinica(r.em))}` : ''}. A clínica vai falar com você para combinar um novo horário.</div>`;
      const botoes = passou ? '<p class="nota">Esta consulta já passou. Para marcar de novo, fale com a clínica.</p>'
        : `<form method="post">
            ${!r || r.tipo !== 'confirmado' ? '<button name="acao" value="confirmar" class="b1">Confirmar presença</button>' : ''}
            ${!r || r.tipo !== 'remarcar' ? `<button name="acao" value="remarcar" class="b2">${r ? 'Na verdade, preciso remarcar' : 'Preciso remarcar'}</button>` : ''}
          </form>
          ${r && r.tipo === 'remarcar' ? '<form method="post"><button name="acao" value="confirmar" class="b3">Consigo ir, quero confirmar</button></form>' : ''}`;
      corpo = `<h1>${info.nome ? `Olá, ${esc(info.nome)}!` : 'Olá!'}</h1><p>Esta é a sua consulta:</p>${dados}${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}${estado}${botoes}`;
    }
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Sua consulta${info.nomeClinica ? ' · ' + esc(info.nomeClinica) : ''}</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#eef1f5;color:#1f2a3d;font:17px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:520px;margin:0 auto;min-height:100vh;background:#fff}
  header{display:flex;align-items:center;gap:12px;padding:18px 20px;color:#fff}
  header img{max-height:44px;max-width:120px;background:#fff;border-radius:6px;padding:4px}
  header small{display:block;opacity:.85;font-size:13px} header b{font-size:20px}
  section{padding:22px 20px 32px} h1{font-size:24px;margin:0 0 4px} p{margin:0 0 14px;color:#4a5568}
  dl{margin:8px 0 20px;border:1px solid #dfe4ea;border-radius:8px;padding:6px 16px}
  dt{font-size:13px;color:#6b7584;margin-top:10px} dd{margin:0 0 8px;font-size:19px;font-weight:600} dd.hora{font-size:28px}
  form{margin:0} button{display:block;width:100%;min-height:56px;margin:0 0 12px;border-radius:8px;font:inherit;font-weight:700;font-size:18px;cursor:pointer}
  .b1{background:#1f8a4c;border:1px solid #17703d;color:#fff} .b2{background:#fff;border:1px solid #b9c2ce;color:#1f2a3d} .b3{background:#fff;border:1px solid #1f8a4c;color:#17703d}
  .ok,.rem,.aviso{border-radius:8px;padding:12px 14px;margin:0 0 16px;font-weight:600}
  .ok{background:#e6f5ec;color:#17603a;border:1px solid #b6e0c5} .rem{background:#fff4d6;color:#5c4300;border:1px solid #efd58c}
  .aviso{background:#eef3fb;color:#1f3b6b;border:1px solid #c9d6ec} .nota{background:#f3f5f8;border-radius:8px;padding:12px 14px}
  footer{padding:0 20px 24px;font-size:13px;color:#8a94a3}
</style></head><body><main>${cab}<section>${corpo}</section>
<footer>Link pessoal desta consulta. Não encaminhe para outras pessoas.</footer></main></body></html>`;
  }

  // Limite simples por endereço: 60 pedidos a cada 10 minutos
  const pedidos = new Map();
  function limitar(ip) {
    const agoraMs = Date.now(), t = pedidos.get(ip) || { n: 0, desde: agoraMs };
    if (agoraMs - t.desde > 600000) { t.n = 0; t.desde = agoraMs; }
    t.n++; pedidos.set(ip, t);
    if (pedidos.size > 20000) pedidos.clear();
    return t.n > 60;
  }

  // ---------- GET e POST /p/<código> ----------
  function atender(req, res, codigo, ip) {
    const enviar = (status, html) => {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'X-Robots-Tag': 'noindex, nofollow'
      });
      res.end(html);
    };
    if (limitar(ip)) return enviar(429, pagina({ erro: 'invalido' }).replace('Link indisponível', 'Muitas tentativas. Espere alguns minutos.'));
    if (req.method !== 'GET' && req.method !== 'POST') return enviar(405, pagina({ erro: 'invalido' }));
    let info;
    try { info = abrir(codigo); } catch (e) { console.error(new Date().toISOString(), 'link do paciente', e); info = { erro: 'invalido' }; }
    if (req.method === 'GET') {
      if (info.link && !info.link.vistoEm) { try { info.d.prepare('UPDATE links SET vistoEm = ? WHERE resumo = ?').run(agora(), info.link.resumo); } catch (e) { /* nada */ } }
      return enviar(info.erro ? 404 : 200, pagina(info));
    }
    // POST: lê "acao=confirmar|remarcar" (formulário simples, sem JavaScript)
    let corpo = '';
    req.on('data', p => { corpo += p; if (corpo.length > 2000) req.destroy(); });
    req.on('end', () => {
      const acao = new URLSearchParams(corpo).get('acao');
      if (info.erro || !['confirmar', 'remarcar'].includes(acao)) return enviar(info.erro ? 404 : 400, pagina(info));
      const a = info.a;
      if (a.date < hojeNaClinica() || a.status === 'no_show' || a.status === 'arrived') return enviar(200, pagina(info));
      try { responder(info, acao === 'confirmar' ? 'confirmado' : 'remarcar'); }
      catch (e) { console.error(new Date().toISOString(), 'resposta do paciente', e); return enviar(500, pagina(info, 'Não consegui registrar agora. Tente de novo em instantes.')); }
      // Depois de gravar, volta para a página (assim "atualizar" não envia de novo)
      res.writeHead(303, { Location: '/p/' + codigo });
      res.end();
    });
  }

  return { criar, atender };
}

module.exports = { criarLinkDoPaciente, LINK_DIAS };
