'use strict';
// =====================================================================
//  Dente Sempre — ASSINATURA RECORRENTE (Mercado Pago Assinaturas)
//
//  Troca o pagamento avulso por uma assinatura mensal com cobrança automática.
//  Endereços (os mesmos de antes, agora atendidos por este arquivo):
//    GET  /assinar              → escolha do plano (mensal), com primeiro mês, valor seguinte e cancelamento
//    POST /assinar              → confere o ADMINISTRADOR da clínica, cria a assinatura no Mercado Pago
//                                 e leva para a página do Mercado Pago (o cliente autoriza a cobrança mensal)
//    GET  /assinar/retorno      → volta do Mercado Pago
//    GET/POST /assinar/minha    → ver a assinatura da clínica e cancelar
//    POST /assinar/cancelar     → cancela (no Mercado Pago e aqui)
//    POST /api/pagamento/aviso  → avisos do Mercado Pago (assinatura, cada cobrança e pagamentos avulsos antigos)
//
//  Como o plano muda:
//    A cada cobrança mensal aprovada, o servidor pergunta ao próprio Mercado Pago como ela está
//    (não confia no aviso), confere o valor e chama planos.aoConfirmarPagamento({ meses: 1 }).
//    Cada cobrança vale uma vez só. O cancelamento não tira os dias já pagos.
//
//  Primeiro mês com desconto (PRECO_BASICO_PROMO / PRECO_PROFISSIONAL_PROMO):
//    a assinatura nasce com o valor promocional e, depois da primeira cobrança aprovada,
//    o servidor muda o valor da assinatura no Mercado Pago para o preço normal.
//
//  Os pagamentos avulsos antigos (pagamento.js) continuam sendo conferidos: avisos e voltas deles
//  são passados para pagamento.js sem mudança. ASSINATURA_RECORRENTE=0 volta para o pagamento avulso.
// =====================================================================
const crypto = require('node:crypto');
const { centavosDe } = require('./pagamento.js');

const LIGADA = String(process.env.ASSINATURA_RECORRENTE || '1') !== '0';
const MP_TOKEN = String(process.env.MP_ACCESS_TOKEN || '').trim();
const MP_SEGREDO = String(process.env.MP_WEBHOOK_SEGREDO || '').trim();
const MP_API = String(process.env.MP_API_URL || 'https://api.mercadopago.com').replace(/\/+$/, '');   // MP_API_URL só para teste
const ENDERECO = String(process.env.ENDERECO_PUBLICO || '').replace(/\/+$/, '');
const COM_PIX = String(process.env.ASSINATURA_PIX || '') === '1';   // ligue depois que o Mercado Pago liberar o Pix Automático na sua conta
const ERROS = 5, ESPERA_MIN = 15;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ass_assinaturas (id TEXT PRIMARY KEY, clinicaId TEXT NOT NULL, plano TEXT NOT NULL,
  centavosMes INTEGER NOT NULL, centavosPrimeiro INTEGER NOT NULL, email TEXT, preapprovalId TEXT,
  situacao TEXT NOT NULL DEFAULT 'aguardando', statusMp TEXT, criadaEm TEXT NOT NULL, por TEXT, ip TEXT, atualizadaEm TEXT,
  canceladaEm TEXT, canceladaPor TEXT, cobrancas INTEGER NOT NULL DEFAULT 0, valorAjustado INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS ass_assinaturas_mp ON ass_assinaturas (preapprovalId);
CREATE INDEX IF NOT EXISTS ass_assinaturas_clinica ON ass_assinaturas (clinicaId, criadaEm);
CREATE TABLE IF NOT EXISTS ass_cobrancas (pagamentoId TEXT PRIMARY KEY, assinaturaId TEXT NOT NULL, centavos INTEGER,
  status TEXT, criadaEm TEXT NOT NULL, aplicada INTEGER NOT NULL DEFAULT 0, validaAteDepois TEXT);`;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reais = centavos => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = iso => { if (!iso) return ''; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const emailOk = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e);

function criarAssinatura(ctx) {
  const { sistema, clinicaPorId, clinicaPorCodigo, bancoDaClinica, emTransacao, planos, agora, lerUsuario, senhaConfere, pagamento } = ctx;
  let preparado = false;
  const s = () => {
    const db = sistema();
    if (!preparado) { db.exec(SCHEMA); try { pagamento().listarPedidos(null, 1); } catch (e) { /* cria a tabela de pedidos do pagamento avulso */ } preparado = true; }
    return db;
  };
  const planosPagos = () => Object.keys(planos.PLANOS).filter(k => k !== 'teste');
  const precoMes = plano => centavosDe(process.env['PRECO_' + plano.toUpperCase()]) || centavosDe(planos.PLANOS[plano] && planos.PLANOS[plano].preco);
  const promoMes = plano => { const p = centavosDe(process.env['PRECO_' + String(plano).toUpperCase() + '_PROMO']), n = precoMes(plano); return p && n && p < n ? p : null; };
  const configurado = () => !!MP_TOKEN && planosPagos().some(p => precoMes(p));
  const formas = () => COM_PIX ? 'cartão ou Pix' : 'cartão de crédito';
  // Primeira assinatura: a clínica nunca teve pagamento aprovado (avulso ou de assinatura)
  const jaPagou = clinicaId => !!s().prepare("SELECT 1 FROM pag_pedidos WHERE clinicaId = ? AND situacao IN ('pago', 'devolvido') LIMIT 1").get(clinicaId)
    || !!s().prepare('SELECT 1 FROM ass_cobrancas c JOIN ass_assinaturas a ON a.id = c.assinaturaId WHERE a.clinicaId = ? AND c.aplicada = 1 LIMIT 1').get(clinicaId);
  const assinaturaAtiva = clinicaId => s().prepare("SELECT * FROM ass_assinaturas WHERE clinicaId = ? AND situacao IN ('ativa', 'pausada') ORDER BY criadaEm DESC LIMIT 1").get(clinicaId);

  // ---------- Limite de tentativas de senha ----------
  const erros = new Map();
  const bloqueado = k => { const t = erros.get(k); return !!(t && t.ate > Date.now()); };
  function anotarErro(k) {
    const t = erros.get(k) || { n: 0, ate: 0 };
    t.n++; if (t.n >= ERROS) { t.ate = Date.now() + ESPERA_MIN * 60000; t.n = 0; }
    erros.set(k, t); if (erros.size > 20000) erros.clear();
  }
  // Depois da senha certa em "ver minha assinatura", o botão Cancelar usa um passe curto (10 minutos)
  const passes = new Map();
  const novoPasse = (clinicaId, login) => {
    const t = crypto.randomBytes(24).toString('base64url');
    passes.set(t, { clinicaId, login, ate: Date.now() + 10 * 60000 });
    if (passes.size > 5000) passes.clear();
    return t;
  };

  // ---------- Mercado Pago ----------
  async function mp(metodo, caminho, corpo, idem) {
    const r = await fetch(MP_API + caminho, {
      method: metodo,
      headers: Object.assign({ Authorization: 'Bearer ' + MP_TOKEN, 'Content-Type': 'application/json' }, idem ? { 'X-Idempotency-Key': idem } : {}),
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    const texto = await r.text();
    let j = null; try { j = JSON.parse(texto); } catch (e) { /* resposta sem JSON */ }
    return { status: r.status, j };
  }
  const SITUACAO = { authorized: 'ativa', paused: 'pausada', cancelled: 'cancelada', pending: 'aguardando' };
  function anotarStatus(a, statusMp) {
    const sit = SITUACAO[statusMp];
    if (!sit || a.situacao === 'cancelada') return a;   // cancelada aqui continua cancelada
    s().prepare('UPDATE ass_assinaturas SET situacao = ?, statusMp = ?, atualizadaEm = ?, canceladaEm = COALESCE(canceladaEm, ?) WHERE id = ?')
      .run(sit, statusMp, agora(), sit === 'cancelada' ? agora() : null, a.id);
    return s().prepare('SELECT * FROM ass_assinaturas WHERE id = ?').get(a.id);
  }
  const porPreapproval = id => id ? s().prepare('SELECT * FROM ass_assinaturas WHERE preapprovalId = ?').get(String(id)) : null;
  const porId = id => id ? s().prepare('SELECT * FROM ass_assinaturas WHERE id = ?').get(String(id)) : null;

  // Pergunta ao Mercado Pago como está a assinatura e anota aqui
  async function conferirAssinatura(preapprovalId) {
    const id = String(preapprovalId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    if (!id) return null;
    const r = await mp('GET', '/preapproval/' + id);
    if (r.status === 404) return null;
    if (r.status >= 300 || !r.j) throw new Error('Mercado Pago respondeu ' + r.status);
    let a = porPreapproval(r.j.id) || porId(r.j.external_reference);
    if (!a) return null;
    if (!a.preapprovalId) s().prepare('UPDATE ass_assinaturas SET preapprovalId = ? WHERE id = ?').run(String(r.j.id), a.id);
    a = anotarStatus(porId(a.id), String(r.j.status || ''));
    return a;
  }

  // Uma cobrança mensal aprovada: muda o plano e a validade (uma vez só por cobrança)
  function aplicarCobranca(a, pagamentoId, valor, moeda, status) {
    const centavos = Math.round(Number(valor) * 100);
    const valorOk = String(moeda || 'BRL') === 'BRL' && (centavos === a.centavosMes || centavos === a.centavosPrimeiro);
    const db = s();
    let aplicada = false, novo = null;
    emTransacao(db, () => {
      const ja = db.prepare('SELECT * FROM ass_cobrancas WHERE pagamentoId = ?').get(String(pagamentoId));
      if (ja && ja.aplicada) {
        // Já valeu: só anota se depois foi devolvida ou contestada (o plano NÃO volta sozinho; o painel mostra)
        if (['refunded', 'charged_back'].includes(status) && ja.status !== status) {
          db.prepare('UPDATE ass_cobrancas SET status = ? WHERE pagamentoId = ?').run(status, String(pagamentoId));
          db.prepare("UPDATE pag_pedidos SET situacao = 'devolvido', statusMp = ?, atualizadoEm = ? WHERE pagamentoId = ?").run(status, agora(), String(pagamentoId));
        }
        return;
      }
      const anota = (st, ap, ate) => db.prepare('INSERT INTO ass_cobrancas (pagamentoId, assinaturaId, centavos, status, criadaEm, aplicada, validaAteDepois) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(pagamentoId) DO UPDATE SET status = excluded.status, aplicada = excluded.aplicada, validaAteDepois = excluded.validaAteDepois')
        .run(String(pagamentoId), a.id, centavos, st, agora(), ap ? 1 : 0, ate || null);
      if (status !== 'approved') { anota(status || 'pendente', false); return; }
      if (!valorOk) { anota('valor-diferente', false); console.error(agora(), `assinatura ${a.id}: cobrança ${pagamentoId} de ${valor} ${moeda}, esperado ${a.centavosMes / 100} BRL. O plano NÃO foi mudado.`); return; }
      const clinica = clinicaPorId(a.clinicaId);
      if (!clinica) return;
      novo = planos.aoConfirmarPagamento(clinica, { plano: a.plano, meses: 1 });
      db.prepare('UPDATE clinicas SET plano = ?, situacao = ?, validaAte = ? WHERE id = ?').run(novo.plano, novo.situacao, novo.validaAte, clinica.id);
      anota('approved', true, novo.validaAte);
      db.prepare("UPDATE ass_assinaturas SET cobrancas = cobrancas + 1, situacao = CASE WHEN situacao = 'cancelada' THEN situacao ELSE 'ativa' END, atualizadaEm = ? WHERE id = ?").run(agora(), a.id);
      // Também na lista de pagamentos do painel (mesma tabela do pagamento avulso)
      db.prepare("INSERT OR IGNORE INTO pag_pedidos (id, clinicaId, plano, meses, centavos, criadoEm, por, situacao, pagamentoId, statusMp, atualizadoEm, aplicadoEm, planoAntes, validaAteAntes, validaAteDepois) VALUES (?, ?, ?, 1, ?, ?, 'assinatura', 'pago', ?, 'approved', ?, ?, ?, ?, ?)")
        .run('cob-' + pagamentoId, a.clinicaId, a.plano, centavos, agora(), String(pagamentoId), agora(), agora(), clinica.plano, clinica.validaAte, novo.validaAte);
      aplicada = true;
    });
    if (aplicada) console.log(agora(), `assinatura ${a.id}: cobrança ${pagamentoId} aprovada, clínica ${a.clinicaId} no plano ${a.plano} até ${novo.validaAte}`);
    return aplicada;
  }
  // Depois da 1ª cobrança com desconto, a assinatura passa para o preço normal no Mercado Pago
  async function ajustarValor(a) {
    a = porId(a.id);
    if (!a || a.valorAjustado || a.centavosPrimeiro === a.centavosMes || !a.cobrancas || !a.preapprovalId || a.situacao === 'cancelada') return;
    const r = await mp('PUT', '/preapproval/' + a.preapprovalId, { auto_recurring: { transaction_amount: a.centavosMes / 100, currency_id: 'BRL' } });
    if (r.status < 300) s().prepare('UPDATE ass_assinaturas SET valorAjustado = 1, atualizadaEm = ? WHERE id = ?').run(agora(), a.id);
    else console.error(agora(), `assinatura ${a.id}: o Mercado Pago não aceitou mudar o valor para ${a.centavosMes / 100} (${r.status}). Tento de novo no próximo aviso.`);
  }
  async function cobrancaAutorizada(id) {
    const r = await mp('GET', '/authorized_payments/' + String(id).replace(/\D/g, '').slice(0, 30));
    if (r.status === 404 || !r.j) return null;
    if (r.status >= 300) throw new Error('Mercado Pago respondeu ' + r.status);
    const a = porPreapproval(r.j.preapproval_id) || porId(r.j.external_reference);
    const pg = r.j.payment || {};
    if (!a || !pg.id) return a;
    aplicarCobranca(a, pg.id, r.j.transaction_amount, r.j.currency_id, String(pg.status || ''));
    await ajustarValor(a).catch(e => console.error(agora(), 'ajustar valor', e.message));
    return a;
  }
  // Aviso "payment": cobrança de assinatura ou pagamento avulso antigo
  async function pagamentoQualquer(id) {
    const pid = String(id || '').replace(/\D/g, '').slice(0, 30);
    if (!pid) return;
    const r = await mp('GET', '/v1/payments/' + pid);
    if (r.status >= 300 || !r.j) { if (r.status === 404) return; throw new Error('Mercado Pago respondeu ' + r.status); }
    const p = r.j, poi = p.point_of_interaction && p.point_of_interaction.transaction_data;
    const a = porPreapproval((p.metadata && p.metadata.preapproval_id) || (poi && poi.subscription_id)) || (/^ass-/.test(String(p.external_reference || '')) ? porId(p.external_reference) : null);
    if (a) {
      aplicarCobranca(a, p.id, p.transaction_amount, p.currency_id, String(p.status || ''));
      await ajustarValor(a).catch(e => console.error(agora(), 'ajustar valor', e.message));
      return;
    }
    await pagamento().conferirPagamento(pid);   // pagamento avulso antigo: segue como antes
  }

  // [SEGURANÇA] mesma conferência de assinatura do aviso que o pagamento avulso usa
  function assinaturaConfere(req, url, corpo) {
    if (!MP_SEGREDO) return true;
    const partes = Object.fromEntries(String(req.headers['x-signature'] || '').split(',').map(x => x.split('=').map(y => y.trim())).filter(x => x.length === 2));
    if (!partes.ts || !partes.v1) return false;
    let dataId = url.searchParams.get('data.id') || (corpo && corpo.data && corpo.data.id) || '';
    dataId = String(dataId); if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
    let molde = '';
    if (dataId) molde += `id:${dataId};`;
    if (req.headers['x-request-id']) molde += `request-id:${req.headers['x-request-id']};`;
    molde += `ts:${partes.ts};`;
    const esperado = crypto.createHmac('sha256', MP_SEGREDO).update(molde).digest('hex');
    const x = Buffer.from(esperado), y = Buffer.from(String(partes.v1));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  // ---------- Páginas ----------
  function moldura(titulo, corpo) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)} · Dente Sempre</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#eef2f7;color:#18212f;font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:640px;margin:0 auto;min-height:100vh;background:#fff}
  header{background:#1b4f9f;color:#fff;padding:18px 22px;border-bottom:4px solid #0f8fa6} header b{font-size:21px} header small{display:block;opacity:.85}
  section{padding:24px 22px 30px} h1{font-size:25px;margin:0 0 6px} h2{font-size:18px;margin:26px 0 10px} p{margin:0 0 14px;color:#4a5568}
  .planos{display:grid;gap:12px;margin:0 0 6px}
  .plano{display:flex;gap:14px;align-items:flex-start;border:2px solid #dfe5ec;border-radius:12px;padding:14px 16px;cursor:pointer}
  .plano:has(input:checked){border-color:#1e5bb8;background:#f3f7fd}
  .plano input{width:22px;height:22px;margin:3px 0 0;accent-color:#1e5bb8;flex:none}
  .plano b{font-size:19px} .plano small{display:block;color:#5a6577;font-size:15px}
  .tipo{display:inline-block;font-size:13px;font-weight:700;color:#1b4f9f;background:#e6eefb;border-radius:6px;padding:1px 8px;margin-left:6px;vertical-align:2px}
  ul.cond{list-style:none;margin:8px 0 6px;padding:0;font-size:16px} ul.cond li{padding:2px 0 2px 24px;position:relative}
  ul.cond li::before{content:"✓";position:absolute;left:2px;color:#1c6a3c;font-weight:700}
  ul.cond .p1{font-weight:700;color:#1c6a3c} ul.cond .p2{font-weight:700;color:#1e5bb8}
  label.campo{display:block;font-weight:600;margin:0 0 14px} label.campo span{display:block;font-size:15px;margin-bottom:4px} label.campo small{display:block;font-weight:400;color:#6b7584;font-size:14px;margin-top:4px}
  input[type=text],input[type=password],input[type=email],select{width:100%;font:inherit;font-size:18px;padding:11px 13px;border:1px solid #b9c2ce;border-radius:8px;min-height:50px;background:#fff}
  input:focus,select:focus{outline:2px solid #1e5bb8;outline-offset:1px}
  table{width:100%;border-collapse:collapse;font-size:15px;margin:0 0 8px} th,td{padding:7px 8px;border-bottom:1px solid #e6eaf0;text-align:left} th{color:#5a6577;font-weight:600}
  .rolar{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 8px}
  dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0 0 16px} dt{color:#5a6577} dd{margin:0;font-weight:600}
  button,.btn{display:flex;align-items:center;justify-content:center;text-align:center;width:100%;min-height:54px;border-radius:10px;font:inherit;font-weight:700;font-size:18px;cursor:pointer;text-decoration:none;border:0;margin:8px 0 0}
  .bp{background:#1e5bb8;color:#fff} .b2{background:#fff;border:1px solid #b9c2ce;color:#18212f} .bd{background:#fff;border:2px solid #c23b3b;color:#962c2c}
  .ok,.erro,.aviso{border-radius:10px;padding:12px 14px;margin:0 0 16px;font-weight:600}
  .ok{background:#e4f3e9;color:#1c6a3c;border:1px solid #b6e0c5} .erro{background:#fbeeee;color:#962c2c;border:1px solid #f0b9b9}
  .aviso{background:#fff4d6;color:#5c4300;border:1px solid #efd58c}
  .nota{font-size:14px;color:#6b7584;margin-top:18px}
  a{color:#1e5bb8}
</style></head><body><main><header><small>Assinatura mensal</small><b>Dente Sempre</b></header><section>${corpo}</section></main></body></html>`;
  }
  const camposLogin = v => `
        <label class="campo"><span>Código da clínica</span><input type="text" name="clinica" autocomplete="organization" autocapitalize="none" spellcheck="false" maxlength="40" value="${esc(v.clinica || '')}" required></label>
        <label class="campo"><span>Usuário do administrador</span><input type="text" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" value="${esc(v.login || '')}" required></label>
        <label class="campo"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" maxlength="100" required></label>`;
  function condicoes(p, primeiraVez) {
    const mes = precoMes(p), promo = primeiraVez !== false ? promoMes(p) : null;
    return `<ul class="cond">
      <li>Assinatura mensal</li>
      <li class="p1">Primeiro mês: ${reais(promo || mes)}${promo ? ' <small style="display:inline;font-weight:400;color:#5a6577">(na primeira assinatura da clínica)</small>' : ''}</li>
      <li class="p2">A partir do segundo mês: ${reais(mes)}</li>
      <li>Você pode cancelar quando quiser</li>
      <li>Cobrança automática todo mês (${formas()})</li></ul>`;
  }
  function paginaAssinar(v = {}, erro) {
    if (!configurado()) {
      return moldura('Assinar', `<h1>Assinar o Dente Sempre</h1><div class="aviso">A assinatura pela internet ainda não está disponível. Fale com o suporte do Dente Sempre para escolher o seu plano.</div>`);
    }
    const lista = planosPagos().filter(p => precoMes(p));
    const escolhido = lista.includes(v.plano) ? v.plano : lista[0];
    const lim = p => planos.PLANOS[p];
    return moldura('Assinar', `
      <h1>Assinar o Dente Sempre</h1>
      <p>Escolha o plano. A cobrança é <b>mensal e automática</b> no Mercado Pago, e você pode cancelar quando quiser. Depois, entre com o <b>código da clínica</b> e o usuário <b>administrador</b> (o mesmo do programa).</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
      <form method="post" action="/assinar">
        <h2>Plano</h2>
        <div class="planos">
          ${lista.map(p => `<label class="plano"><input type="radio" name="plano" value="${p}"${p === escolhido ? ' checked' : ''}>
            <span><b>${esc(planos.nomeDoPlano(p))}</b><span class="tipo">Mensal</span>
            ${condicoes(p)}
            <small>${lim(p).aparelhos} aparelhos · ${lim(p).dentistas} dentistas · ${lim(p).usuarios} usuários</small></span></label>`).join('')}
        </div>
        <h2>Sua clínica</h2>
        ${camposLogin(v)}
        <label class="campo"><span>E-mail da conta do Mercado Pago que vai pagar</span><input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="200" value="${esc(v.email || '')}" required>
          <small>Use o mesmo e-mail com que você vai entrar no Mercado Pago na próxima tela.</small></label>
        <button class="bp" type="submit">Assinar e ir para o pagamento</button>
      </form>
      <a class="btn b2" href="/assinar/minha">Já assina? Ver ou cancelar a assinatura</a>
      <p class="nota">O plano e a data de validade da clínica mudam sozinhos a cada mês pago. Os aparelhos recebem o plano novo na próxima sincronização. Se a clínica ainda tem dias de plano ou de teste, cada mês pago começa a contar depois deles. Cancelando, não há novas cobranças e os dias já pagos continuam valendo.</p>`);
  }
  function paginaMinha(v = {}, erro, aviso) {
    return moldura('Minha assinatura', `
      <h1>Minha assinatura</h1>
      <p>Entre com o código da clínica e o usuário administrador para ver ou cancelar a assinatura.</p>
      ${aviso || ''}${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
      <form method="post" action="/assinar/minha">${camposLogin(v)}<button class="bp" type="submit">Ver a assinatura</button></form>
      <a class="btn b2" href="/assinar">Voltar para os planos</a>`);
  }
  function paginaSituacao(clinica, login) {
    const a = s().prepare("SELECT * FROM ass_assinaturas WHERE clinicaId = ? AND situacao <> 'abandonada' ORDER BY (situacao IN ('ativa', 'pausada')) DESC, criadaEm DESC LIMIT 1").get(clinica.id);
    const vale = clinica.validaAte ? dataBR(clinica.validaAte) : 'sem data';
    if (!a) {
      return moldura('Minha assinatura', `<h1>Minha assinatura</h1><div class="aviso">A clínica ${esc(clinica.nome)} ainda não tem assinatura.</div>
        <dl><dt>Plano atual</dt><dd>${esc(planos.nomeDoPlano(clinica.plano))}</dd><dt>Vale até</dt><dd>${esc(vale)}</dd></dl>
        <a class="btn bp" href="/assinar?clinica=${encodeURIComponent(clinica.codigo)}">Assinar</a>`);
    }
    const cob = s().prepare('SELECT * FROM ass_cobrancas WHERE assinaturaId = ? ORDER BY criadaEm DESC LIMIT 12').all(a.id);
    const nomeSit = { ativa: 'Ativa', pausada: 'Pausada pelo Mercado Pago', cancelada: 'Cancelada', aguardando: 'Aguardando a autorização no Mercado Pago' }[a.situacao] || a.situacao;
    const valorAgora = a.cobrancas || a.centavosPrimeiro === a.centavosMes ? a.centavosMes : a.centavosPrimeiro;
    const podeCancelar = a.situacao !== 'cancelada';
    return moldura('Minha assinatura', `
      <h1>Minha assinatura</h1>
      ${a.situacao === 'cancelada' ? `<div class="aviso">Assinatura cancelada${a.canceladaEm ? ' em ' + dataBR(a.canceladaEm) : ''}. Não há novas cobranças. O plano vale até ${esc(vale)}.</div>` : ''}
      <dl><dt>Clínica</dt><dd>${esc(clinica.nome)}</dd><dt>Plano</dt><dd>${esc(planos.nomeDoPlano(a.plano))} · mensal</dd>
        <dt>Situação</dt><dd>${esc(nomeSit)}</dd><dt>${a.cobrancas ? 'Valor por mês' : 'Primeira cobrança'}</dt><dd>${reais(valorAgora)}</dd>
        ${!a.cobrancas && a.centavosPrimeiro !== a.centavosMes ? `<dt>Depois</dt><dd>${reais(a.centavosMes)} por mês</dd>` : ''}
        <dt>Plano vale até</dt><dd>${esc(vale)}</dd><dt>Meses pagos</dt><dd>${a.cobrancas}</dd></dl>
      ${cob.length ? `<h2>Cobranças</h2><div class="rolar"><table><tr><th>Data</th><th>Valor</th><th>Situação</th></tr>
        ${cob.map(c => `<tr><td>${dataBR(c.criadaEm)}</td><td>${reais(c.centavos || 0)}</td><td>${c.aplicada ? (c.status === 'approved' ? 'Paga' : 'Devolvida') : esc({ rejected: 'Recusada', pending: 'Pendente', in_process: 'Em análise', 'valor-diferente': 'Valor diferente' }[c.status] || c.status)}</td></tr>`).join('')}</table></div>` : ''}
      ${podeCancelar ? `<form method="post" action="/assinar/cancelar"><input type="hidden" name="passe" value="${novoPasse(clinica.id, login)}">
        <h2>Cancelar</h2><p>Cancelando, o Mercado Pago não cobra mais nada. Os dias já pagos continuam valendo até ${esc(vale)}.</p>
        <label class="campo" style="font-weight:400"><input type="checkbox" name="certeza" value="1" required style="width:20px;height:20px;vertical-align:-4px"> Quero cancelar a assinatura</label>
        <button class="bd" type="submit">Cancelar a assinatura</button></form>`
        : `<a class="btn bp" href="/assinar?clinica=${encodeURIComponent(clinica.codigo)}">Assinar de novo</a>`}`);
  }
  function paginaRetorno(a, clinica) {
    if (a && a.cobrancas && clinica) {
      return moldura('Assinatura feita', `<h1>Assinatura feita</h1><div class="ok">Obrigado! A clínica ${esc(clinica.nome)} está no plano ${esc(planos.nomeDoPlano(a.plano))} até ${dataBR(clinica.validaAte)}. A próxima cobrança é automática, daqui a um mês.</div>
        <p>Os aparelhos recebem o plano novo na próxima sincronização.</p><a class="btn b2" href="/assinar/minha">Ver a assinatura</a>`);
    }
    if (a && a.situacao === 'ativa') {
      return moldura('Assinatura feita', `<h1>Assinatura feita</h1><div class="ok">A assinatura foi autorizada. Assim que o Mercado Pago aprovar a primeira cobrança, o plano muda sozinho. Não precisa fazer mais nada.</div>
        <a class="btn b2" href="/assinar/minha">Ver a assinatura</a>`);
    }
    if (a && a.situacao === 'cancelada') {
      return moldura('Assinatura', `<h1>Assinatura não concluída</h1><div class="erro">Esta assinatura está cancelada. Nada será cobrado.</div><a class="btn bp" href="/assinar">Assinar de novo</a>`);
    }
    return moldura('Assinatura', `<h1>Recebemos o seu retorno</h1>
      <div class="aviso">A assinatura ainda não foi confirmada pelo Mercado Pago. Se você concluiu o pagamento, o plano muda sozinho quando a cobrança for aprovada.</div>
      <a class="btn bp" href="/assinar">Voltar para os planos</a>`);
  }

  // ---------- Conferir o administrador ----------
  function entrar(v, senha, ip) {
    const kIp = 'ip|' + ip, kCl = 'cl|' + v.clinica + '|' + v.login;
    if (bloqueado(kIp) || bloqueado(kCl)) return { erro: `Muitas tentativas erradas. Espere ${ESPERA_MIN} minutos e tente de novo.`, status: 429 };
    const clinica = clinicaPorCodigo(v.clinica);
    let u = null;
    if (clinica) { try { u = lerUsuario(bancoDaClinica(clinica.id).prepare('SELECT * FROM usuarios WHERE login = ?').get(v.login)); } catch (e) { u = null; } }
    if (!clinica || !u || !u.active || !senhaConfere(u.senha, String(senha || ''))) {
      anotarErro(kIp); anotarErro(kCl);
      return { erro: 'Código da clínica, usuário ou senha não conferem.', status: 401 };
    }
    if (u.role !== 'admin') return { erro: 'Só o administrador da clínica pode assinar, ver ou cancelar a assinatura.', status: 403 };
    erros.delete(kCl);
    return { clinica, u };
  }

  // =====================================================================
  function atender(req, res, url, ip, seguro) {
    if (!LIGADA) return pagamento().atender(req, res, url, ip, seguro);
    const html = (status, corpo) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; base-uri 'none'; frame-ancestors 'none'" });
      res.end(corpo);
    };
    const jsonr = (status, corpo) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(corpo)); };
    const lerTexto = (limite, fn) => {
      let corpo = '';
      req.on('data', p => { corpo += p; if (corpo.length > limite) req.destroy(); });
      req.on('end', () => fn(corpo));
    };
    const falha = (e, onde) => { console.error(new Date().toISOString(), onde, e); };
    const caminho = url.pathname.replace(/\/+$/, '') || '/';
    const base = ENDERECO || `${seguro ? 'https' : 'http'}://${String(req.headers.host || 'localhost').replace(/[^A-Za-z0-9.:[\]-]/g, '')}`;
    const lerLogin = f => ({ clinica: String(f.get('clinica') || '').trim().toLowerCase().slice(0, 40), login: String(f.get('login') || '').trim().toLowerCase().slice(0, 30) });

    // ---------- Avisos do Mercado Pago ----------
    if (caminho === '/api/pagamento/aviso') {
      if (req.method !== 'POST') return jsonr(405, { ok: false });
      return lerTexto(20000, async texto => {
        let corpo = {}; try { corpo = JSON.parse(texto || '{}'); } catch (e) { corpo = {}; }
        if (!assinaturaConfere(req, url, corpo)) return jsonr(401, { ok: false, erro: 'assinatura' });
        const tipo = String(corpo.type || corpo.topic || url.searchParams.get('type') || url.searchParams.get('topic') || '');
        const id = (corpo.data && corpo.data.id) || url.searchParams.get('data.id') || url.searchParams.get('id') || '';
        if (!id || !MP_TOKEN) return jsonr(200, { ok: true, ignorado: true });
        try {
          if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
            const a = await conferirAssinatura(id);
            if (a) await ajustarValor(a).catch(e => console.error(agora(), 'ajustar valor', e.message));
          } else if (tipo === 'subscription_authorized_payment' || tipo === 'authorized_payment') await cobrancaAutorizada(id);
          else if (tipo === 'payment') await pagamentoQualquer(id);
          else return jsonr(200, { ok: true, ignorado: true });
          jsonr(200, { ok: true });
        } catch (e) { falha(e, 'aviso do Mercado Pago'); jsonr(500, { ok: false }); }   // o Mercado Pago tenta de novo depois
      });
    }

    // ---------- Escolher o plano e assinar ----------
    if (caminho === '/assinar' && req.method === 'GET') {
      return html(200, paginaAssinar({ plano: url.searchParams.get('plano'), clinica: String(url.searchParams.get('clinica') || '').slice(0, 40) }));
    }
    if (caminho === '/assinar' && req.method === 'POST') {
      return lerTexto(4000, async texto => {
        const f = new URLSearchParams(texto);
        const v = Object.assign(lerLogin(f), { plano: String(f.get('plano') || ''), email: String(f.get('email') || '').trim().toLowerCase().slice(0, 200) });
        try {
          if (!configurado()) return html(503, paginaAssinar(v));
          if (!planosPagos().includes(v.plano) || !precoMes(v.plano)) return html(400, paginaAssinar(v, 'Escolha um plano.'));
          if (!emailOk(v.email)) return html(400, paginaAssinar(v, 'Escreva o e-mail da conta do Mercado Pago que vai pagar.'));
          const e = entrar(v, f.get('senha'), ip);
          if (e.erro) return html(e.status, paginaAssinar(v, e.erro));
          const { clinica, u } = e;
          const ativa = assinaturaAtiva(clinica.id);
          if (ativa) return html(409, paginaAssinar(v, `Esta clínica já tem uma assinatura ativa (plano ${planos.nomeDoPlano(ativa.plano)}). Para trocar de plano, cancele a atual em "Ver ou cancelar a assinatura" e assine de novo: os dias já pagos continuam valendo.`));
          const mes = precoMes(v.plano), promo = !jaPagou(clinica.id) && promoMes(v.plano);
          const a = { id: 'ass-' + crypto.randomBytes(12).toString('hex'), clinicaId: clinica.id, plano: v.plano, centavosMes: mes, centavosPrimeiro: promo || mes };
          // Assinaturas antigas que nunca foram autorizadas: ficam de lado (e são canceladas no Mercado Pago)
          const velhas = s().prepare("SELECT * FROM ass_assinaturas WHERE clinicaId = ? AND situacao = 'aguardando'").all(clinica.id);
          s().prepare('INSERT INTO ass_assinaturas (id, clinicaId, plano, centavosMes, centavosPrimeiro, email, criadaEm, por, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(a.id, a.clinicaId, a.plano, a.centavosMes, a.centavosPrimeiro, v.email, agora(), u.login, String(ip).slice(0, 60));
          const r = await mp('POST', '/preapproval', {
            reason: `Dente Sempre - plano ${planos.nomeDoPlano(v.plano)} (mensal) - ${clinica.nome}`.slice(0, 250),
            external_reference: a.id,
            payer_email: v.email,
            auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: a.centavosPrimeiro / 100, currency_id: 'BRL' },
            back_url: base + '/assinar/retorno',
            status: 'pending'
          }, 'ass-' + a.id);
          if (r.status >= 300 || !r.j || !r.j.init_point) {
            console.error(agora(), 'assinatura: o Mercado Pago recusou', r.status, r.j && (r.j.message || r.j.error));
            s().prepare("UPDATE ass_assinaturas SET situacao = 'abandonada', statusMp = ?, atualizadaEm = ? WHERE id = ?").run('erro-' + r.status, agora(), a.id);
            const msg = r.j && /email/i.test(String(r.j.message || '')) ? 'O Mercado Pago não aceitou este e-mail. Confira o e-mail da conta do Mercado Pago que vai pagar.' : 'Não foi possível abrir a assinatura agora. Tente de novo em alguns minutos.';
            return html(502, paginaAssinar(v, msg));
          }
          s().prepare('UPDATE ass_assinaturas SET preapprovalId = ?, statusMp = ?, atualizadaEm = ? WHERE id = ?').run(String(r.j.id || ''), String(r.j.status || 'pending'), agora(), a.id);
          velhas.forEach(x => {
            s().prepare("UPDATE ass_assinaturas SET situacao = 'abandonada', atualizadaEm = ? WHERE id = ?").run(agora(), x.id);
            if (x.preapprovalId) mp('PUT', '/preapproval/' + x.preapprovalId, { status: 'cancelled' }).catch(() => {});
          });
          res.writeHead(303, { Location: r.j.init_point }); res.end();
        } catch (e) { falha(e, 'assinar'); html(500, paginaAssinar(v, 'Não foi possível abrir a assinatura agora. Tente de novo em alguns minutos.')); }
      });
    }

    // ---------- Volta do Mercado Pago ----------
    if (caminho === '/assinar/retorno' && req.method === 'GET') {
      const pre = url.searchParams.get('preapproval_id');
      if (!pre && (url.searchParams.get('payment_id') || url.searchParams.get('collection_id'))) return pagamento().atender(req, res, url, ip, seguro);   // pagamento avulso antigo
      if (!pre || !MP_TOKEN) return html(200, paginaRetorno(null));
      return conferirAssinatura(pre).then(a => html(200, paginaRetorno(a && porId(a.id), a && clinicaPorId(a.clinicaId))),
        e => { falha(e, 'retorno da assinatura'); html(200, paginaRetorno(null)); });
    }

    // ---------- Ver e cancelar ----------
    if (caminho === '/assinar/minha' && req.method === 'GET') return html(200, paginaMinha({ clinica: String(url.searchParams.get('clinica') || '').slice(0, 40) }));
    if (caminho === '/assinar/minha' && req.method === 'POST') {
      return lerTexto(4000, texto => {
        const f = new URLSearchParams(texto), v = lerLogin(f);
        try {
          const e = entrar(v, f.get('senha'), ip);
          if (e.erro) return html(e.status, paginaMinha(v, e.erro));
          html(200, paginaSituacao(e.clinica, e.u.login));
        } catch (er) { falha(er, 'minha assinatura'); html(500, paginaMinha(v, 'Algo deu errado. Tente de novo.')); }
      });
    }
    if (caminho === '/assinar/cancelar' && req.method === 'POST') {
      return lerTexto(2000, async texto => {
        const f = new URLSearchParams(texto);
        const p = passes.get(String(f.get('passe') || ''));
        if (!p || p.ate < Date.now()) return html(403, paginaMinha({}, 'A página ficou aberta muito tempo. Entre de novo para cancelar.'));
        const clinica = clinicaPorId(p.clinicaId);
        if (f.get('certeza') !== '1') return html(400, paginaSituacao(clinica, p.login));
        passes.delete(String(f.get('passe')));
        try {
          const lista = s().prepare("SELECT * FROM ass_assinaturas WHERE clinicaId = ? AND situacao IN ('ativa', 'pausada', 'aguardando')").all(clinica.id);
          for (const a of lista) {
            if (a.preapprovalId) {
              const r = await mp('PUT', '/preapproval/' + a.preapprovalId, { status: 'cancelled' });
              if (r.status >= 300 && r.status !== 404) {
                console.error(agora(), `assinatura ${a.id}: o Mercado Pago não cancelou (${r.status})`);
                return html(502, paginaMinha({ clinica: clinica.codigo }, 'O Mercado Pago não respondeu agora. Nada foi mudado. Tente de novo em alguns minutos.'));
              }
            }
            s().prepare("UPDATE ass_assinaturas SET situacao = 'cancelada', statusMp = 'cancelled', canceladaEm = ?, canceladaPor = ?, atualizadaEm = ? WHERE id = ?").run(agora(), p.login, agora(), a.id);
          }
          console.log(agora(), `assinatura da clínica ${clinica.codigo} cancelada por ${p.login}`);
          html(200, paginaSituacao(clinicaPorId(clinica.id), p.login));
        } catch (e) { falha(e, 'cancelar assinatura'); html(500, paginaMinha({ clinica: clinica.codigo }, 'Não foi possível cancelar agora. Tente de novo em alguns minutos.')); }
      });
    }
    if (caminho.startsWith('/assinar')) return html(404, moldura('Não encontrado', '<h1>Página não encontrada</h1><a class="btn b2" href="/assinar">Ir para a assinatura</a>'));
    return pagamento().atender(req, res, url, ip, seguro);
  }

  // ---------- Contato direto pelo WhatsApp para pagar via Pix (31/10) ----------
  // SUPORTE_WHATSAPP: número do suporte, com DDD (ex.: 11 91234-5678). Vazio = o botão não aparece e tudo fica como antes.
  // O botão fica abaixo de "Assinar e ir para o pagamento" e leva o plano marcado e o código da clínica para a mensagem.
  // A página não usa JavaScript: o botão envia o formulário para /assinar/whatsapp, que lê SÓ o plano e o código
  // (a senha e o e-mail são ignorados e não vão para lugar nenhum) e abre o WhatsApp com a mensagem pronta.
  // Só acrescenta: a página e o atendimento originais são chamados sem mudança.
  const numeroSuporte = () => {
    let n = String(process.env.SUPORTE_WHATSAPP || '').replace(/\D/g, '');
    if (n.length === 10 || n.length === 11) n = '55' + n;   // número do Brasil sem o 55
    return n.length >= 12 && n.length <= 15 ? n : '';
  };
  const linkWhatsApp = (plano, codigo) => {
    const nome = planosPagos().includes(plano) ? planos.nomeDoPlano(plano) : '';
    const cod = String(codigo || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
    const texto = `Olá! Quero assinar ${nome ? 'o plano ' + nome : 'um plano'} da Agenda Dente Sempre.` + (cod ? ` Código da clínica: ${cod}.` : '');
    return `https://wa.me/${numeroSuporte()}?text=${encodeURIComponent(texto)}`;
  };
  const BOTAO_WA = 'background:#1f8f4e;color:#fff;border:0';
  const _paginaAssinarSemContato = paginaAssinar;
  paginaAssinar = function (v = {}, erro) {
    const h = _paginaAssinarSemContato(v, erro);
    if (!numeroSuporte()) return h;
    const enviar = '<button class="bp" type="submit">Assinar e ir para o pagamento</button>';
    if (h.includes(enviar)) {
      return h.replace(enviar, enviar + `
        <button class="btn" type="submit" formaction="/assinar/whatsapp" formmethod="post" formnovalidate style="${BOTAO_WA}">Falar com o suporte para pagar via Pix</button>
        <p class="nota" style="margin-top:6px">Prefere pagar por Pix? O botão verde abre o WhatsApp do suporte com o plano marcado e o código da clínica.</p>`);
    }
    // Página sem o Mercado Pago configurado: o contato também aparece
    return h.replace('</section>', `<a class="btn" style="${BOTAO_WA}" href="${esc(linkWhatsApp(v.plano, v.clinica))}" rel="noopener">Falar com o suporte para pagar via Pix</a></section>`);
  };
  const _atenderSemContato = atender;
  atender = function (req, res, url, ip, seguro) {
    const caminho = url.pathname.replace(/\/+$/, '');
    if (!LIGADA || caminho !== '/assinar/whatsapp') return _atenderSemContato(req, res, url, ip, seguro);
    const vaiPara = (plano, codigo) => {
      if (!numeroSuporte()) { res.writeHead(303, { Location: '/assinar', 'Cache-Control': 'no-store' }); return res.end(); }
      res.writeHead(303, { Location: linkWhatsApp(plano, codigo), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end();
    };
    if (req.method === 'GET') return vaiPara(url.searchParams.get('plano'), url.searchParams.get('clinica'));
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    let corpo = '';
    req.on('data', p => { corpo += p; if (corpo.length > 4000) req.destroy(); });
    req.on('end', () => { const f = new URLSearchParams(corpo); vaiPara(String(f.get('plano') || ''), String(f.get('clinica') || '')); });
  };

  const listar = clinicaId => s().prepare('SELECT * FROM ass_assinaturas WHERE clinicaId = ? ORDER BY criadaEm DESC').all(clinicaId);
  return { atender, conferirAssinatura, cobrancaAutorizada, listar, configurado };
}

module.exports = { criarAssinatura };
