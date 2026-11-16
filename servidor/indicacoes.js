'use strict';
// =====================================================================
//  Dente Sempre — DESCONTO POR INDICAÇÃO ENTRE CLÍNICAS (13/11)
//
//  Uma clínica que já usa o Dente Sempre indica outra clínica. Quando a clínica
//  indicada sai do teste grátis e passa para um plano pago, a indicação passa a
//  valer: quem indicou ganha DESCONTO_INDICACAO % (padrão 10) na próxima
//  mensalidade ou anuidade. As indicações se somam, até DESCONTO_INDICACAO_MAX %
//  (padrão 50).
//
//  Onde a indicação é anotada (só o dono do Dente Sempre):
//    - Painel → Nova clínica → "Indicada por" (código da clínica que indicou);
//    - node servidor.js nova-clinica "Nome" --indicada-por <codigo>;
//    - node servidor.js indicacao <codigo-de-quem-indicou> <codigo-da-indicada>.
//
//  O que o servidor faz: guarda as indicações, conta as que valem e calcula a
//  porcentagem e o valor final. O administrador da clínica vê tudo em Meu plano,
//  dentro do programa (rota /api/plano).
//
//  ESTRUTURA PREPARADA: a cobrança (assinatura.js / pagamento.js) ainda NÃO tira
//  o desconto sozinha. Quem cuida das cobranças dá o desconto e depois marca as
//  indicações como usadas (Painel → ficha da clínica → "Desconto dado", ou
//  node servidor.js indicacoes-usadas <codigo>). Quando a cobrança automática
//  existir, ela só precisa chamar resumo() para saber a porcentagem e usar()
//  depois que a cobrança com desconto for aprovada.
// =====================================================================

const SCHEMA = `
CREATE TABLE IF NOT EXISTS indicacoes (indicadaId TEXT PRIMARY KEY, porId TEXT NOT NULL, criadaEm TEXT NOT NULL, usadaEm TEXT);
CREATE INDEX IF NOT EXISTS indicacoes_por ON indicacoes (porId);`;

const numero = (v, padrao) => {
  if (v === undefined || v === null || String(v).trim() === '') return padrao;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : padrao;
};
// Regra do desconto (variáveis do servidor)
function regra() {
  const porIndicacao = Math.min(100, numero(process.env.DESCONTO_INDICACAO, 10));
  const maximo = Math.min(100, Math.max(porIndicacao, numero(process.env.DESCONTO_INDICACAO_MAX, 50)));
  return { porIndicacao, maximo };
}

function criarIndicacoes({ sistema, clinicaPorId, clinicaPorCodigo, agora }) {
  let pronto = false;
  const s = () => { const db = sistema(); if (!pronto) { db.exec(SCHEMA); pronto = true; } return db; };
  // A indicação vale quando a clínica indicada já tem plano pago (saiu do teste)
  const vale = c => !!c && c.plano !== 'teste';

  // Anota que "porCodigo" indicou a clínica "indicada" (código ou cadastro). Devolve { ok } ou { erro }.
  function registrar(porCodigo, indicada) {
    const por = clinicaPorCodigo(String(porCodigo || '').trim().toLowerCase());
    const alvo = typeof indicada === 'object' && indicada ? indicada : clinicaPorCodigo(String(indicada || '').trim().toLowerCase());
    if (!por) return { erro: `Não achei a clínica que indicou ("${porCodigo}").` };
    if (!alvo) return { erro: `Não achei a clínica indicada ("${indicada}").` };
    if (por.id === alvo.id) return { erro: 'Uma clínica não pode indicar a si mesma.' };
    const ja = s().prepare('SELECT * FROM indicacoes WHERE indicadaId = ?').get(alvo.id);
    if (ja) {
      const quem = clinicaPorId(ja.porId);
      return { erro: `A clínica ${alvo.nome} já está anotada como indicada por ${quem ? quem.nome + ' (' + quem.codigo + ')' : 'outra clínica'}.` };
    }
    s().prepare('INSERT INTO indicacoes (indicadaId, porId, criadaEm) VALUES (?, ?, ?)').run(alvo.id, por.id, agora());
    return { ok: true, por, indicada: alvo };
  }

  // Indicações feitas por uma clínica, com a situação de cada uma
  function lista(clinicaId) {
    return s().prepare('SELECT * FROM indicacoes WHERE porId = ? ORDER BY criadaEm').all(clinicaId).map(l => {
      const c = clinicaPorId(l.indicadaId);
      return { indicada: c ? { nome: c.nome, codigo: c.codigo, plano: c.plano } : null, criadaEm: l.criadaEm, usadaEm: l.usadaEm || null,
        situacao: l.usadaEm ? 'usada' : (vale(c) ? 'valendo' : 'aguardando') };
    });
  }

  // Resumo para "Meu plano": quantas valem, quantas esperam a indicada assinar, e a porcentagem acumulada
  function resumo(clinicaId) {
    const r = regra();
    let valendo = 0, aguardando = 0, usadas = 0;
    for (const l of lista(clinicaId)) {
      if (l.situacao === 'usada') usadas++;
      else if (l.situacao === 'valendo') valendo++;
      else if (l.indicada) aguardando++;
    }
    return Object.assign({}, r, { valendo, aguardando, usadas, pct: Math.min(r.maximo, valendo * r.porIndicacao) });
  }

  // O desconto foi dado: as indicações que valiam passam a "usadas". Devolve quantas.
  function usar(clinicaId) {
    const quando = agora();
    let n = 0;
    for (const l of s().prepare('SELECT * FROM indicacoes WHERE porId = ? AND usadaEm IS NULL').all(clinicaId)) {
      if (!vale(clinicaPorId(l.indicadaId))) continue;
      s().prepare('UPDATE indicacoes SET usadaEm = ? WHERE indicadaId = ?').run(quando, l.indicadaId);
      n++;
    }
    return n;
  }

  return { registrar, lista, resumo, usar, regra };
}

module.exports = { criarIndicacoes, regra };
