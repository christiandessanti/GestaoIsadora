import { Router } from 'express';
import { pool, transacao } from '../db.js';
import { exigirSenhaEspecial } from '../middlewares/auth.js';
import { registrarEdicoes } from '../services/historico.js';
import { validarVenda, buscarItens, resumoItens } from '../services/vendas.js';
import { relatorioVendasRouter } from './vendasRelatorio.js';
import * as v from '../utils/validacao.js';
import { invalido, naoEncontrado } from '../utils/erros.js';

export const vendasRouter = Router();

// O relatório tem rotas próprias (/api/vendas/relatorio...).
vendasRouter.use('/relatorio', relatorioVendasRouter);

const POR_PAGINA = 30;

const SELECT_VENDA = `
    SELECT v.id, v.cliente_id, c.nome AS cliente, c.ativo AS cliente_ativo, v.pagamento, v.data_venda,
           v.valor_total, u.nome AS usuario, v.criado_em, v.atualizado_em
      FROM vendas v
      JOIN clientes c ON c.id = v.cliente_id
      JOIN usuarios u ON u.id = v.usuario_id`;

function formatarVenda(venda, itens) {
    return { ...venda, cliente_ativo: Boolean(venda.cliente_ativo), itens: itens ?? [] };
}

async function buscarVenda(conn, id) {
    const [rows] = await conn.execute(`${SELECT_VENDA} WHERE v.id = ?`, [id]);
    if (!rows.length) throw naoEncontrado('Venda não encontrada.');
    const itens = await buscarItens(conn, [id]);
    return formatarVenda(rows[0], itens.get(id));
}

// ---------------------------------------------------------------- Listagem
/**
 * Vendas mais recentes primeiro, em páginas.
 * Para a próxima página, envie ?apos=<data>_<id> com o valor de "proxima" da resposta anterior.
 */
vendasRouter.get('/', async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.apos) {
        const [data, id] = String(req.query.apos).split('_');
        params.push(v.data(data), v.data(data), v.id(id));
        where = 'WHERE (v.data_venda < ? OR (v.data_venda = ? AND v.id < ?))';
    }
    const [rows] = await pool.execute(
        `${SELECT_VENDA} ${where} ORDER BY v.data_venda DESC, v.id DESC LIMIT ${POR_PAGINA + 1}`,
        params,
    );
    const temMais = rows.length > POR_PAGINA;
    const pagina = rows.slice(0, POR_PAGINA);
    const itens = await buscarItens(pool, pagina.map((r) => r.id));
    const ultima = pagina.at(-1);
    res.json({
        vendas: pagina.map((r) => formatarVenda(r, itens.get(r.id))),
        proxima: temMais ? `${ultima.data_venda}_${ultima.id}` : null,
    });
});

/**
 * Último preço praticado para cada produto, para um cliente.
 * Retorna { produtoId: preco }. Usado para sugerir o preço no formulário.
 */
vendasRouter.get('/ultimos-precos', async (req, res) => {
    const clienteId = v.id(req.query.clienteId);
    const [rows] = await pool.execute(
        `SELECT produto_id, preco_unitario FROM (
             SELECT i.produto_id, i.preco_unitario,
                    ROW_NUMBER() OVER (PARTITION BY i.produto_id ORDER BY ve.data_venda DESC, ve.id DESC) AS ordem
               FROM vendas_itens i
               JOIN vendas ve ON ve.id = i.venda_id
              WHERE ve.cliente_id = ?
         ) t WHERE ordem = 1`,
        [clienteId],
    );
    res.json(Object.fromEntries(rows.map((r) => [r.produto_id, r.preco_unitario])));
});

vendasRouter.get('/:id', async (req, res) => {
    res.json(await buscarVenda(pool, v.id(req.params.id)));
});

// ---------------------------------------------------------------- Registrar / editar
/**
 * Produtos que podem ser usados na venda: os ativos e, na edição,
 * também os que já estavam na venda (mesmo se tiverem sido desativados depois).
 */
async function produtosPermitidos(conn, vendaId) {
    const [rows] = await conn.execute(
        `SELECT id, nome, unidade FROM produtos_venda
          WHERE ativo = TRUE ${vendaId ? 'OR id IN (SELECT produto_id FROM vendas_itens WHERE venda_id = ?)' : ''}`,
        vendaId ? [vendaId] : [],
    );
    return new Map(rows.map((p) => [p.id, p]));
}

async function validarCliente(conn, clienteId, clienteAtualDaVenda) {
    const [rows] = await conn.execute('SELECT id, ativo FROM clientes WHERE id = ?', [clienteId]);
    if (!rows.length) throw invalido('Selecione um cliente válido.');
    if (!rows[0].ativo && clienteId !== clienteAtualDaVenda) throw invalido('Este cliente está desativado.');
}

async function gravarItens(conn, vendaId, itens) {
    for (const i of itens) {
        await conn.execute(
            `INSERT INTO vendas_itens (venda_id, produto_id, quantidade, preco_unitario, subtotal)
             VALUES (?, ?, ?, ?, ?)`,
            [vendaId, i.produtoId, i.quantidade, i.precoUnitario, i.subtotal],
        );
    }
}

vendasRouter.post('/', async (req, res) => {
    const id = await transacao(async (conn) => {
        const venda = validarVenda(req.body, { produtosPorId: await produtosPermitidos(conn) });
        await validarCliente(conn, venda.clienteId);
        const [r] = await conn.execute(
            `INSERT INTO vendas (cliente_id, pagamento, data_venda, valor_total, usuario_id)
             VALUES (?, ?, ?, ?, ?)`,
            [venda.clienteId, venda.pagamento, venda.dataVenda, venda.valorTotal, req.usuario.id],
        );
        await gravarItens(conn, r.insertId, venda.itens);
        return r.insertId;
    });
    res.status(201).json(await buscarVenda(pool, id));
});

vendasRouter.put('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    await transacao(async (conn) => {
        const [rows] = await conn.execute('SELECT * FROM vendas WHERE id = ? FOR UPDATE', [id]);
        if (!rows.length) throw naoEncontrado('Venda não encontrada.');
        const atual = rows[0];
        const itensAntes = (await buscarItens(conn, [id])).get(id);

        const produtosPorId = await produtosPermitidos(conn, id);
        const venda = validarVenda(req.body, { produtosPorId });
        await validarCliente(conn, venda.clienteId, atual.cliente_id);

        await conn.execute(
            'UPDATE vendas SET cliente_id = ?, pagamento = ?, data_venda = ?, valor_total = ? WHERE id = ?',
            [venda.clienteId, venda.pagamento, venda.dataVenda, venda.valorTotal, id],
        );
        await conn.execute('DELETE FROM vendas_itens WHERE venda_id = ?', [id]);
        await gravarItens(conn, id, venda.itens);

        const itensDepois = venda.itens.map((i) => ({ ...i, produto: produtosPorId.get(i.produtoId).nome }));
        const [nomes] = await conn.query('SELECT id, nome FROM clientes WHERE id IN (?)', [[atual.cliente_id, venda.clienteId]]);
        const nomeCliente = (cid) => nomes.find((c) => c.id === cid)?.nome ?? `#${cid}`;
        await registrarEdicoes(conn, {
            tabela: 'vendas',
            registroId: id,
            antes: {
                cliente: nomeCliente(atual.cliente_id), pagamento: atual.pagamento, data_venda: atual.data_venda,
                valor_total: atual.valor_total, itens: resumoItens(itensAntes),
            },
            depois: {
                cliente: nomeCliente(venda.clienteId), pagamento: venda.pagamento, data_venda: venda.dataVenda,
                valor_total: venda.valorTotal, itens: resumoItens(itensDepois),
            },
            usuarioId: req.usuario.id,
        });
    });
    res.json(await buscarVenda(pool, id));
});

// ---------------------------------------------------------------- Excluir
/** Move a venda e seus itens para as tabelas de excluídas. Exige a senha especial. */
vendasRouter.delete('/:id', exigirSenhaEspecial, async (req, res) => {
    const id = v.id(req.params.id);
    await transacao(async (conn) => {
        const [rows] = await conn.execute('SELECT id FROM vendas WHERE id = ? FOR UPDATE', [id]);
        if (!rows.length) throw naoEncontrado('Venda não encontrada.');
        await conn.execute(
            `INSERT INTO vendas_excluidas
                (id, cliente_id, pagamento, data_venda, valor_total, usuario_id, criado_em, atualizado_em, excluido_por)
             SELECT id, cliente_id, pagamento, data_venda, valor_total, usuario_id, criado_em, atualizado_em, ?
               FROM vendas WHERE id = ?`,
            [req.usuario.id, id],
        );
        await conn.execute(
            `INSERT INTO vendas_itens_excluidos (id, venda_id, produto_id, quantidade, preco_unitario, subtotal)
             SELECT id, venda_id, produto_id, quantidade, preco_unitario, subtotal
               FROM vendas_itens WHERE venda_id = ?`,
            [id],
        );
        await conn.execute('DELETE FROM vendas WHERE id = ?', [id]); // os itens saem junto (ON DELETE CASCADE)
    });
    res.json({ ok: true });
});
