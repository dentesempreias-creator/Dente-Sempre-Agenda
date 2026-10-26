'use strict';
// =====================================================================
//  Dente Sempre — PLANOS e situação de cada clínica
//
//  Este é o único arquivo que decide "o que cada clínica pode usar".
//  O servidor confere estas regras em todo pedido; o aplicativo só mostra.
//
//  Para mudar um plano: edite a tabela PLANOS e religue o servidor.
//  Para mudar o plano de uma clínica:  node servidor.js plano <codigo> <plano> [--ate AAAA-MM-DD]
//
//  PAGAMENTO: ainda NÃO existe. Quando existir, a confirmação do pagamento
//  só precisa chamar o mesmo que o comando "plano" faz hoje: mudar o plano
//  e a data "validaAte" da clínica (ver aoConfirmarPagamento, no fim).
// =====================================================================

// aparelhos = computadores e celulares ativados ao mesmo tempo
// dentistas = dentistas ATIVOS na agenda
// usuarios  = usuários ativos (administrador, recepção e dentistas)
// preco     = definido na hora de vender (null = ainda sem preço)
const PLANOS = {
  teste:        { nome: 'Teste grátis', aparelhos: 2,  dentistas: 2, usuarios: 4,  dias: 14, preco: null },
  basico:       { nome: 'Básico',       aparelhos: 3,  dentistas: 2, usuarios: 6,  preco: null },
  profissional: { nome: 'Profissional', aparelhos: 10, dentistas: 8, usuarios: 20, preco: null }
};
const PLANO_PADRAO = 'teste';

// Situações possíveis de uma clínica
//   teste     → usando o teste grátis (vale até validaAte)
//   ativa     → plano em dia (validaAte vazio = sem data para acabar)
//   suspensa  → bloqueada pelo suporte (ex.: pagamento atrasado)
//   cancelada → não usa mais
const SITUACOES = ['teste', 'ativa', 'suspensa', 'cancelada'];

const dataBR = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}`; };

// Limites da clínica: os do plano, com ajustes próprios se houver (limitesExtra)
function limites(clinica) {
  const p = PLANOS[clinica.plano] || PLANOS[PLANO_PADRAO];
  let extra = {};
  try { extra = clinica.limitesExtra ? JSON.parse(clinica.limitesExtra) : {}; } catch (e) { extra = {}; }
  return {
    aparelhos: Number(extra.aparelhos) || p.aparelhos,
    dentistas: Number(extra.dentistas) || p.dentistas,
    usuarios: Number(extra.usuarios) || p.usuarios
  };
}
const nomeDoPlano = plano => (PLANOS[plano] || {}).nome || plano;

// A clínica pode usar o programa agora?
function situacao(clinica, agora = new Date()) {
  if (!clinica) return { ok: false, motivo: 'Clínica não encontrada.' };
  if (clinica.situacao === 'suspensa') return { ok: false, motivo: 'O uso desta clínica está suspenso. Fale com o suporte do Dente Sempre.' };
  if (clinica.situacao === 'cancelada') return { ok: false, motivo: 'Esta clínica não está mais ativa no Dente Sempre. Fale com o suporte.' };
  if (clinica.validaAte && Date.parse(clinica.validaAte) < agora.getTime()) {
    return { ok: false, motivo: clinica.situacao === 'teste'
      ? `O teste grátis terminou em ${dataBR(clinica.validaAte)}. Fale com o suporte para escolher um plano.`
      : `O plano terminou em ${dataBR(clinica.validaAte)}. Fale com o suporte para renovar.` };
  }
  return { ok: true };
}

// PREPARADO (não ligado): o que a confirmação de um pagamento vai fazer.
// Ex.: aoConfirmarPagamento(clinica, { plano: 'basico', meses: 1 }) → { plano, situacao, validaAte }
function aoConfirmarPagamento(clinica, { plano, meses }) {
  const base = clinica.validaAte && Date.parse(clinica.validaAte) > Date.now() ? new Date(clinica.validaAte) : new Date();
  base.setMonth(base.getMonth() + (Number(meses) || 1));
  return { plano, situacao: 'ativa', validaAte: base.toISOString() };
}

module.exports = { PLANOS, PLANO_PADRAO, SITUACOES, limites, nomeDoPlano, situacao, aoConfirmarPagamento, dataBR };
