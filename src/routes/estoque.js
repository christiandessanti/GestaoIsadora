import { Router } from 'express';
import { pool, transacao } from '../db.js';
import * as v from '../utils/validacao.js';
import { conflito, invalido, naoEncontrado } from '../utils/erros.js';
import {
    formatarData, formatarDataHora, formatarQuantidade, paraMilesimos, deMilesimos,
} from '../utils/formato.js';
import { enviarCsv, numeroCsv } from '../services/csv.js';
import { enviarPdf } from '../services/pdf.js';

export const estoqueRouter = Router();

const NOMES_TIPO = { inicial: 'Estoque inicial', entrada: 'Entrada', saida: 'Saída' };
const NOMES_STATUS = { ativos: 'Somente ativos', ambos: 'Ativos e excluídos', excluidos: 'Somente excluídos' };

// =============================================================== Movimentação
/**
 * Registra uma entrada ou saída. Disponível para todos os perfis.
 * Bloqueia a linha do produto (FOR UPDATE) para que duas movimentações
 * simultâneas não calculem o saldo errado.
 */
estoqueRouter.post('/movimentacoes', async (req, res) => {
    const materiaPrimaId = v.id(req.body?.materiaPrimaId);
    const tipo = req.body?.tipo;
    if (!['entrada', 'saida'].includes(tipo)) throw invalido('Tipo de movimentação inválido.');
    const observacao = v.texto(req.body?.observacao, 'a observação', { max: 255, opcional: true });

    const produto = await transacao(async (conn) => {
        const [rows] = await conn.execute(
            'SELECT id, nome, unidade, quantidade FROM materias_primas WHERE id = ? FOR UPDATE',
            [materiaPrimaId],
        );
        if (!rows.length) throw naoEncontrado('Matéria-prima não encontrada.');
        const mp = rows[0];

        const qtd = v.quantidade(req.body?.quantidade, mp.unidade);
        const atual = paraMilesimos(mp.quantidade);
        const novo = tipo === 'entrada' ? atual + paraMilesimos(qtd) : atual - paraMilesimos(qtd);
        if (novo < 0) {
            throw conflito(`Estoque insuficiente. Disponível: ${formatarQuantidade(mp.quantidade, mp.unidade)}.`);
        }
        const saldo = deMilesimos(novo).toFixed(3);

        await conn.execute(
            `UPDATE materias_primas
                SET quantidade = ?, ultima_operacao_tipo = ?, ultima_operacao_qtd = ?, ultima_alteracao_em = NOW()
              WHERE id = ?`,
            [saldo, tipo, qtd, mp.id],
        );
        await conn.execute(
            `INSERT INTO movimentacoes_estoque (materia_prima_id, tipo, quantidade, saldo_apos, observacao, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [mp.id, tipo, qtd, saldo, observacao, req.usuario.id],
        );
        const [atualizado] = await conn.execute(
            `SELECT id, nome, unidade, quantidade, ultima_operacao_tipo, ultima_operacao_qtd, ultima_alteracao_em
               FROM materias_primas WHERE id = ?`, [mp.id]);
        return atualizado[0];
    });
    res.status(201).json(produto);
});

// =============================================================== Relatório
/** Produtos disponíveis para o filtro do relatório, conforme o status. */
estoqueRouter.get('/relatorio/produtos', async (req, res) => {
    const status = lerStatus(req.query.status);
    res.json(await listarProdutos(status));
});

/**
 * Relatório de movimentações.
 * Parâmetros: inicio, fim (AAAA-MM-DD), status (ativos|ambos|excluidos),
 *             produtos (ids separados por vírgula; vazio = todos), formato (json|csv|pdf)
 */
estoqueRouter.get('/relatorio', async (req, res) => {
    const filtros = lerFiltros(req.query);
    const relatorio = await montarRelatorio(filtros);
    const formato = req.query.formato ?? 'json';
    const nomeArquivo = `relatorio-estoque_${filtros.inicio}_a_${filtros.fim}`;

    if (formato === 'csv') return enviarCsv(res, `${nomeArquivo}.csv`, blocosCsv(relatorio));
    if (formato === 'pdf') return enviarPdf(res, `${nomeArquivo}.pdf`, opcoesPdf(relatorio));
    res.json(relatorio);
});

function lerStatus(valor = 'ativos') {
    if (!NOMES_STATUS[valor]) throw invalido('Status inválido. Use: ativos, ambos ou excluidos.');
    return valor;
}

function lerFiltros(q) {
    const inicio = v.data(q.inicio, 'a data inicial');
    const fim = v.data(q.fim, 'a data final');
    if (inicio > fim) throw invalido('A data inicial não pode ser maior que a data final.');
    const status = lerStatus(q.status);
    const produtos = q.produtos
        ? [...new Set(String(q.produtos).split(',').filter(Boolean).map(v.id))]
        : null;
    if (produtos && produtos.length > 1000) throw invalido('Selecione menos produtos.');
    return { inicio, fim, status, produtos };
}

/** Une produtos ativos e excluídos (o id é único entre as duas tabelas). */
async function listarProdutos(status) {
    const partes = [];
    if (status !== 'excluidos') partes.push('SELECT id, nome, unidade, quantidade, FALSE AS excluido FROM materias_primas');
    if (status !== 'ativos') partes.push('SELECT id, nome, unidade, quantidade, TRUE AS excluido FROM materias_primas_excluidas');
    const [rows] = await pool.query(`${partes.join(' UNION ALL ')} ORDER BY nome, id`);
    return rows.map((p) => ({ ...p, excluido: Boolean(p.excluido) }));
}

async function montarRelatorio(filtros) {
    let produtos = await listarProdutos(filtros.status);
    if (filtros.produtos) {
        const selecionados = new Set(filtros.produtos);
        produtos = produtos.filter((p) => selecionados.has(p.id));
    }

    const ids = produtos.map((p) => p.id);
    let movimentacoes = [];
    const saldoAnterior = new Map();

    if (ids.length) {
        const marcadores = ids.map(() => '?').join(',');
        const uniao = `
            SELECT id, materia_prima_id, tipo, quantidade, saldo_apos, observacao, usuario_id, criado_em
              FROM movimentacoes_estoque WHERE materia_prima_id IN (${marcadores})
            UNION ALL
            SELECT id, materia_prima_id, tipo, quantidade, saldo_apos, observacao, usuario_id, criado_em
              FROM movimentacoes_estoque_excluidas WHERE materia_prima_id IN (${marcadores})`;
        const fimExclusivo = `${filtros.fim} 23:59:59`;

        const [movs] = await pool.execute(
            `SELECT m.*, u.nome AS usuario
               FROM (${uniao}) m
               JOIN usuarios u ON u.id = m.usuario_id
              WHERE m.criado_em >= ? AND m.criado_em <= ?
              ORDER BY m.criado_em, m.id`,
            [...ids, ...ids, `${filtros.inicio} 00:00:00`, fimExclusivo],
        );
        movimentacoes = movs;

        // Estoque de cada produto no início do período = saldo após a última movimentação anterior.
        const [anteriores] = await pool.execute(
            `SELECT materia_prima_id, saldo_apos FROM (
                 SELECT materia_prima_id, saldo_apos,
                        ROW_NUMBER() OVER (PARTITION BY materia_prima_id ORDER BY criado_em DESC, id DESC) AS ordem
                   FROM (${uniao}) m
                  WHERE m.criado_em < ?
             ) t WHERE ordem = 1`,
            [...ids, ...ids, `${filtros.inicio} 00:00:00`],
        );
        for (const a of anteriores) saldoAnterior.set(a.materia_prima_id, paraMilesimos(a.saldo_apos));
    }

    const porProduto = new Map(produtos.map((p) => [p.id, {
        id: p.id, nome: p.nome, unidade: p.unidade, excluido: p.excluido,
        inicial: saldoAnterior.get(p.id) ?? 0, entradas: 0, saidas: 0,
    }]));
    for (const m of movimentacoes) {
        const r = porProduto.get(m.materia_prima_id);
        if (m.tipo === 'saida') r.saidas += paraMilesimos(m.quantidade);
        else r.entradas += paraMilesimos(m.quantidade);
    }

    const resumo = [...porProduto.values()].map((r) => ({
        id: r.id,
        nome: r.nome,
        unidade: r.unidade,
        excluido: r.excluido,
        estoqueInicial: deMilesimos(r.inicial),
        entradas: deMilesimos(r.entradas),
        saidas: deMilesimos(r.saidas),
        saldo: deMilesimos(r.entradas - r.saidas),
        estoqueFinal: deMilesimos(r.inicial + r.entradas - r.saidas),
    }));

    const nomes = new Map(produtos.map((p) => [p.id, p]));
    return {
        filtros,
        resumo,
        movimentacoes: movimentacoes.map((m) => ({
            id: m.id,
            data: m.criado_em,
            produto: nomes.get(m.materia_prima_id).nome,
            unidade: nomes.get(m.materia_prima_id).unidade,
            excluido: nomes.get(m.materia_prima_id).excluido,
            tipo: m.tipo,
            quantidade: Number(m.quantidade),
            saldoApos: Number(m.saldo_apos),
            observacao: m.observacao,
            usuario: m.usuario,
        })),
    };
}

// =============================================================== Exportação
// Funciona tanto para o resumo (campo "nome") quanto para as movimentações (campo "produto").
const nomeProduto = (r) => `${r.nome ?? r.produto}${r.excluido ? ' (excluído)' : ''}`;
const sinal = (tipo) => (tipo === 'saida' ? '-' : '+');

function descricaoProdutos(relatorio) {
    if (!relatorio.filtros.produtos) return 'Todos';
    return relatorio.resumo.map((r) => r.nome).join(', ') || 'Nenhum';
}

function blocosCsv(rel) {
    const casas = (u) => (v.UNIDADES_INTEIRAS.includes(u) ? 0 : 1);
    return [
        {
            titulo: `Relatório de estoque - ${formatarData(rel.filtros.inicio)} a ${formatarData(rel.filtros.fim)} - ${NOMES_STATUS[rel.filtros.status]}`,
            colunas: ['Produto', 'Unidade', 'Status', 'Estoque no início', 'Entradas', 'Saídas', 'Saldo do período', 'Estoque no fim'],
            linhas: rel.resumo.map((r) => [
                r.nome, r.unidade, r.excluido ? 'Excluído' : 'Ativo',
                numeroCsv(r.estoqueInicial, casas(r.unidade)), numeroCsv(r.entradas, casas(r.unidade)),
                numeroCsv(r.saidas, casas(r.unidade)), numeroCsv(r.saldo, casas(r.unidade)),
                numeroCsv(r.estoqueFinal, casas(r.unidade)),
            ]),
        },
        {
            titulo: 'Movimentações',
            colunas: ['Data/hora', 'Produto', 'Unidade', 'Tipo', 'Quantidade', 'Saldo após', 'Observação', 'Usuário'],
            linhas: rel.movimentacoes.map((m) => [
                formatarDataHora(m.data), nomeProduto(m), m.unidade, NOMES_TIPO[m.tipo],
                numeroCsv(m.tipo === 'saida' ? -m.quantidade : m.quantidade, casas(m.unidade)),
                numeroCsv(m.saldoApos, casas(m.unidade)), m.observacao ?? '', m.usuario,
            ]),
        },
    ];
}

function opcoesPdf(rel) {
    const q = formatarQuantidade;
    return {
        titulo: 'Relatório de estoque',
        subtitulo: `Período: ${formatarData(rel.filtros.inicio)} a ${formatarData(rel.filtros.fim)}`,
        paisagem: true,
        filtros: [
            ['Produtos', NOMES_STATUS[rel.filtros.status]],
            ['Selecionados', descricaoProdutos(rel)],
        ],
        blocos: [
            {
                titulo: 'Resumo por produto',
                colunas: [
                    { titulo: 'Produto', largura: 3 },
                    { titulo: 'Estoque no início', largura: 1.4, alinhar: 'right' },
                    { titulo: 'Entradas', largura: 1.3, alinhar: 'right' },
                    { titulo: 'Saídas', largura: 1.3, alinhar: 'right' },
                    { titulo: 'Saldo do período', largura: 1.4, alinhar: 'right' },
                    { titulo: 'Estoque no fim', largura: 1.4, alinhar: 'right' },
                ],
                linhas: rel.resumo.map((r) => [
                    nomeProduto(r), q(r.estoqueInicial, r.unidade), `+${q(r.entradas, r.unidade)}`,
                    `${r.saidas ? '-' : ''}${q(r.saidas, r.unidade)}`,
                    `${r.saldo > 0 ? '+' : r.saldo < 0 ? '-' : ''}${q(Math.abs(r.saldo), r.unidade)}`,
                    q(r.estoqueFinal, r.unidade),
                ]),
                vazio: 'Nenhum produto selecionado.',
            },
            {
                titulo: 'Movimentações',
                colunas: [
                    { titulo: 'Data/hora', largura: 1.3 },
                    { titulo: 'Produto', largura: 2.2 },
                    { titulo: 'Tipo', largura: 1.1 },
                    { titulo: 'Quantidade', largura: 1.1, alinhar: 'right' },
                    { titulo: 'Saldo após', largura: 1.1, alinhar: 'right' },
                    { titulo: 'Observação', largura: 2.4 },
                    { titulo: 'Usuário', largura: 1.2 },
                ],
                linhas: rel.movimentacoes.map((m) => [
                    formatarDataHora(m.data), nomeProduto(m), NOMES_TIPO[m.tipo],
                    `${sinal(m.tipo)}${q(m.quantidade, m.unidade)}`, q(m.saldoApos, m.unidade),
                    m.observacao ?? '', m.usuario,
                ]),
                vazio: 'Nenhuma movimentação no período.',
            },
        ],
    };
}
