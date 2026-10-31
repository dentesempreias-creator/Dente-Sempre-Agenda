'use strict';
// =====================================================================
//  Dente Sempre — PAINEL DE ADMINISTRAÇÃO  (endereço: /painel)
//
//  Só para o dono do Dente Sempre. Faz pelo navegador o mesmo que os
//  comandos "dente-sempre ...":
//    - lista das clínicas, com plano, situação, validade e aparelhos;
//    - criar clínica (mostra código, usuário, senha provisória e chave);
//    - suspender / reativar;
//    - mudar plano e validade;
//    - ver os aparelhos ativados (e desativar ou liberar um aparelho);
//    - gerar chave de ativação nova;
//    - senha provisória nova para o administrador da clínica;
//    - pagamentos recebidos pelo Mercado Pago.
//
//  Segurança:
//   - desligado enquanto PAINEL_SENHA não existir (mínimo 12 caracteres);
//   - 5 senhas erradas do mesmo endereço → espera 15 minutos; 30 erros no
//     total em 15 minutos → o painel inteiro espera (contra quem tenta de vários endereços);
//   - sessão num cookie HttpOnly, SameSite=Strict, só para /painel, que
//     acaba depois de PAINEL_SESSAO_HORAS sem uso ou se a senha mudar;
//   - todo formulário leva uma senha da sessão (contra CSRF);
//   - a página não tem JavaScript e não pode ser aberta dentro de outro site.
// =====================================================================
const crypto = require('node:crypto');

const SENHA = String(process.env.PAINEL_SENHA || '');
const SESSAO_HORAS = Number(process.env.PAINEL_SESSAO_HORAS || 12);
const COOKIE = 'ds_painel';
const ERROS_IP = 5, ERROS_TOTAL = 30, ESPERA_MIN = 15;

const SCHEMA = `CREATE TABLE IF NOT EXISTS painel_sessoes (resumo TEXT PRIMARY KEY, senha TEXT NOT NULL, criadaEm TEXT NOT NULL, vistoEm TEXT NOT NULL, ip TEXT);`;

const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBR = iso => { if (!iso) return '—'; const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const horaBR = iso => iso ? dataBR(iso) + ' ' + String(iso).slice(11, 16) : '—';
const reais = c => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const marcaSenha = () => sha('dente-sempre-painel-senha|' + SENHA);
const senhaForm = token => sha('dente-sempre-painel-form|' + token).slice(0, 32);

function criarPainel(ctx) {
  const { sistema, bancoDaClinica, clinicaPorId, clinicaPorCodigo, listarClinicas, criarClinica, novaChaveDaClinica,
    novaSenha, senhaProvisoria, contarDentistasAtivos, planos, agora, pagamento } = ctx;
  let preparado = false;
  const s = () => { const db = sistema(); if (!preparado) { db.exec(SCHEMA); preparado = true; } return db; };
  const ligado = () => SENHA.length >= 12;

  // ---------- Tentativas ----------
  const erros = new Map();
  let total = { n: 0, desde: Date.now(), ate: 0 };
  function bloqueado(ip) {
    if (total.ate > Date.now()) return true;
    const t = erros.get(ip); return !!(t && t.ate > Date.now());
  }
  function anotarErro(ip) {
    const t = erros.get(ip) || { n: 0, ate: 0 };
    t.n++; if (t.n >= ERROS_IP) { t.ate = Date.now() + ESPERA_MIN * 60000; t.n = 0; }
    erros.set(ip, t); if (erros.size > 20000) erros.clear();
    if (Date.now() - total.desde > ESPERA_MIN * 60000) total = { n: 0, desde: Date.now(), ate: 0 };
    if (++total.n >= ERROS_TOTAL) { total.ate = Date.now() + ESPERA_MIN * 60000; total.n = 0; total.desde = Date.now(); }
  }
  function senhaConfere(digitada) {
    const a = Buffer.from(sha('x|' + String(digitada || ''))), b = Buffer.from(sha('x|' + SENHA));
    return crypto.timingSafeEqual(a, b);
  }

  // ---------- Sessão ----------
  function sessao(token) {
    if (!token) return null;
    const db = s(), h = sha('dente-sempre-painel-sessao|' + token);
    const r = db.prepare('SELECT * FROM painel_sessoes WHERE resumo = ?').get(h);
    if (!r) return null;
    if (r.senha !== marcaSenha() || Date.now() - Date.parse(r.vistoEm) > SESSAO_HORAS * 3600000) {
      db.prepare('DELETE FROM painel_sessoes WHERE resumo = ?').run(h); return null;
    }
    if (Date.now() - Date.parse(r.vistoEm) > 60000) db.prepare('UPDATE painel_sessoes SET vistoEm = ? WHERE resumo = ?').run(agora(), h);
    return { h, form: senhaForm(token) };
  }
  function novaSessao(ip) {
    const token = crypto.randomBytes(32).toString('base64url');
    const db = s();
    db.prepare('DELETE FROM painel_sessoes WHERE vistoEm < ?').run(new Date(Date.now() - SESSAO_HORAS * 3600000).toISOString());
    db.prepare('INSERT INTO painel_sessoes (resumo, senha, criadaEm, vistoEm, ip) VALUES (?, ?, ?, ?, ?)').run(sha('dente-sempre-painel-sessao|' + token), marcaSenha(), agora(), agora(), String(ip).slice(0, 60));
    return token;
  }

  // ---------- Dados ----------
  const nAparelhos = id => sistema().prepare('SELECT COUNT(*) n FROM aparelhos WHERE clinicaId = ? AND revogado = 0').get(id).n;
  function contagens(c) {
    const r = { usuarios: '—', dentistas: '—' };
    try { const d = bancoDaClinica(c.id); r.usuarios = d.prepare('SELECT COUNT(*) n FROM usuarios WHERE active = 1').get().n; r.dentistas = contarDentistasAtivos(d); } catch (e) { /* arquivo da clínica ausente */ }
    return r;
  }
  const situacaoTxt = c => {
    const st = planos.situacao(c);
    const nome = { teste: 'Teste', ativa: 'Ativa', suspensa: 'Suspensa', cancelada: 'Cancelada' }[c.situacao] || c.situacao;
    if (st.ok) return `<span class="tag ok">${nome}</span>`;
    return `<span class="tag mal">${c.situacao === 'suspensa' || c.situacao === 'cancelada' ? nome : nome + ' · vencida'}</span>`;
  };
  const PAG_SIT = { aguardando: 'Aguardando', pendente: 'Em análise', pago: 'Pago', recusado: 'Recusado', devolvido: 'Devolvido / contestado', 'valor-diferente': 'Valor diferente (não aplicado)' };

  // ---------- Páginas ----------
  function moldura(titulo, corpo, info) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)} · Painel Dente Sempre</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#eef2f7;color:#18212f;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  header{background:#1b4f9f;color:#fff;border-bottom:4px solid #0f8fa6}
  header .in{max-width:1180px;margin:0 auto;padding:12px 18px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  header b{font-size:19px} header nav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto;align-items:center}
  header nav a{color:#fff;text-decoration:none;font-weight:600;padding:7px 11px;border-radius:7px} header nav a:hover,header nav a.on{background:rgba(255,255,255,.16)}
  header form{margin:0} header button{background:none;border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:7px;padding:6px 11px;font:inherit;font-weight:600;cursor:pointer}
  main{max-width:1180px;margin:0 auto;padding:22px 18px 40px}
  h1{font-size:24px;margin:0 0 4px} h2{font-size:18px;margin:0 0 12px} p{margin:0 0 12px;color:#4a5568}
  .caixa{background:#fff;border:1px solid #dfe5ec;border-radius:12px;padding:18px;margin:0 0 18px}
  .rolar{overflow-x:auto} table{width:100%;border-collapse:collapse;font-size:15px} th,td{padding:9px 10px;border-bottom:1px solid #e9edf2;text-align:left;vertical-align:top}
  th{color:#5a6577;font-weight:600;white-space:nowrap;font-size:14px} tr:last-child td{border-bottom:0} td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td a{color:#1e5bb8;font-weight:600} .mono{font-family:Consolas,ui-monospace,monospace;font-size:14px;word-break:break-all}
  .tag{display:inline-block;font-size:13px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap} .ok{background:#e4f3e9;color:#1c6a3c} .mal{background:#fbeeee;color:#962c2c} .neutro{background:#eef1f5;color:#4a5568} .esp{background:#fff4d6;color:#5c4300}
  .topo{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 16px}
  .numeros{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 18px} .numeros div{background:#fff;border:1px solid #dfe5ec;border-radius:12px;padding:12px 16px;min-width:140px} .numeros b{display:block;font-size:24px}
  .numeros span{color:#5a6577;font-size:14px}
  label{display:block;font-weight:600;font-size:14px;margin:0 0 12px} label span{display:block;margin-bottom:4px}
  input,select,textarea{width:100%;font:inherit;padding:9px 11px;border:1px solid #b9c2ce;border-radius:8px;background:#fff;min-height:42px} textarea{font-family:Consolas,ui-monospace,monospace;font-size:14px}
  input:focus,select:focus,textarea:focus{outline:2px solid #1e5bb8;outline-offset:1px}
  .linha{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0 12px}
  .bt{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border-radius:8px;font:inherit;font-weight:700;font-size:15px;cursor:pointer;border:1px solid #b9c2ce;background:#fff;color:#18212f;text-decoration:none;white-space:nowrap}
  .bp{background:#1e5bb8;border-color:#174a96;color:#fff} .bd{border-color:#c23b3b;color:#962c2c} .bg{background:#2b8a52;border-color:#22723f;color:#fff}
  .acoes{display:flex;gap:8px;flex-wrap:wrap;align-items:center} .acoes form{margin:0}
  .msg{border-radius:10px;padding:12px 14px;margin:0 0 16px;font-weight:600} .msg.ok{border:1px solid #b6e0c5} .msg.mal{border:1px solid #f0b9b9} .msg.esp{border:1px solid #efd58c}
  dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0} dt{color:#5a6577} dd{margin:0;font-weight:600}
  .busca{display:flex;gap:8px} .busca input{max-width:320px}
  .entrar{max-width:380px;margin:60px auto}
  .muted{color:#6b7584;font-size:14px;font-weight:400}
</style></head><body>
<header><div class="in"><b>Painel · Dente Sempre</b>${info ? `<nav>
  <a href="/painel"${titulo === 'Clínicas' ? ' class="on"' : ''}>Clínicas</a><a href="/painel/nova"${titulo === 'Nova clínica' ? ' class="on"' : ''}>Nova clínica</a><a href="/painel/pagamentos"${titulo === 'Pagamentos' ? ' class="on"' : ''}>Pagamentos</a>
  <form method="post" action="/painel/sair"><input type="hidden" name="t" value="${info.form}"><button type="submit">Sair</button></form></nav>` : ''}</div></header>
<main>${corpo}</main></body></html>`;
  }
  // Aviso depois de uma ação: guardado por pouco tempo e mostrado UMA vez (assim "atualizar a página" não repete a ação)
  const avisos = new Map();
  function guardarAviso(html) {
    const id = crypto.randomBytes(12).toString('hex');
    for (const [k, v] of avisos) if (v.ate < Date.now()) avisos.delete(k);
    avisos.set(id, { html, ate: Date.now() + 10 * 60000 });
    return id;
  }
  function tirarAviso(id) { const v = avisos.get(String(id || '')); avisos.delete(String(id || '')); return v && v.ate > Date.now() ? v.html : ''; }
  const msg = (tipo, texto) => texto ? `<div class="msg ${tipo}">${texto}</div>` : '';
  const oculto = info => `<input type="hidden" name="t" value="${info.form}">`;

  function paginaEntrar(erro) {
    if (!ligado()) {
      return moldura('Painel desligado', `<div class="entrar caixa"><h1>Painel desligado</h1>
        <p>Para ligar, defina a variável <b>PAINEL_SENHA</b> (pelo menos 12 caracteres) na configuração do servidor e religue o servidor.</p>
        <p class="muted">No VPS: arquivo <span class="mono">/etc/dente-sempre.env</span>, depois <span class="mono">systemctl restart dente-sempre</span>.</p></div>`);
    }
    return moldura('Entrar', `<div class="entrar caixa"><h1>Entrar no painel</h1>
      ${msg('mal', erro ? esc(erro) : '')}
      <form method="post" action="/painel/entrar">
        <label><span>Senha do painel</span><input type="password" name="senha" autocomplete="current-password" autofocus required></label>
        <button class="bt bp" type="submit" style="width:100%">Entrar</button>
      </form></div>`);
  }

  function paginaLista(info, q, aviso) {
    const todas = listarClinicas();
    const qn = String(q || '').trim().toLowerCase();
    const lista = qn ? todas.filter(c => (c.codigo + ' ' + c.nome).toLowerCase().includes(qn)) : todas;
    const ativas = todas.filter(c => planos.situacao(c).ok).length;
    const porPlano = p => todas.filter(c => c.plano === p && planos.situacao(c).ok).length;
    const aparelhosTotal = sistema().prepare('SELECT COUNT(*) n FROM aparelhos WHERE revogado = 0').get().n;
    const linhas = lista.slice().reverse().map(c => {
      const lim = planos.limites(c), n = nAparelhos(c.id);
      return `<tr><td><a href="/painel/clinica?c=${encodeURIComponent(c.codigo)}">${esc(c.nome)}</a><div class="muted mono">${esc(c.codigo)}</div></td>
        <td>${esc(planos.nomeDoPlano(c.plano))}</td><td>${situacaoTxt(c)}</td><td>${c.validaAte ? dataBR(c.validaAte) : '<span class="muted">sem data</span>'}</td>
        <td class="n">${n} / ${lim.aparelhos}</td><td>${dataBR(c.criadaEm)}</td></tr>`;
    }).join('');
    return moldura('Clínicas', `
      ${aviso || ''}
      <div class="numeros"><div><b>${todas.length}</b><span>clínicas</span></div><div><b>${ativas}</b><span>em uso agora</span></div>
        ${Object.keys(planos.PLANOS).map(p => `<div><b>${porPlano(p)}</b><span>${esc(planos.nomeDoPlano(p))}</span></div>`).join('')}
        <div><b>${aparelhosTotal}</b><span>aparelhos ativados</span></div></div>
      <div class="topo"><div><h1>Clínicas</h1><p>Mais novas primeiro. Clique no nome para ver aparelhos, chaves e pagamentos.</p></div>
        <form class="busca" method="get" action="/painel"><input type="search" name="q" value="${esc(q || '')}" placeholder="Buscar por nome ou código"><button class="bt" type="submit">Buscar</button></form></div>
      <div class="caixa rolar">${lista.length ? `<table><tr><th>Clínica</th><th>Plano</th><th>Situação</th><th>Vale até</th><th>Aparelhos</th><th>Criada em</th></tr>${linhas}</table>`
        : `<p style="margin:0">${todas.length ? 'Nenhuma clínica com essa busca.' : 'Nenhuma clínica ainda. <a href="/painel/nova">Criar a primeira</a>.'}</p>`}</div>`, info);
  }

  function paginaNova(info, v = {}, erro) {
    return moldura('Nova clínica', `<h1>Nova clínica</h1><p>Cria a clínica, o usuário administrador com senha provisória e a chave de ativação.</p>
      ${msg('mal', erro ? esc(erro) : '')}
      <form class="caixa" method="post" action="/painel/nova">${oculto(info)}
        <label><span>Nome da clínica</span><input name="nome" maxlength="80" value="${esc(v.nome || '')}" required></label>
        <div class="linha">
          <label><span>Código (opcional)</span><input name="codigo" maxlength="30" value="${esc(v.codigo || '')}" placeholder="feito a partir do nome"></label>
          <label><span>Plano</span><select name="plano">${Object.keys(planos.PLANOS).map(p => `<option value="${p}"${(v.plano || planos.PLANO_PADRAO) === p ? ' selected' : ''}>${esc(planos.nomeDoPlano(p))}</option>`).join('')}</select></label>
          <label><span>Dias de validade</span><input name="dias" inputmode="numeric" maxlength="4" value="${esc(v.dias || '')}" placeholder="teste: ${planos.PLANOS.teste.dias} · outros: sem data"></label>
        </div>
        <button class="bt bp" type="submit">Criar clínica</button>
      </form>`, info);
  }

  function textoParaClinica(r, servidor) {
    return `Olá! A sua clínica já está no Dente Sempre.\n\nCódigo da clínica: ${r.clinica.codigo}\nUsuário: ${r.login}\nSenha provisória: ${r.senha} (o programa pede para trocar no primeiro acesso)\nChave de ativação: ${r.chave}\n\nPlano: ${planos.nomeDoPlano(r.clinica.plano)}${r.clinica.validaAte ? ' (até ' + dataBR(r.clinica.validaAte) + ')' : ''}\n${servidor ? 'Para assinar ou renovar: ' + servidor + '/assinar?clinica=' + r.clinica.codigo : ''}`.trim();
  }

  function paginaClinica(info, c, aviso) {
    const lim = planos.limites(c), cont = contagens(c), st = planos.situacao(c);
    const aparelhos = sistema().prepare('SELECT * FROM aparelhos WHERE clinicaId = ? ORDER BY revogado, ativadoEm').all(c.id);
    const chaves = sistema().prepare('SELECT * FROM licencas WHERE clinicaId = ? ORDER BY criadaEm').all(c.id);
    const pedidos = pagamento ? pagamento().listarPedidos(c.id, 30) : [];
    const acao = (nome, rotulo, cls, extra) => `<form method="post" action="/painel/acao">${oculto(info)}<input type="hidden" name="c" value="${esc(c.codigo)}"><input type="hidden" name="acao" value="${nome}">${extra || ''}<button class="bt ${cls || ''}" type="submit">${rotulo}</button></form>`;
    const suspensa = c.situacao === 'suspensa' || c.situacao === 'cancelada';
    return moldura(c.nome, `
      <p><a href="/painel">‹ Clínicas</a></p>
      ${aviso || ''}
      <div class="topo"><div><h1>${esc(c.nome)}</h1><p class="mono">${esc(c.codigo)}</p></div>
        <div class="acoes">${suspensa ? acao('reativar', 'Reativar clínica', 'bg') : acao('suspender', 'Suspender clínica', 'bd')}${acao('nova-chave', 'Gerar chave nova', 'bp')}${acao('senha-admin', 'Senha nova do administrador')}</div></div>
      <div class="caixa"><dl>
        <dt>Plano</dt><dd>${esc(planos.nomeDoPlano(c.plano))}</dd>
        <dt>Situação</dt><dd>${situacaoTxt(c)}${st.ok ? '' : ` <span class="muted">${esc(st.motivo)}</span>`}</dd>
        <dt>Vale até</dt><dd>${c.validaAte ? dataBR(c.validaAte) : 'sem data para acabar'}</dd>
        <dt>Aparelhos</dt><dd>${nAparelhos(c.id)} de ${lim.aparelhos}</dd>
        <dt>Dentistas ativos</dt><dd>${cont.dentistas} de ${lim.dentistas}</dd>
        <dt>Usuários ativos</dt><dd>${cont.usuarios} de ${lim.usuarios}</dd>
        <dt>Criada em</dt><dd>${dataBR(c.criadaEm)}</dd>
      </dl></div>
      <div class="caixa"><h2>Mudar plano</h2>
        <form method="post" action="/painel/acao">${oculto(info)}<input type="hidden" name="c" value="${esc(c.codigo)}"><input type="hidden" name="acao" value="plano">
          <div class="linha"><label><span>Plano</span><select name="plano">${Object.keys(planos.PLANOS).map(p => `<option value="${p}"${c.plano === p ? ' selected' : ''}>${esc(planos.nomeDoPlano(p))}</option>`).join('')}</select></label>
          <label><span>Vale até (vazio = sem data; teste = ${planos.PLANOS.teste.dias} dias)</span><input type="date" name="ate" value="${c.validaAte ? String(c.validaAte).slice(0, 10) : ''}"></label></div>
          <button class="bt bp" type="submit">Salvar plano</button></form></div>
      <div class="caixa rolar"><h2>Aparelhos</h2>
        ${aparelhos.length ? `<table><tr><th>Nome</th><th>Aparelho</th><th>Ativado</th><th>Último contato</th><th>Situação</th><th></th></tr>
        ${aparelhos.map(a => `<tr><td>${esc(a.nome || '—')}</td><td class="mono">${esc(a.aparelho)}</td><td>${dataBR(a.ativadoEm)}</td><td>${horaBR(a.vistoEm)}</td>
          <td>${a.revogado ? '<span class="tag mal">Desativado</span>' : '<span class="tag ok">Ativo</span>'}</td>
          <td>${acao(a.revogado ? 'liberar' : 'revogar', a.revogado ? 'Liberar' : 'Desativar', a.revogado ? '' : 'bd', `<input type="hidden" name="aparelho" value="${esc(a.aparelho)}">`)}</td></tr>`).join('')}</table>`
        : '<p style="margin:0">Nenhum aparelho ativado ainda.</p>'}
        <p class="muted" style="margin:10px 0 0">Desativar libera o lugar no plano; o aparelho para de sincronizar no próximo contato.</p></div>
      <div class="caixa rolar"><h2>Chaves de ativação</h2>
        <table><tr><th>Chave</th><th>Criada em</th><th>Situação</th></tr>
        ${chaves.map(k => `<tr><td class="mono">${esc(k.chave)}</td><td>${dataBR(k.criadaEm)}</td><td>${k.bloqueada ? '<span class="tag mal">Bloqueada</span>' : '<span class="tag ok">Vale</span>'}</td></tr>`).join('')}</table></div>
      <div class="caixa rolar"><h2>Pagamentos</h2>
        ${pedidos.length ? tabelaPedidos(pedidos, false) : '<p style="margin:0">Nenhum pagamento pela internet ainda.</p>'}</div>`, info);
  }

  function tabelaPedidos(lista, comClinica) {
    return `<table><tr><th>Data</th>${comClinica ? '<th>Clínica</th>' : ''}<th>Plano</th><th>Período</th><th>Valor</th><th>Situação</th><th>Pagamento</th><th>Vale até</th></tr>
      ${lista.map(p => {
        const c = comClinica ? clinicaPorId(p.clinicaId) : null;
        const cls = { pago: 'ok', recusado: 'mal', devolvido: 'mal', 'valor-diferente': 'mal', pendente: 'esp' }[p.situacao] || 'neutro';
        return `<tr><td>${horaBR(p.criadoEm)}</td>${comClinica ? `<td>${c ? `<a href="/painel/clinica?c=${encodeURIComponent(c.codigo)}">${esc(c.nome)}</a>` : esc(p.clinicaId)}</td>` : ''}
          <td>${esc(planos.nomeDoPlano(p.plano))}</td><td>${p.meses} ${p.meses === 1 ? 'mês' : 'meses'}</td><td class="n">${reais(p.centavos)}</td>
          <td><span class="tag ${cls}">${esc(PAG_SIT[p.situacao] || p.situacao)}</span></td><td class="mono">${esc(p.pagamentoId || '—')}</td><td>${p.validaAteDepois ? dataBR(p.validaAteDepois) : '—'}</td></tr>`;
      }).join('')}</table>`;
  }

  function paginaPagamentos(info) {
    const cfg = pagamento ? pagamento().situacaoConfig() : null;
    const lista = pagamento ? pagamento().listarPedidos(null, 300) : [];
    const recebido = lista.filter(p => p.situacao === 'pago').reduce((t, p) => t + p.centavos, 0);
    return moldura('Pagamentos', `<h1>Pagamentos</h1>
      ${cfg ? `<div class="caixa"><h2>Configuração</h2><dl>
        <dt>Mercado Pago</dt><dd>${cfg.token ? '<span class="tag ok">Token configurado</span>' : '<span class="tag mal">Falta MP_ACCESS_TOKEN</span>'}</dd>
        <dt>Assinatura dos avisos</dt><dd>${cfg.segredo ? '<span class="tag ok">Conferida</span>' : '<span class="tag esp">Sem MP_WEBHOOK_SEGREDO (os avisos são conferidos direto no Mercado Pago)</span>'}</dd>
        <dt>Endereço público</dt><dd>${cfg.endereco ? esc(cfg.endereco) : '<span class="tag esp">Sem ENDERECO_PUBLICO (usa o endereço do pedido)</span>'}</dd>
        <dt>Preços por mês</dt><dd>${Object.entries(cfg.precos).map(([p, c]) => `${esc(planos.nomeDoPlano(p))}: ${c ? reais(c) : '<span class="tag mal">sem preço</span>'}`).join(' · ')}</dd>
        <dt>Períodos</dt><dd>${cfg.meses.map(m => m + (m === 1 ? ' mês' : ' meses')).join(', ')}</dd>
        <dt>Página de assinatura</dt><dd><a href="/assinar" target="_blank" rel="noopener">/assinar</a></dd>
      </dl></div>` : ''}
      <div class="numeros"><div><b>${lista.filter(p => p.situacao === 'pago').length}</b><span>pagos</span></div><div><b>${reais(recebido)}</b><span>recebidos (últimos ${lista.length} pedidos)</span></div></div>
      <div class="caixa rolar">${lista.length ? tabelaPedidos(lista, true) : '<p style="margin:0">Nenhum pedido ainda.</p>'}</div>`, info);
  }

  // ---------- Ações ----------
  function fazerAcao(c, f) {
    const S = sistema(), acao = f.get('acao');
    if (acao === 'suspender') { S.prepare('UPDATE clinicas SET situacao = ? WHERE id = ?').run('suspensa', c.id); return msg('esp', 'Clínica suspensa. Os aparelhos param de sincronizar no próximo contato.'); }
    if (acao === 'reativar') { S.prepare('UPDATE clinicas SET situacao = ? WHERE id = ?').run(c.plano === 'teste' ? 'teste' : 'ativa', c.id); return msg('ok', 'Clínica reativada.'); }
    if (acao === 'nova-chave') {
      const k = novaChaveDaClinica(c);
      return msg('ok', `Chave nova: <span class="mono">${esc(k)}</span><br><span class="muted">As chaves anteriores continuam valendo.</span>`);
    }
    if (acao === 'senha-admin') {
      const d = bancoDaClinica(c.id);
      const adm = d.prepare("SELECT * FROM usuarios WHERE role = 'admin' ORDER BY criadoEm LIMIT 1").get();
      if (!adm) return msg('mal', 'Esta clínica não tem administrador.');
      const senha = senhaProvisoria();
      d.prepare('UPDATE usuarios SET senha = ?, mustChange = 1, active = 1 WHERE id = ?').run(JSON.stringify(novaSenha(senha)), adm.id);
      return msg('ok', `Senha provisória do administrador: usuário <b>${esc(adm.login)}</b>, senha <span class="mono">${esc(senha)}</span><br><span class="muted">O programa pede para trocar no primeiro acesso.</span>`);
    }
    if (acao === 'plano') {
      const p = String(f.get('plano') || '');
      if (!planos.PLANOS[p]) return msg('mal', 'Plano inválido.');
      const ate = String(f.get('ate') || '');
      if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return msg('mal', 'Data inválida.');
      const validaAte = ate ? new Date(ate + 'T23:59:59').toISOString() : (p === 'teste' ? new Date(Date.now() + planos.PLANOS.teste.dias * 86400000).toISOString() : null);
      S.prepare('UPDATE clinicas SET plano = ?, situacao = ?, validaAte = ? WHERE id = ?').run(p, p === 'teste' ? 'teste' : 'ativa', validaAte, c.id);
      return msg('ok', `Plano ${esc(planos.nomeDoPlano(p))} salvo${validaAte ? ' até ' + dataBR(validaAte) : ', sem data para acabar'}.`);
    }
    if (acao === 'revogar' || acao === 'liberar') {
      const r = S.prepare('UPDATE aparelhos SET revogado = ? WHERE clinicaId = ? AND aparelho = ?').run(acao === 'revogar' ? 1 : 0, c.id, String(f.get('aparelho') || ''));
      if (!r.changes) return msg('mal', 'Aparelho não encontrado.');
      return acao === 'revogar' ? msg('esp', 'Aparelho desativado. O lugar dele no plano ficou livre.') : msg('ok', 'Aparelho liberado. Ele volta a contar no limite do plano.');
    }
    return msg('mal', 'Ação desconhecida.');
  }

  // =====================================================================
  //  GET/POST /painel...
  // =====================================================================
  function atender(req, res, url, ip, seguro) {
    const enviar = (status, html, extra) => {
      res.writeHead(status, Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }, extra || {}));
      res.end(html);
    };
    const ir = (local, extra) => { res.writeHead(303, Object.assign({ Location: local }, extra || {})); res.end(); };
    const cookie = (token, idade) => `${COOKIE}=${token}; Path=/painel; HttpOnly; SameSite=Strict; Max-Age=${idade}${seguro ? '; Secure' : ''}`;
    const token = (() => { const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]{43})(?:;|$)').exec(req.headers.cookie || ''); return m ? m[1] : ''; })();
    const lerForm = fn => {
      let corpo = '';
      req.on('data', p => { corpo += p; if (corpo.length > 8000) req.destroy(); });
      req.on('end', () => {
        try { fn(new URLSearchParams(corpo)); }
        catch (e) { console.error(new Date().toISOString(), 'painel', e); enviar(500, moldura('Erro', '<div class="caixa"><h1>Algo deu errado</h1><p>' + esc(e.message) + '</p><a class="bt" href="/painel">Voltar</a></div>')); }
      });
    };
    const caminho = url.pathname.replace(/\/+$/, '') || '/painel';
    if (!ligado()) return enviar(503, paginaEntrar());
    let info = null;
    try { info = sessao(token); } catch (e) { console.error(new Date().toISOString(), 'painel', e); }

    if (caminho === '/painel/entrar' && req.method === 'POST') {
      return lerForm(f => {
        if (bloqueado(ip)) return enviar(429, paginaEntrar(`Muitas tentativas erradas. Espere ${ESPERA_MIN} minutos.`));
        if (!senhaConfere(f.get('senha'))) { anotarErro(ip); return enviar(401, paginaEntrar('Senha errada.')); }
        erros.delete(ip);
        ir('/painel', { 'Set-Cookie': cookie(novaSessao(ip), SESSAO_HORAS * 3600) });
      });
    }
    if (!info) {
      if (req.method === 'POST') return ir('/painel');
      return enviar(token ? 401 : 200, paginaEntrar(), token ? { 'Set-Cookie': cookie('', 0) } : undefined);
    }
    // Daqui para baixo: com sessão
    if (req.method === 'POST') {
      return lerForm(f => {
        // [SEGURANÇA] todo formulário precisa da senha da sessão
        if (f.get('t') !== info.form) return enviar(403, moldura('Página desatualizada', '<div class="caixa"><h1>Página desatualizada</h1><p>Abra a página de novo e repita.</p><a class="bt" href="/painel">Voltar</a></div>', info));
        if (caminho === '/painel/sair') {
          s().prepare('DELETE FROM painel_sessoes WHERE resumo = ?').run(info.h);
          return ir('/painel', { 'Set-Cookie': cookie('', 0) });
        }
        if (caminho === '/painel/nova') {
          const v = { nome: String(f.get('nome') || '').replace(/\s+/g, ' ').trim().slice(0, 80), codigo: String(f.get('codigo') || '').trim().slice(0, 30), plano: String(f.get('plano') || ''), dias: String(f.get('dias') || '').replace(/\D/g, '').slice(0, 4) };
          if (v.nome.length < 2) return enviar(400, paginaNova(info, v, 'Escreva o nome da clínica.'));
          let r;
          try { r = criarClinica({ nome: v.nome, codigo: v.codigo || undefined, plano: v.plano, dias: v.dias || undefined }); }
          catch (e) { return enviar(400, paginaNova(info, v, e.message)); }
          const servidor = String(process.env.ENDERECO_PUBLICO || '').replace(/\/+$/, '');
          return ir('/painel/clinica?c=' + encodeURIComponent(r.clinica.codigo) + '&aviso=' + guardarAviso(msg('ok', `Clínica criada. Guarde estes dados agora: a senha provisória não aparece de novo.
            <dl style="margin:10px 0"><dt>Código da clínica</dt><dd class="mono">${esc(r.clinica.codigo)}</dd><dt>Usuário</dt><dd class="mono">${esc(r.login)}</dd>
            <dt>Senha provisória</dt><dd class="mono">${esc(r.senha)}</dd><dt>Chave de ativação</dt><dd class="mono">${esc(r.chave)}</dd></dl>
            <label style="margin:0"><span>Texto para mandar à clínica</span><textarea rows="9" readonly>${esc(textoParaClinica(r, servidor))}</textarea></label>`)));
        }
        if (caminho === '/painel/acao') {
          const c = clinicaPorCodigo(f.get('c'));
          if (!c) return enviar(404, paginaLista(info, '', msg('mal', 'Clínica não encontrada.')));
          const aviso = fazerAcao(c, f);
          return ir('/painel/clinica?c=' + encodeURIComponent(c.codigo) + '&aviso=' + guardarAviso(aviso));
        }
        return enviar(404, moldura('Não encontrado', '<div class="caixa"><h1>Página não encontrada</h1></div>', info));
      });
    }
    if (caminho === '/painel') return enviar(200, paginaLista(info, String(url.searchParams.get('q') || '').slice(0, 60)));
    if (caminho === '/painel/nova') return enviar(200, paginaNova(info));
    if (caminho === '/painel/pagamentos') return enviar(200, paginaPagamentos(info));
    if (caminho === '/painel/clinica') {
      const c = clinicaPorCodigo(url.searchParams.get('c'));
      if (!c) return enviar(404, paginaLista(info, '', msg('mal', 'Clínica não encontrada.')));
      return enviar(200, paginaClinica(info, c, tirarAviso(url.searchParams.get('aviso'))));
    }
    return enviar(404, moldura('Não encontrado', '<div class="caixa"><h1>Página não encontrada</h1><a class="bt" href="/painel">Voltar</a></div>', info));
  }

  return { atender };
}

module.exports = { criarPainel };
