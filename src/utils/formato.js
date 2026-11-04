/** Formatação para relatórios (PDF/CSV), no padrão brasileiro. */
import { UNIDADES_INTEIRAS } from './validacao.js';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatarMoeda = (v) => moeda.format(Number(v ?? 0));

export function formatarQuantidade(q, unidade) {
    const casas = UNIDADES_INTEIRAS.includes(unidade) ? 0 : 1;
    const n = Number(q ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });
    return unidade ? `${n} ${unidade}` : n;
}

/** '2026-11-03' -> '03/11/2026' */
export function formatarData(d) {
    if (!d) return '';
    const [a, m, dia] = String(d).slice(0, 10).split('-');
    return `${dia}/${m}/${a}`;
}

/** '2026-11-03 14:30:00' -> '03/11/2026 14:30' */
export const formatarDataHora = (d) => (d ? `${formatarData(d)} ${String(d).slice(11, 16)}` : '');

/**
 * Soma de decimais sem erro de arredondamento: trabalha em milésimos (inteiros).
 * Os valores do banco têm no máximo 3 casas decimais.
 */
export const paraMilesimos = (v) => Math.round(Number(v ?? 0) * 1000);
export const deMilesimos = (n) => n / 1000;
