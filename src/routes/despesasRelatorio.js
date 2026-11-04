import { Router } from 'express';
import { pool } from '../db.js';
import * as v from '../utils/validacao.js';
import { invalido } from '../utils/erros.js';
import { formatarData, formatarMoeda } from '../utils/formato.js';
import { paraCentavos } from '../services/vendas.js';
import { enviarCsv, numeroCsv } from '../services/csv.js';
import { enviarPdf } from '../services/pdf.js';

export const relatorioDespesasRouter = Router();

export const NOMES_STATUS_CATEGORIA = {
    ativas: 'Somente ativas',
    ambas: 'Ativas e desativadas',
    desativadas: 'Somente desativadas',
};

/** Lê o status das categorias e a lista de ids selecionados (ausente = todas do status). */
export function lerFiltroCategorias(q) {
    const status = q.status ?? 'ativas';
    if (!NOMES_STATUS_CATEGORIA[status]) throw invalido('Status de categoria inválido.');
    let categorias = null;
    if (q.categorias !== undefined && q.categorias !== '') {
        categorias = [...new Set(String(q.categorias).split(',').filter(Boolean).map(v.id))];
    }
    return { status, categorias };
}

/** Trecho SQL (sobre o alias "c" de categorias_despesa) que aplica o filtro de categorias. */
export function condicaoCategorias({ status, categorias }) {
    const condicoes = [];
    const params = [];
    if (status === 'ativas') condicoes.push('c.ativa = TRUE');
    if (status === 'desativadas') condicoes.push('c.ativa = FALSE');
    if (categorias) { condicoes.push('c.id IN (?)'); params.push(categorias); }
    return { sql: condicoes.length ? condicoes.join(' AND ') : 'TRUE', params };
}

/**
 * Relatório de despesas.
 * Parâmetros: inicio, fim; status (ativas|ambas|desativadas); categorias (ids; ausente = todas); formato.
 */
relatorioDespesasRouter.get('/', async (req, res) => {
    const inicio = v.data(req.query.inicio, 'a data inicial');
    const fim = v.data(req.query.fim, 'a data final');
    if (inicio > fim) throw invalido('A data inicial não pode ser maior que a data final.');
    const filtros = { inicio, fim, ...lerFiltroCategorias(req.query) };

    const rel = await montarRelatorio(filtros);
    const formato = req.query.formato ?? 'json';
    const nome = `relatorio-despesas_${inicio}_a_${fim}`;
    if (formato === 'csv') return enviarCsv(res, `${nome}.csv`, blocosCsv(rel));
    if (formato === 'pdf') return enviarPdf(res, `${nome}.pdf`, opcoesPdf(rel));
    res.json(rel);
});

async function montarRelatorio(f) {
    const cat = condicaoCategorias(f);
    const [linhas] = await pool.query(
        `SELECT d.id, d.data_despesa, d.valor, d.observacao, c.id AS categoria_id, c.nome AS categoria,
                c.ativa AS categoria_ativa, u.nome AS usuario
           FROM despesas d
           JOIN categorias_despesa c ON c.id = d.categoria_id
           JOIN usuarios u ON u.id = d.usuario_id
          WHERE d.data_despesa BETWEEN ? AND ? AND ${cat.sql}
          ORDER BY d.data_despesa, d.id`,
        [f.inicio, f.fim, ...cat.params],
    );

    let total = 0;
    const porCategoria = new Map();
    for (const l of linhas) {
        const c = paraCentavos(l.valor);
        total += c;
        const g = porCategoria.get(l.categoria_id)
            ?? { categoria: l.categoria, ativa: Boolean(l.categoria_ativa), quantidade: 0, total: 0 };
        g.quantidade += 1;
        g.total += c;
        porCategoria.set(l.categoria_id, g);
    }

    return {
        filtros: f,
        resumo: { quantidade: linhas.length, total: total / 100 },
        porCategoria: [...porCategoria.values()]
            .map((g) => ({ ...g, total: g.total / 100, percentual: total ? (g.total / total) * 100 : 0 }))
            .sort((a, b) => b.total - a.total),
        despesas: linhas.map((l) => ({
            id: l.id, data: l.data_despesa, categoria: l.categoria, categoriaAtiva: Boolean(l.categoria_ativa),
            valor: Number(l.valor), observacao: l.observacao, usuario: l.usuario,
        })),
    };
}

// ---------------------------------------------------------------- Exportação
const nomeCategoria = (nome, ativa) => (ativa ? nome : `${nome} (desativada)`);
const pct = (n) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

function blocosCsv(rel) {
    const f = rel.filtros;
    return [
        {
            titulo: `Relatório de despesas - ${formatarData(f.inicio)} a ${formatarData(f.fim)} - ${NOMES_STATUS_CATEGORIA[f.status]}`,
            colunas: ['Categoria', 'Lançamentos', 'Total (R$)', '% do total'],
            linhas: [
                ...rel.porCategoria.map((g) => [nomeCategoria(g.categoria, g.ativa), g.quantidade, numeroCsv(g.total, 2), numeroCsv(g.percentual, 1)]),
                ['Total', rel.resumo.quantidade, numeroCsv(rel.resumo.total, 2), rel.resumo.total ? '100,0' : '0,0'],
            ],
        },
        {
            titulo: 'Despesas',
            colunas: ['Data', 'Categoria', 'Valor (R$)', 'Observação', 'Usuário'],
            linhas: rel.despesas.map((d) => [formatarData(d.data), nomeCategoria(d.categoria, d.categoriaAtiva), numeroCsv(d.valor, 2), d.observacao ?? '', d.usuario]),
        },
    ];
}

function opcoesPdf(rel) {
    const f = rel.filtros;
    return {
        titulo: 'Relatório de despesas',
        subtitulo: `Período: ${formatarData(f.inicio)} a ${formatarData(f.fim)}`,
        filtros: [
            ['Categorias', NOMES_STATUS_CATEGORIA[f.status]],
            ['Selecionadas', f.categorias ? rel.porCategoria.map((g) => g.categoria).join(', ') || 'Nenhuma com lançamentos' : 'Todas'],
        ],
        blocos: [
            {
                titulo: 'Por categoria',
                colunas: [{ titulo: 'Categoria', largura: 3.5 }, { titulo: 'Lançamentos', alinhar: 'right' },
                    { titulo: 'Total', largura: 1.4, alinhar: 'right' }, { titulo: '% do total', alinhar: 'right' }],
                linhas: rel.porCategoria.map((g) => [nomeCategoria(g.categoria, g.ativa), String(g.quantidade), formatarMoeda(g.total), pct(g.percentual)]),
                totais: ['Total', String(rel.resumo.quantidade), formatarMoeda(rel.resumo.total), rel.resumo.total ? '100,0%' : '-'],
                vazio: 'Nenhuma despesa no período.',
            },
            {
                titulo: 'Despesas',
                colunas: [{ titulo: 'Data', largura: 1 }, { titulo: 'Categoria', largura: 2 }, { titulo: 'Valor', largura: 1.2, alinhar: 'right' },
                    { titulo: 'Observação', largura: 2.8 }, { titulo: 'Usuário', largura: 1.3 }],
                linhas: rel.despesas.map((d) => [formatarData(d.data), nomeCategoria(d.categoria, d.categoriaAtiva), formatarMoeda(d.valor), d.observacao ?? '', d.usuario]),
                totais: ['', 'Total', formatarMoeda(rel.resumo.total), '', ''],
                vazio: 'Nenhuma despesa no período.',
            },
        ],
    };
}
