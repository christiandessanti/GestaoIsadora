import { Router } from 'express';
import { pool } from '../db.js';
import * as v from '../utils/validacao.js';
import { invalido } from '../utils/erros.js';
import { formatarData, formatarMoeda, formatarQuantidade, paraMilesimos, deMilesimos } from '../utils/formato.js';
import { NOMES_PAGAMENTO, paraCentavos } from '../services/vendas.js';
import { enviarCsv, numeroCsv } from '../services/csv.js';
import { enviarPdf } from '../services/pdf.js';

export const relatorioVendasRouter = Router();

/**
 * Relatório de vendas.
 * Parâmetros: inicio, fim (AAAA-MM-DD); clientes, produtos (ids separados por vírgula; ausente = todos);
 *             pagamentos (avista,aprazo; ausente = ambos); formato (json|csv|pdf).
 * Quando há filtro de produtos, cada venda considera apenas os itens dos produtos selecionados.
 */
relatorioVendasRouter.get('/', async (req, res) => {
    const filtros = lerFiltros(req.query);
    const rel = await montarRelatorio(filtros);
    const formato = req.query.formato ?? 'json';
    const nome = `relatorio-vendas_${filtros.inicio}_a_${filtros.fim}`;

    if (formato === 'csv') return enviarCsv(res, `${nome}.csv`, blocosCsv(rel));
    if (formato === 'pdf') return enviarPdf(res, `${nome}.pdf`, opcoesPdf(rel));
    res.json(rel);
});

function listaIds(valor) {
    if (valor === undefined || valor === '') return null;
    const ids = [...new Set(String(valor).split(',').filter(Boolean).map(v.id))];
    if (!ids.length) throw invalido('Selecione pelo menos um item em cada filtro.');
    if (ids.length > 5000) throw invalido('Filtro com itens demais.');
    return ids;
}

function lerFiltros(q) {
    const inicio = v.data(q.inicio, 'a data inicial');
    const fim = v.data(q.fim, 'a data final');
    if (inicio > fim) throw invalido('A data inicial não pode ser maior que a data final.');
    let pagamentos = null;
    if (q.pagamentos) {
        pagamentos = [...new Set(String(q.pagamentos).split(','))];
        if (pagamentos.some((p) => !NOMES_PAGAMENTO[p])) throw invalido('Forma de pagamento inválida.');
    }
    return { inicio, fim, clientes: listaIds(q.clientes), produtos: listaIds(q.produtos), pagamentos };
}

async function montarRelatorio(f) {
    const condicoes = ['ve.data_venda BETWEEN ? AND ?'];
    const params = [f.inicio, f.fim];
    if (f.clientes) { condicoes.push('ve.cliente_id IN (?)'); params.push(f.clientes); }
    if (f.produtos) { condicoes.push('i.produto_id IN (?)'); params.push(f.produtos); }
    if (f.pagamentos) { condicoes.push('ve.pagamento IN (?)'); params.push(f.pagamentos); }

    const [linhas] = await pool.query(
        `SELECT ve.id AS venda_id, ve.data_venda, ve.pagamento, ve.cliente_id, c.nome AS cliente,
                i.produto_id, p.nome AS produto, p.unidade, i.quantidade, i.preco_unitario, i.subtotal
           FROM vendas ve
           JOIN vendas_itens i ON i.venda_id = ve.id
           JOIN clientes c ON c.id = ve.cliente_id
           JOIN produtos_venda p ON p.id = i.produto_id
          WHERE ${condicoes.join(' AND ')}
          ORDER BY ve.data_venda, ve.id, i.id`,
        params,
    );

    const vendas = new Map();
    const porCliente = new Map();
    const porProduto = new Map();
    const totais = { geral: 0, avista: 0, aprazo: 0 };

    for (const l of linhas) {
        const centavos = paraCentavos(l.subtotal);

        if (!vendas.has(l.venda_id)) {
            vendas.set(l.venda_id, {
                id: l.venda_id, data: l.data_venda, cliente: l.cliente, pagamento: l.pagamento, itens: [], total: 0,
            });
        }
        const venda = vendas.get(l.venda_id);
        venda.itens.push({ produto: l.produto, unidade: l.unidade, quantidade: Number(l.quantidade), precoUnitario: Number(l.preco_unitario) });
        venda.total += centavos;

        const cli = porCliente.get(l.cliente_id) ?? { cliente: l.cliente, vendas: new Set(), total: 0 };
        cli.vendas.add(l.venda_id);
        cli.total += centavos;
        porCliente.set(l.cliente_id, cli);

        const prod = porProduto.get(l.produto_id) ?? { produto: l.produto, unidade: l.unidade, quantidade: 0, total: 0 };
        prod.quantidade += paraMilesimos(l.quantidade);
        prod.total += centavos;
        porProduto.set(l.produto_id, prod);

        totais.geral += centavos;
        totais[l.pagamento] += centavos;
    }

    const reais = (c) => c / 100;
    const qtdVendas = vendas.size;
    return {
        filtros: f,
        apenasProdutosSelecionados: Boolean(f.produtos),
        resumo: {
            quantidadeVendas: qtdVendas,
            total: reais(totais.geral),
            avista: reais(totais.avista),
            aprazo: reais(totais.aprazo),
            ticketMedio: qtdVendas ? reais(Math.round(totais.geral / qtdVendas)) : 0,
        },
        porCliente: [...porCliente.values()]
            .map((c) => ({ cliente: c.cliente, quantidadeVendas: c.vendas.size, total: reais(c.total) }))
            .sort((a, b) => b.total - a.total),
        porProduto: [...porProduto.values()]
            .map((p) => ({ produto: p.produto, unidade: p.unidade, quantidade: deMilesimos(p.quantidade), total: reais(p.total) }))
            .sort((a, b) => b.total - a.total),
        vendas: [...vendas.values()].map((x) => ({ ...x, total: reais(x.total) })),
    };
}

// ---------------------------------------------------------------- Exportação
const casas = (u) => (v.UNIDADES_INTEIRAS.includes(u) ? 0 : 1);
const textoItens = (itens) => itens.map((i) => `${i.produto} (${formatarQuantidade(i.quantidade, i.unidade)})`).join(', ');
const descricaoFiltro = (lista, rotuloTodos = 'Todos') => (lista ? `${lista.length} selecionado(s)` : rotuloTodos);

function descricaoPagamentos(f) {
    return f.pagamentos ? f.pagamentos.map((p) => NOMES_PAGAMENTO[p]).join(', ') : 'Todas';
}

function blocosCsv(rel) {
    const f = rel.filtros;
    return [
        {
            titulo: `Relatório de vendas - ${formatarData(f.inicio)} a ${formatarData(f.fim)}`
                + (rel.apenasProdutosSelecionados ? ' - valores apenas dos produtos selecionados' : ''),
            colunas: ['Indicador', 'Valor'],
            linhas: [
                ['Quantidade de vendas', rel.resumo.quantidadeVendas],
                ['Total vendido (R$)', numeroCsv(rel.resumo.total, 2)],
                ['À vista (R$)', numeroCsv(rel.resumo.avista, 2)],
                ['A prazo (R$)', numeroCsv(rel.resumo.aprazo, 2)],
                ['Ticket médio (R$)', numeroCsv(rel.resumo.ticketMedio, 2)],
            ],
        },
        {
            titulo: 'Por cliente',
            colunas: ['Cliente', 'Vendas', 'Total (R$)'],
            linhas: rel.porCliente.map((c) => [c.cliente, c.quantidadeVendas, numeroCsv(c.total, 2)]),
        },
        {
            titulo: 'Por produto',
            colunas: ['Produto', 'Unidade', 'Quantidade', 'Total (R$)'],
            linhas: rel.porProduto.map((p) => [p.produto, p.unidade, numeroCsv(p.quantidade, casas(p.unidade)), numeroCsv(p.total, 2)]),
        },
        {
            titulo: 'Vendas',
            colunas: ['Data', 'Cliente', 'Produtos', 'Pagamento', 'Valor (R$)'],
            linhas: rel.vendas.map((x) => [formatarData(x.data), x.cliente, textoItens(x.itens), NOMES_PAGAMENTO[x.pagamento], numeroCsv(x.total, 2)]),
        },
    ];
}

function opcoesPdf(rel) {
    const f = rel.filtros;
    const filtros = [
        ['Clientes', descricaoFiltro(f.clientes)],
        ['Produtos', descricaoFiltro(f.produtos)],
        ['Pagamento', descricaoPagamentos(f)],
    ];
    if (rel.apenasProdutosSelecionados) filtros.push(['Atenção', 'os valores consideram apenas os produtos selecionados']);

    return {
        titulo: 'Relatório de vendas',
        subtitulo: `Período: ${formatarData(f.inicio)} a ${formatarData(f.fim)}`,
        paisagem: true,
        filtros,
        blocos: [
            {
                titulo: 'Resumo',
                colunas: [{ titulo: 'Vendas', alinhar: 'right' }, { titulo: 'Total vendido', alinhar: 'right' },
                    { titulo: 'À vista', alinhar: 'right' }, { titulo: 'A prazo', alinhar: 'right' },
                    { titulo: 'Ticket médio', alinhar: 'right' }],
                linhas: [[String(rel.resumo.quantidadeVendas), formatarMoeda(rel.resumo.total), formatarMoeda(rel.resumo.avista),
                    formatarMoeda(rel.resumo.aprazo), formatarMoeda(rel.resumo.ticketMedio)]],
            },
            {
                titulo: 'Por cliente',
                colunas: [{ titulo: 'Cliente', largura: 4 }, { titulo: 'Vendas', alinhar: 'right' }, { titulo: 'Total', largura: 1.5, alinhar: 'right' }],
                linhas: rel.porCliente.map((c) => [c.cliente, String(c.quantidadeVendas), formatarMoeda(c.total)]),
                totais: ['Total', String(rel.resumo.quantidadeVendas), formatarMoeda(rel.resumo.total)],
                vazio: 'Nenhuma venda no período.',
            },
            {
                titulo: 'Por produto',
                colunas: [{ titulo: 'Produto', largura: 4 }, { titulo: 'Quantidade', alinhar: 'right' }, { titulo: 'Total', largura: 1.5, alinhar: 'right' }],
                linhas: rel.porProduto.map((p) => [p.produto, formatarQuantidade(p.quantidade, p.unidade), formatarMoeda(p.total)]),
                totais: ['Total', '', formatarMoeda(rel.resumo.total)],
                vazio: 'Nenhuma venda no período.',
            },
            {
                titulo: 'Vendas',
                colunas: [{ titulo: 'Data', largura: 1 }, { titulo: 'Cliente', largura: 2.2 }, { titulo: 'Produtos', largura: 4.5 },
                    { titulo: 'Pagamento', largura: 1 }, { titulo: 'Valor', largura: 1.3, alinhar: 'right' }],
                linhas: rel.vendas.map((x) => [formatarData(x.data), x.cliente, textoItens(x.itens), NOMES_PAGAMENTO[x.pagamento], formatarMoeda(x.total)]),
                totais: ['', '', '', 'Total', formatarMoeda(rel.resumo.total)],
                vazio: 'Nenhuma venda no período.',
            },
        ],
    };
}
