import { Router } from 'express';
import { pool } from '../db.js';
import * as v from '../utils/validacao.js';
import { invalido } from '../utils/erros.js';
import { formatarData, formatarMoeda } from '../utils/formato.js';
import { NOMES_PAGAMENTO, paraCentavos } from '../services/vendas.js';
import { lerFiltroCategorias, condicaoCategorias, NOMES_STATUS_CATEGORIA } from './despesasRelatorio.js';
import { enviarCsv, numeroCsv } from '../services/csv.js';
import { enviarPdf } from '../services/pdf.js';

export const dreRouter = Router();

const SECOES = {
    resumo: 'Resumo',
    categorias: 'Despesas por categoria',
    resultado: 'Resultado do período',
};

/**
 * DRE - Demonstrativo do Resultado do Exercício.
 * Parâmetros:
 *   inicio, fim (AAAA-MM-DD)
 *   receitas   = avista,aprazo   (ausente = ambas)
 *   status     = ativas|ambas|desativadas (status das categorias de despesa)
 *   categorias = ids             (ausente = todas do status)
 *   secoes     = resumo,categorias,resultado (ausente = todas)
 *   formato    = json|csv|pdf
 * Itens desmarcados ficam fora dos cálculos (receita, despesas e resultado são recalculados).
 */
dreRouter.get('/', async (req, res) => {
    const filtros = lerFiltros(req.query);
    const dre = await calcular(filtros);
    const formato = req.query.formato ?? 'json';
    const nome = `dre_${filtros.inicio}_a_${filtros.fim}`;
    if (formato === 'csv') return enviarCsv(res, `${nome}.csv`, blocosCsv(dre));
    if (formato === 'pdf') return enviarPdf(res, `${nome}.pdf`, opcoesPdf(dre));
    res.json(dre);
});

function lista(valor, permitidos, mensagemErro) {
    if (valor === undefined || valor === '') return Object.keys(permitidos);
    const itens = [...new Set(String(valor).split(','))];
    if (itens.some((i) => !permitidos[i])) throw invalido(mensagemErro);
    return itens;
}

function lerFiltros(q) {
    const inicio = v.data(q.inicio, 'a data inicial');
    const fim = v.data(q.fim, 'a data final');
    if (inicio > fim) throw invalido('A data inicial não pode ser maior que a data final.');
    return {
        inicio,
        fim,
        receitas: lista(q.receitas, NOMES_PAGAMENTO, 'Tipo de receita inválido.'),
        ...lerFiltroCategorias(q),
        secoes: lista(q.secoes, SECOES, 'Seção do DRE inválida.'),
    };
}

async function calcular(f) {
    // ---------- Receitas (vendas do período, por forma de pagamento)
    const [vendas] = await pool.query(
        `SELECT pagamento, SUM(valor_total) AS total, COUNT(*) AS quantidade
           FROM vendas
          WHERE data_venda BETWEEN ? AND ? AND pagamento IN (?)
          GROUP BY pagamento`,
        [f.inicio, f.fim, f.receitas],
    );
    const receitas = f.receitas.map((p) => {
        const r = vendas.find((x) => x.pagamento === p);
        return { tipo: p, nome: `Vendas ${NOMES_PAGAMENTO[p].toLowerCase()}`, quantidade: Number(r?.quantidade ?? 0), centavos: paraCentavos(r?.total ?? 0) };
    });
    const receitaCentavos = receitas.reduce((s, r) => s + r.centavos, 0);

    // ---------- Despesas (por categoria selecionada)
    const cat = condicaoCategorias(f);
    const [despesas] = await pool.query(
        `SELECT c.id, c.nome, c.ativa, SUM(d.valor) AS total, COUNT(*) AS quantidade
           FROM despesas d
           JOIN categorias_despesa c ON c.id = d.categoria_id
          WHERE d.data_despesa BETWEEN ? AND ? AND ${cat.sql}
          GROUP BY c.id, c.nome, c.ativa
          ORDER BY total DESC, c.nome`,
        [f.inicio, f.fim, ...cat.params],
    );
    const categorias = despesas.map((d) => ({
        id: d.id, nome: d.nome, ativa: Boolean(d.ativa), quantidade: Number(d.quantidade), centavos: paraCentavos(d.total),
    }));
    const despesaCentavos = categorias.reduce((s, c) => s + c.centavos, 0);
    const resultadoCentavos = receitaCentavos - despesaCentavos;

    const reais = (c) => c / 100;
    const percentual = (parte, todo) => (todo ? (parte / todo) * 100 : null);

    return {
        filtros: f,
        receitas: receitas.map((r) => ({ tipo: r.tipo, nome: r.nome, quantidade: r.quantidade, valor: reais(r.centavos) })),
        receitaTotal: reais(receitaCentavos),
        categorias: categorias.map((c) => ({
            id: c.id, nome: c.nome, ativa: c.ativa, quantidade: c.quantidade, valor: reais(c.centavos),
            percentualDespesas: percentual(c.centavos, despesaCentavos),
            percentualReceita: percentual(c.centavos, receitaCentavos),
        })),
        despesaTotal: reais(despesaCentavos),
        resultado: reais(resultadoCentavos),
        margem: percentual(resultadoCentavos, receitaCentavos), // resultado / receita
    };
}

// ---------------------------------------------------------------- Exportação
const pct = (n) => (n === null ? '-' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const nomeCategoria = (c) => (c.ativa ? c.nome : `${c.nome} (desativada)`);
const mostrar = (dre, secao) => dre.filtros.secoes.includes(secao);

function descricaoFiltros(dre) {
    const f = dre.filtros;
    return [
        ['Receitas', f.receitas.map((r) => `Vendas ${NOMES_PAGAMENTO[r].toLowerCase()}`).join(', ')],
        ['Categorias', NOMES_STATUS_CATEGORIA[f.status]
            + (f.categorias ? ` - ${f.categorias.length} selecionada(s)` : ' - todas')],
    ];
}

function blocosCsv(dre) {
    const blocos = [];
    const titulo = `DRE - ${formatarData(dre.filtros.inicio)} a ${formatarData(dre.filtros.fim)}`;
    if (mostrar(dre, 'resumo')) {
        blocos.push({
            titulo: `${titulo} - Resumo`,
            colunas: ['Item', 'Valor (R$)'],
            linhas: [
                ...dre.receitas.map((r) => [r.nome, numeroCsv(r.valor, 2)]),
                ['Receita total', numeroCsv(dre.receitaTotal, 2)],
                ['Despesas', numeroCsv(dre.despesaTotal, 2)],
            ],
        });
    }
    if (mostrar(dre, 'categorias')) {
        blocos.push({
            titulo: 'Despesas por categoria',
            colunas: ['Categoria', 'Lançamentos', 'Valor (R$)', '% das despesas', '% da receita'],
            linhas: [
                ...dre.categorias.map((c) => [nomeCategoria(c), c.quantidade, numeroCsv(c.valor, 2),
                    c.percentualDespesas === null ? '' : numeroCsv(c.percentualDespesas, 1),
                    c.percentualReceita === null ? '' : numeroCsv(c.percentualReceita, 1)]),
                ['Total de despesas', dre.categorias.reduce((s, c) => s + c.quantidade, 0), numeroCsv(dre.despesaTotal, 2), '', ''],
            ],
        });
    }
    if (mostrar(dre, 'resultado')) {
        blocos.push({
            titulo: 'Resultado do período',
            colunas: ['Item', 'Valor (R$)'],
            linhas: [
                ['Receita de vendas', numeroCsv(dre.receitaTotal, 2)],
                ['(-) Despesas', numeroCsv(-dre.despesaTotal, 2)],
                ['(=) Resultado', numeroCsv(dre.resultado, 2)],
                ['Margem sobre a receita (%)', dre.margem === null ? '' : numeroCsv(dre.margem, 1)],
            ],
        });
    }
    return blocos;
}

function opcoesPdf(dre) {
    const blocos = [];
    if (mostrar(dre, 'resumo')) {
        blocos.push({
            titulo: 'Resumo',
            colunas: [{ titulo: 'Item', largura: 3 }, { titulo: 'Valor', largura: 1.4, alinhar: 'right' }],
            linhas: [
                ...dre.receitas.map((r) => [r.nome, formatarMoeda(r.valor)]),
                ['Receita total', formatarMoeda(dre.receitaTotal)],
                ['Despesas', formatarMoeda(dre.despesaTotal)],
            ],
        });
    }
    if (mostrar(dre, 'categorias')) {
        blocos.push({
            titulo: 'Despesas por categoria',
            colunas: [{ titulo: 'Categoria', largura: 3 }, { titulo: 'Valor', largura: 1.4, alinhar: 'right' },
                { titulo: '% das despesas', largura: 1.1, alinhar: 'right' }, { titulo: '% da receita', largura: 1.1, alinhar: 'right' }],
            linhas: dre.categorias.map((c) => [nomeCategoria(c), formatarMoeda(c.valor), pct(c.percentualDespesas), pct(c.percentualReceita)]),
            totais: ['Total de despesas', formatarMoeda(dre.despesaTotal), dre.despesaTotal ? '100,0%' : '-', pct(dre.receitaTotal ? (dre.despesaTotal / dre.receitaTotal) * 100 : null)],
            vazio: 'Nenhuma despesa no período.',
        });
    }
    if (mostrar(dre, 'resultado')) {
        blocos.push({
            titulo: 'Resultado do período',
            colunas: [{ titulo: 'Item', largura: 3 }, { titulo: 'Valor', largura: 1.4, alinhar: 'right' }],
            linhas: [
                ['Receita de vendas', formatarMoeda(dre.receitaTotal)],
                ['(-) Despesas', `- ${formatarMoeda(dre.despesaTotal)}`],
                ['Margem sobre a receita', pct(dre.margem)],
            ],
            totais: ['(=) Resultado', formatarMoeda(dre.resultado)],
        });
    }
    return {
        titulo: 'DRE - Demonstrativo do Resultado',
        subtitulo: `Período: ${formatarData(dre.filtros.inicio)} a ${formatarData(dre.filtros.fim)}`,
        filtros: descricaoFiltros(dre),
        blocos,
    };
}
