import { Router } from 'express';
import { pool, transacao } from '../db.js';
import { exigirPerfil } from '../middlewares/auth.js';
import { registrarEdicoes } from '../services/historico.js';
import { semDuplicidade } from '../utils/mysql.js';
import * as v from '../utils/validacao.js';
import { naoEncontrado, conflito } from '../utils/erros.js';

export const produtosVendaRouter = Router();

const DUPLICADO = 'Já existe um produto de venda com esse nome.';
const CAMPOS = 'id, nome, unidade, ativo, criado_em';

async function buscar(conn, id, { bloquear = false } = {}) {
    const [rows] = await conn.execute(
        `SELECT ${CAMPOS} FROM produtos_venda WHERE id = ?${bloquear ? ' FOR UPDATE' : ''}`, [id]);
    if (!rows.length) throw naoEncontrado('Produto de venda não encontrado.');
    return { ...rows[0], ativo: Boolean(rows[0].ativo) };
}

/** Verifica se o produto aparece em alguma venda (inclusive vendas excluídas). */
async function temVendas(conn, id) {
    const [rows] = await conn.execute(
        `SELECT EXISTS(SELECT 1 FROM vendas_itens WHERE produto_id = ?)
             OR EXISTS(SELECT 1 FROM vendas_itens_excluidos WHERE produto_id = ?) AS usado`,
        [id, id],
    );
    return Boolean(rows[0].usado);
}

produtosVendaRouter.get('/', async (req, res) => {
    const todos = req.query.todos === '1';
    const [rows] = await pool.execute(
        `SELECT ${CAMPOS} FROM produtos_venda ${todos ? '' : 'WHERE ativo = TRUE'} ORDER BY ativo DESC, nome`,
    );
    res.json(rows.map((p) => ({ ...p, ativo: Boolean(p.ativo) })));
});

produtosVendaRouter.use(exigirPerfil('ti', 'gerente'));

produtosVendaRouter.post('/', async (req, res) => {
    const nome = v.texto(req.body?.nome, 'o nome');
    const unidade = v.unidade(req.body?.unidade);
    const [r] = await semDuplicidade(
        pool.execute('INSERT INTO produtos_venda (nome, unidade, criado_por) VALUES (?, ?, ?)',
            [nome, unidade, req.usuario.id]),
        DUPLICADO,
    );
    res.status(201).json(await buscar(pool, r.insertId));
});

produtosVendaRouter.put('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const depois = {
        nome: v.texto(req.body?.nome, 'o nome'),
        unidade: v.unidade(req.body?.unidade),
    };
    await transacao(async (conn) => {
        const antes = await buscar(conn, id, { bloquear: true });
        if (antes.unidade !== depois.unidade && await temVendas(conn, id)) {
            throw conflito('A unidade não pode ser alterada porque este produto já tem vendas registradas.');
        }
        await semDuplicidade(
            conn.execute('UPDATE produtos_venda SET nome = ?, unidade = ? WHERE id = ?',
                [depois.nome, depois.unidade, id]),
            DUPLICADO,
        );
        await registrarEdicoes(conn, { tabela: 'produtos_venda', registroId: id, antes, depois, usuarioId: req.usuario.id });
    });
    res.json(await buscar(pool, id));
});

produtosVendaRouter.patch('/:id/ativo', async (req, res) => {
    const id = v.id(req.params.id);
    const ativo = v.booleano(req.body?.ativo, 'ativo');
    await buscar(pool, id);
    await pool.execute('UPDATE produtos_venda SET ativo = ? WHERE id = ?', [ativo, id]);
    res.json({ ok: true });
});
