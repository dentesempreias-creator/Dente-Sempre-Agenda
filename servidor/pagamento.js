'use strict';
// =====================================================================
//  Dente Sempre — PAGAMENTO (Mercado Pago, Checkout Pro)
//
//  Endereços:
//    GET  /assinar            → página para o administrador da clínica escolher o plano e pagar
//    POST /assinar            → confere código + usuário + senha do ADMINISTRADOR da clínica,
//                               cria o pedido e leva para a página de pagamento do Mercado Pago
//    GET  /assinar/retorno    → para onde o Mercado Pago devolve a pessoa depois de pagar
//    POST /api/pagamento/aviso → aviso automático do Mercado Pago (webhook)
//
//  Como o plano muda:
//    O Mercado Pago avisa que um pagamento mudou. O servidor NÃO confia no aviso:
//    ele pergunta ao próprio Mercado Pago (com o token secreto) como está aquele
//    pagamento. Só se estiver "aprovado", no valor certo e em reais, chama
//    planos.aoConfirmarPagamento() e grava o plano e a data nova da clínica.
//    Cada pagamento é usado uma vez só (avisos repetidos não somam meses de novo).
//
//  Configuração (variáveis de ambiente):
//    MP_ACCESS_TOKEN       token de produção do Mercado Pago (começa com APP_USR-)
//    MP_WEBHOOK_SEGREDO    "assinatura secreta" dos webhooks (opcional, recomendado)
//    ENDERECO_PUBLICO      endereço do servidor na internet, ex.: https://api.seudominio.com.br
//    PRECO_BASICO          preço por mês do Básico, ex.: 99,90
//    PRECO_PROFISSIONAL    preço por mês do Profissional, ex.: 199,90
//    PAGAMENTO_MESES       opções de período, ex.: 1,3,6,12 (padrão)
// =====================================================================
const crypto = require('node:crypto');

const MP_TOKEN = String(process.env.MP_ACCESS_TOKEN || '').trim();
const MP_SEGREDO = String(process.env.MP_WEBHOOK_SEGREDO || '').trim();
const MP_API = String(process.env.MP_API_URL || 'https://api.mercadopago.com').replace(/\/+$/, '');   // MP_API_URL só para teste
const ENDERECO = String(process.env.ENDERECO_PUBLICO || '').replace(/\/+$/, '');
const MESES = String(process.env.PAGAMENTO_MESES || '1,3,6,12').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 36);
const ERROS = 5, ESPERA_MIN = 15;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pag_pedidos (id TEXT PRIMARY KEY, clinicaId TEXT NOT NULL, plano TEXT NOT NULL, meses INTEGER NOT NULL,
  centavos INTEGER NOT NULL, criadoEm TEXT NOT NULL, por TEXT, ip TEXT, preferencia TEXT,
  situacao TEXT NOT NULL DEFAULT 'aguardando', pagamentoId TEXT, statusMp TEXT, atualizadoEm TEXT,
  aplicadoEm TEXT, planoAntes TEXT, validaAteAntes TEXT, validaAteDepois TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS pag_pedidos_pagamento ON pag_pedidos (pagamentoId);
CREATE INDEX IF NOT EXISTS pag_pedidos_clinica ON pag_pedidos (clinicaId, criadoEm);`;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reais = centavos => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const mesesTxt = n => n === 1 ? '1 mês' : n + ' meses';
// "99,90" ou "99.90" → 9990 centavos
function centavosDe(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function criarPagamento(ctx) {
  const { sistema, clinicaPorId, clinicaPorCodigo, bancoDaClinica, emTransacao, planos, agora, lerUsuario, senhaConfere } = ctx;
  let preparado = false;
  const s = () => { const db = sistema(); if (!preparado) { db.exec(SCHEMA); preparado = true; } return db; };

  // Planos que dá para pagar (todos menos o teste) e o preço por mês de cada um
  const planosPagos = () => Object.keys(planos.PLANOS).filter(k => k !== 'teste');
  const precoMes = plano => centavosDe(process.env['PRECO_' + plano.toUpperCase()]) || centavosDe(planos.PLANOS[plano] && planos.PLANOS[plano].preco);
  const configurado = () => !!MP_TOKEN && planosPagos().some(p => precoMes(p));

  // ---------- Limite de tentativas de senha ----------
  const erros = new Map();
  const bloqueado = k => { const t = erros.get(k); return !!(t && t.ate > Date.now()); };
  function anotarErro(k) {
    const t = erros.get(k) || { n: 0, ate: 0 };
    t.n++; if (t.n >= ERROS) { t.ate = Date.now() + ESPERA_MIN * 60000; t.n = 0; }
    erros.set(k, t); if (erros.size > 20000) erros.clear();
  }

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
  async function criarPreferencia(pedido, clinica, base) {
    const nome = planos.nomeDoPlano(pedido.plano);
    const r = await mp('POST', '/checkout/preferences', {
      items: [{ id: pedido.plano, title: `Dente Sempre - plano ${nome} (${mesesTxt(pedido.meses)})`, description: `Clínica ${clinica.nome} (${clinica.codigo})`,
        quantity: 1, currency_id: 'BRL', unit_price: pedido.centavos / 100 }],
      external_reference: pedido.id,
      metadata: { clinica: clinica.codigo, plano: pedido.plano, meses: pedido.meses },
      notification_url: base + '/api/pagamento/aviso?source_news=webhooks',
      back_urls: { success: base + '/assinar/retorno', pending: base + '/assinar/retorno', failure: base + '/assinar/retorno' },
      auto_return: 'approved',
      statement_descriptor: 'DENTESEMPRE'
    }, 'pref-' + pedido.id);
    if (r.status >= 300 || !r.j || !(r.j.init_point || r.j.sandbox_init_point)) {
      console.error(agora(), 'pagamento: o Mercado Pago recusou o pedido', r.status, r.j && (r.j.message || r.j.error));
      return null;
    }
    s().prepare('UPDATE pag_pedidos SET preferencia = ?, atualizadoEm = ? WHERE id = ?').run(String(r.j.id || ''), agora(), pedido.id);
    return r.j.init_point || r.j.sandbox_init_point;
  }

  // Pergunta ao Mercado Pago como está o pagamento e, se aprovado, muda o plano. Pode ser chamado várias vezes.
  // → { pedido, clinica, aplicado, situacao } ou null (pagamento que não é nosso)
  async function conferirPagamento(pagamentoId) {
    const id = String(pagamentoId || '').replace(/\D/g, '').slice(0, 30);
    if (!id) return null;
    const r = await mp('GET', '/v1/payments/' + id);
    if (r.status === 404) return null;
    if (r.status >= 300 || !r.j) throw new Error('Mercado Pago respondeu ' + r.status);
    const p = r.j;
    const db = s();
    const pedido = db.prepare('SELECT * FROM pag_pedidos WHERE id = ?').get(String(p.external_reference || ''));
    if (!pedido) return null;
    const status = String(p.status || '');
    const valorOk = String(p.currency_id || '') === 'BRL' && Math.round(Number(p.transaction_amount) * 100) === pedido.centavos;
    let aplicado = false;
    emTransacao(db, () => {
      const atual = db.prepare('SELECT * FROM pag_pedidos WHERE id = ?').get(pedido.id);
      const outro = db.prepare('SELECT id FROM pag_pedidos WHERE pagamentoId = ? AND id <> ?').get(String(p.id), pedido.id);
      if (outro) return;   // [SEGURANÇA] o mesmo pagamento não vale para dois pedidos
      if (atual.situacao === 'pago' || atual.situacao === 'devolvido') {
        // Já aplicado: só anota se depois ele foi devolvido ou contestado (o plano NÃO volta sozinho; o painel mostra)
        if (atual.pagamentoId === String(p.id) && ['refunded', 'charged_back'].includes(status)) {
          db.prepare("UPDATE pag_pedidos SET situacao = 'devolvido', statusMp = ?, atualizadoEm = ? WHERE id = ?").run(status, agora(), atual.id);
        }
        return;
      }
      if (status === 'approved' && valorOk) {
        const clinica = clinicaPorId(atual.clinicaId);
        if (!clinica) return;
        const novo = planos.aoConfirmarPagamento(clinica, { plano: atual.plano, meses: atual.meses });
        db.prepare('UPDATE clinicas SET plano = ?, situacao = ?, validaAte = ? WHERE id = ?').run(novo.plano, novo.situacao, novo.validaAte, clinica.id);
        db.prepare("UPDATE pag_pedidos SET situacao = 'pago', pagamentoId = ?, statusMp = ?, atualizadoEm = ?, aplicadoEm = ?, planoAntes = ?, validaAteAntes = ?, validaAteDepois = ? WHERE id = ?")
          .run(String(p.id), status, agora(), agora(), clinica.plano, clinica.validaAte, novo.validaAte, atual.id);
        aplicado = true;
        return;
      }
      const sit = status === 'approved' ? 'valor-diferente'
        : ['rejected', 'cancelled'].includes(status) ? 'recusado'
        : ['refunded', 'charged_back'].includes(status) ? 'devolvido' : 'pendente';
      db.prepare('UPDATE pag_pedidos SET situacao = ?, pagamentoId = COALESCE(pagamentoId, ?), statusMp = ?, atualizadoEm = ? WHERE id = ?').run(sit, String(p.id), status, agora(), atual.id);
      if (sit === 'valor-diferente') console.error(agora(), `pagamento ${p.id}: aprovado com valor ${p.transaction_amount} ${p.currency_id}, esperado ${pedido.centavos / 100} BRL. O plano NÃO foi mudado.`);
    });
    const final = db.prepare('SELECT * FROM pag_pedidos WHERE id = ?').get(pedido.id);
    if (aplicado) console.log(agora(), `pagamento ${p.id} aprovado: clínica ${final.clinicaId} no plano ${final.plano} até ${final.validaAteDepois}`);
    return { pedido: final, clinica: clinicaPorId(final.clinicaId), aplicado, situacao: final.situacao };
  }

  // [SEGURANÇA] confere a assinatura do aviso (x-signature), quando MP_WEBHOOK_SEGREDO estiver configurado
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
    const a = Buffer.from(esperado), b = Buffer.from(String(partes.v1));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  .plano b{font-size:19px} .plano .preco{font-weight:700;color:#1e5bb8} .plano small{display:block;color:#5a6577;font-size:15px}
  label.campo{display:block;font-weight:600;margin:0 0 14px} label.campo span{display:block;font-size:15px;margin-bottom:4px}
  input[type=text],input[type=password],select{width:100%;font:inherit;font-size:18px;padding:11px 13px;border:1px solid #b9c2ce;border-radius:8px;min-height:50px;background:#fff}
  input:focus,select:focus{outline:2px solid #1e5bb8;outline-offset:1px}
  table{width:100%;border-collapse:collapse;font-size:15px;margin:0 0 8px} th,td{padding:7px 8px;border-bottom:1px solid #e6eaf0;text-align:left} th{color:#5a6577;font-weight:600}
  td.v{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap} th.v{text-align:right;white-space:nowrap}
  .rolar{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 8px}
  button,.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:54px;border-radius:10px;font:inherit;font-weight:700;font-size:18px;cursor:pointer;text-decoration:none;border:0;margin:8px 0 0}
  .bp{background:#1e5bb8;color:#fff} .b2{background:#fff;border:1px solid #b9c2ce;color:#18212f}
  .ok,.erro,.aviso{border-radius:10px;padding:12px 14px;margin:0 0 16px;font-weight:600}
  .ok{background:#e4f3e9;color:#1c6a3c;border:1px solid #b6e0c5} .erro{background:#fbeeee;color:#962c2c;border:1px solid #f0b9b9}
  .aviso{background:#fff4d6;color:#5c4300;border:1px solid #efd58c}
  .nota{font-size:14px;color:#6b7584;margin-top:18px}
</style></head><body><main><header><small>Assinatura</small><b>Dente Sempre</b></header><section>${corpo}</section></main></body></html>`;
  }
  function paginaAssinar(v = {}, erro) {
    if (!configurado()) {
      return moldura('Assinar', `<h1>Assinar o Dente Sempre</h1><div class="aviso">O pagamento pela internet ainda não está disponível. Fale com o suporte do Dente Sempre para escolher o seu plano.</div>`);
    }
    const lista = planosPagos().filter(p => precoMes(p));
    const escolhido = lista.includes(v.plano) ? v.plano : lista[0];
    const meses = MESES.includes(Number(v.meses)) ? Number(v.meses) : MESES[0];
    const lim = p => planos.PLANOS[p];
    return moldura('Assinar', `
      <h1>Assinar o Dente Sempre</h1>
      <p>Escolha o plano e o período. Depois, entre com o <b>código da clínica</b> e o usuário <b>administrador</b> (o mesmo do programa). O pagamento é feito no Mercado Pago, com Pix, cartão ou boleto.</p>
      ${erro ? `<div class="erro">${esc(erro)}</div>` : ''}
      <form method="post" action="/assinar">
        <h2>Plano</h2>
        <div class="planos">
          ${lista.map(p => `<label class="plano"><input type="radio" name="plano" value="${p}"${p === escolhido ? ' checked' : ''}>
            <span><b>${esc(planos.nomeDoPlano(p))}</b> · <span class="preco">${reais(precoMes(p))} por mês</span>
            <small>${lim(p).aparelhos} aparelhos · ${lim(p).dentistas} dentistas · ${lim(p).usuarios} usuários</small></span></label>`).join('')}
        </div>
        <h2>Período</h2>
        <label class="campo"><span>Pagar por</span><select name="meses">${MESES.map(m => `<option value="${m}"${m === meses ? ' selected' : ''}>${mesesTxt(m)}</option>`).join('')}</select></label>
        <div class="rolar"><table><tr><th>Plano</th>${MESES.map(m => `<th class="v">${mesesTxt(m)}</th>`).join('')}</tr>
          ${lista.map(p => `<tr><td>${esc(planos.nomeDoPlano(p))}</td>${MESES.map(m => `<td class="v">${reais(precoMes(p) * m)}</td>`).join('')}</tr>`).join('')}</table></div>
        <h2>Sua clínica</h2>
        <label class="campo"><span>Código da clínica</span><input type="text" name="clinica" autocomplete="organization" autocapitalize="none" spellcheck="false" maxlength="40" value="${esc(v.clinica || '')}" required></label>
        <label class="campo"><span>Usuário do administrador</span><input type="text" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" value="${esc(v.login || '')}" required></label>
        <label class="campo"><span>Senha</span><input type="password" name="senha" autocomplete="current-password" maxlength="100" required></label>
        <button class="bp" type="submit">Ir para o pagamento</button>
      </form>
      <p class="nota">Quando o pagamento for aprovado, o plano e a data de validade da clínica mudam sozinhos. Os aparelhos recebem o plano novo na próxima sincronização. Se a clínica ainda tem dias de plano ou de teste, os meses pagos começam a contar depois deles.</p>`);
  }
  function paginaRetorno(r, statusUrl) {
    if (r && r.situacao === 'pago') {
      return moldura('Pagamento aprovado', `<h1>Pagamento aprovado</h1>
        <div class="ok">Obrigado! A clínica ${esc(r.clinica ? r.clinica.nome : '')} está no plano ${esc(planos.nomeDoPlano(r.pedido.plano))} até ${dataBR(r.pedido.validaAteDepois)}.</div>
        <p>Os aparelhos recebem o plano novo na próxima sincronização. Se algum estava bloqueado, é só abrir o programa com internet.</p>`);
    }
    if ((r && r.situacao === 'pendente') || statusUrl === 'pending' || statusUrl === 'in_process') {
      return moldura('Pagamento em análise', `<h1>Pagamento em análise</h1>
        <div class="aviso">O pagamento ainda não foi confirmado (por exemplo, boleto ou Pix ainda não pago). Assim que o Mercado Pago confirmar, o plano muda sozinho. Não precisa fazer mais nada.</div>`);
    }
    if ((r && r.situacao === 'recusado') || statusUrl === 'rejected' || statusUrl === 'failure' || statusUrl === 'null') {
      return moldura('Pagamento não aprovado', `<h1>Pagamento não aprovado</h1>
        <div class="erro">O pagamento não foi aprovado. Nada foi cobrado. Você pode tentar de novo com outra forma de pagamento.</div>
        <a class="btn bp" href="/assinar">Tentar de novo</a>`);
    }
    return moldura('Pagamento', `<h1>Recebemos o seu retorno</h1>
      <div class="aviso">Ainda não temos a confirmação deste pagamento. Assim que o Mercado Pago confirmar, o plano muda sozinho.</div>`);
  }

  // =====================================================================
  //  Atender /assinar, /assinar/retorno e /api/pagamento/aviso
  // =====================================================================
  function atender(req, res, url, ip, seguro) {
    const html = (status, corpo) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow',
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

    // ---------- Aviso do Mercado Pago ----------
    if (caminho === '/api/pagamento/aviso') {
      if (req.method !== 'POST') return jsonr(405, { ok: false });
      return lerTexto(20000, async texto => {
        let corpo = {}; try { corpo = JSON.parse(texto || '{}'); } catch (e) { corpo = {}; }
        if (!assinaturaConfere(req, url, corpo)) return jsonr(401, { ok: false, erro: 'assinatura' });
        const tipo = String(corpo.type || corpo.topic || url.searchParams.get('type') || url.searchParams.get('topic') || '');
        const id = (corpo.data && corpo.data.id) || url.searchParams.get('data.id') || (tipo === 'payment' ? url.searchParams.get('id') : '');
        if (tipo !== 'payment' || !id || !MP_TOKEN) return jsonr(200, { ok: true, ignorado: true });
        try { await conferirPagamento(id); jsonr(200, { ok: true }); }
        catch (e) { falha(e, 'aviso do Mercado Pago'); jsonr(500, { ok: false }); }   // o Mercado Pago tenta de novo depois
      });
    }

    // ---------- Página de escolha ----------
    if (caminho === '/assinar' && req.method === 'GET') {
      return html(200, paginaAssinar({ plano: url.searchParams.get('plano'), meses: url.searchParams.get('meses'), clinica: String(url.searchParams.get('clinica') || '').slice(0, 40) }));
    }
    if (caminho === '/assinar' && req.method === 'POST') {
      return lerTexto(4000, async texto => {
        const f = new URLSearchParams(texto);
        const v = { plano: String(f.get('plano') || ''), meses: Number(f.get('meses')), clinica: String(f.get('clinica') || '').trim().toLowerCase().slice(0, 40), login: String(f.get('login') || '').trim().toLowerCase().slice(0, 30) };
        try {
          if (!configurado()) return html(503, paginaAssinar(v));
          if (!planosPagos().includes(v.plano) || !precoMes(v.plano)) return html(400, paginaAssinar(v, 'Escolha um plano.'));
          if (!MESES.includes(v.meses)) return html(400, paginaAssinar(v, 'Escolha o período.'));
          const kIp = 'ip|' + ip, kCl = 'cl|' + v.clinica + '|' + v.login;
          if (bloqueado(kIp) || bloqueado(kCl)) return html(429, paginaAssinar(v, `Muitas tentativas erradas. Espere ${ESPERA_MIN} minutos e tente de novo.`));
          const clinica = clinicaPorCodigo(v.clinica);
          let u = null;
          if (clinica) { try { u = lerUsuario(bancoDaClinica(clinica.id).prepare('SELECT * FROM usuarios WHERE login = ?').get(v.login)); } catch (e) { u = null; } }
          if (!clinica || !u || !u.active || !senhaConfere(u.senha, String(f.get('senha') || ''))) {
            anotarErro(kIp); anotarErro(kCl);
            return html(401, paginaAssinar(v, 'Código da clínica, usuário ou senha não conferem.'));
          }
          if (u.role !== 'admin') return html(403, paginaAssinar(v, 'Só o administrador da clínica pode assinar ou renovar o plano.'));
          erros.delete(kCl);
          const pedido = { id: 'ped-' + crypto.randomBytes(12).toString('hex'), clinicaId: clinica.id, plano: v.plano, meses: v.meses, centavos: precoMes(v.plano) * v.meses };
          s().prepare('INSERT INTO pag_pedidos (id, clinicaId, plano, meses, centavos, criadoEm, por, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(pedido.id, pedido.clinicaId, pedido.plano, pedido.meses, pedido.centavos, agora(), u.login, String(ip).slice(0, 60));
          const destino = await criarPreferencia(pedido, clinica, base);
          if (!destino) return html(502, paginaAssinar(v, 'Não foi possível abrir o pagamento agora. Tente de novo em alguns minutos.'));
          res.writeHead(303, { Location: destino }); res.end();
        } catch (e) { falha(e, 'assinar'); html(500, paginaAssinar(v, 'Não foi possível abrir o pagamento agora. Tente de novo em alguns minutos.')); }
      });
    }

    // ---------- Volta do Mercado Pago ----------
    if (caminho === '/assinar/retorno' && req.method === 'GET') {
      const pid = url.searchParams.get('payment_id') || url.searchParams.get('collection_id');
      const st = String(url.searchParams.get('status') || url.searchParams.get('collection_status') || '');
      if (!pid || pid === 'null' || !MP_TOKEN) return html(200, paginaRetorno(null, st));
      return conferirPagamento(pid).then(r => html(200, paginaRetorno(r, st)), e => { falha(e, 'retorno do pagamento'); html(200, paginaRetorno(null, st)); });
    }
    return html(404, moldura('Não encontrado', '<h1>Página não encontrada</h1><a class="btn b2" href="/assinar">Ir para a assinatura</a>'));
  }

  // Para o painel de administração
  function listarPedidos(clinicaId, limite) {
    const db = s();
    return clinicaId
      ? db.prepare('SELECT * FROM pag_pedidos WHERE clinicaId = ? ORDER BY criadoEm DESC LIMIT ?').all(clinicaId, limite || 50)
      : db.prepare('SELECT * FROM pag_pedidos ORDER BY criadoEm DESC LIMIT ?').all(limite || 200);
  }
  const situacaoConfig = () => ({ token: !!MP_TOKEN, segredo: !!MP_SEGREDO, endereco: ENDERECO, precos: Object.fromEntries(planosPagos().map(p => [p, precoMes(p)])), meses: MESES });

  return { atender, conferirPagamento, listarPedidos, situacaoConfig, configurado };
}

module.exports = { criarPagamento, centavosDe };
