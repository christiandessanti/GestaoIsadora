import { Router } from 'express';
import { pool, transacao } from '../db.js';
import { exigirSenhaEspecial } from '../middlewares/auth.js';
import { registrarEdicoes } from '../services/historico.js';
import { relatorioDespesasRouter } from './despesasRelatorio.js';
import * as v from '../utils/validacao.js';
import { invalido, naoEncontrado } from '../utils/erros.js';

export const despesasRouter = Router();

despesasRouter.use('/relatorio', relatorioDespesasRouter);

const POR_PAGINA = 30;

const SELECT_DESPESA = `
    SELECT d.id, d.categoria_id, c.nome AS categoria, c.ativa AS categoria_ativa, d.valor, d.data_despesa,
           d.observacao, u.nome AS usuario, d.criado_em, d.atualizado_em
      FROM despesas d
      JOIN categorias_despesa c ON c.id = d.categoria_id
      JOIN usuarios u ON u.id = d.usuario_id`;

const formatar = (d) => ({ ...d, categoria_ativa: Boolean(d.categoria_ativa) });

async function buscar(conn, id) {
    const [rows] = await conn.execute(`${SELECT_DESPESA} WHERE d.id = ?`, [id]);
    if (!rows.length) throw naoEncontrado('Despesa não encontrada.');
    return formatar(rows[0]);
}

// ---------------------------------------------------------------- Listagem (mais recentes primeiro)
despesasRouter.get('/', async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.apos) {
        const [data, id] = String(req.query.apos).split('_');
        params.push(v.data(data), v.data(data), v.id(id));
        where = 'WHERE (d.data_despesa < ? OR (d.data_despesa = ? AND d.id < ?))';
    }
    const [rows] = await pool.execute(
        `${SELECT_DESPESA} ${where} ORDER BY d.data_despesa DESC, d.id DESC LIMIT ${POR_PAGINA + 1}`,
        params,
    );
    const pagina = rows.slice(0, POR_PAGINA);
    const ultima = pagina.at(-1);
    res.json({
        despesas: pagina.map(formatar),
        proxima: rows.length > POR_PAGINA ? `${ultima.data_despesa}_${ultima.id}` : null,
    });
});

despesasRouter.get('/:id', async (req, res) => {
    res.json(await buscar(pool, v.id(req.params.id)));
});

// ---------------------------------------------------------------- Registrar / editar
function validar(body) {
    return {
        categoriaId: v.id(body?.categoriaId, 'Selecione a categoria.'),
        valor: v.dinheiro(body?.valor),
        dataDespesa: v.data(body?.dataDespesa, 'a data da despesa'),
        observacao: v.texto(body?.observacao, 'a observação', { max: 255, opcional: true }),
    };
}

/** A categoria precisa estar ativa, exceto se já for a categoria da despesa sendo editada. */
async function validarCategoria(conn, categoriaId, categoriaAtual) {
    const [rows] = await conn.execute('SELECT id, nome, ativa FROM categorias_despesa WHERE id = ?', [categoriaId]);
    if (!rows.length) throw invalido('Selecione uma categoria válida.');
    if (!rows[0].ativa && categoriaId !== categoriaAtual) throw invalido('Esta categoria está desativada.');
    return rows[0];
}

despesasRouter.post('/', async (req, res) => {
    const d = validar(req.body);
    await validarCategoria(pool, d.categoriaId);
    const [r] = await pool.execute(
        'INSERT INTO despesas (categoria_id, valor, data_despesa, observacao, usuario_id) VALUES (?, ?, ?, ?, ?)',
        [d.categoriaId, d.valor, d.dataDespesa, d.observacao, req.usuario.id],
    );
    res.status(201).json(await buscar(pool, r.insertId));
});

despesasRouter.put('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const d = validar(req.body);
    await transacao(async (conn) => {
        const [rows] = await conn.execute(
            `SELECT d.*, c.nome AS categoria FROM despesas d
               JOIN categorias_despesa c ON c.id = d.categoria_id
              WHERE d.id = ? FOR UPDATE`, [id]);
        if (!rows.length) throw naoEncontrado('Despesa não encontrada.');
        const atual = rows[0];
        const categoria = await validarCategoria(conn, d.categoriaId, atual.categoria_id);

        await conn.execute(
            'UPDATE despesas SET categoria_id = ?, valor = ?, data_despesa = ?, observacao = ? WHERE id = ?',
            [d.categoriaId, d.valor, d.dataDespesa, d.observacao, id],
        );
        await registrarEdicoes(conn, {
            tabela: 'despesas',
            registroId: id,
            antes: { categoria: atual.categoria, valor: atual.valor, data_despesa: atual.data_despesa, observacao: atual.observacao },
            depois: { categoria: categoria.nome, valor: d.valor, data_despesa: d.dataDespesa, observacao: d.observacao },
            usuarioId: req.usuario.id,
        });
    });
    res.json(await buscar(pool, id));
});

// ---------------------------------------------------------------- Excluir
despesasRouter.delete('/:id', exigirSenhaEspecial, async (req, res) => {
    const id = v.id(req.params.id);
    await transacao(async (conn) => {
        const [rows] = await conn.execute('SELECT id FROM despesas WHERE id = ? FOR UPDATE', [id]);
        if (!rows.length) throw naoEncontrado('Despesa não encontrada.');
        await conn.execute(
            `INSERT INTO despesas_excluidas
                (id, categoria_id, valor, data_despesa, observacao, usuario_id, criado_em, atualizado_em, excluido_por)
             SELECT id, categoria_id, valor, data_despesa, observacao, usuario_id, criado_em, atualizado_em, ?
               FROM despesas WHERE id = ?`,
            [req.usuario.id, id],
        );
        await conn.execute('DELETE FROM despesas WHERE id = ?', [id]);
    });
    res.json({ ok: true });
});
