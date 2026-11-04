import { Router } from 'express';
import { pool, transacao } from '../db.js';
import { exigirPerfil } from '../middlewares/auth.js';
import { registrarEdicoes } from '../services/historico.js';
import { semDuplicidade } from '../utils/mysql.js';
import * as v from '../utils/validacao.js';
import { naoEncontrado } from '../utils/erros.js';

export const clientesRouter = Router();

const DUPLICADO = 'Já existe um cliente com esse nome.';
const CAMPOS = 'id, nome, telefone, ativo, criado_em';

async function buscar(conn, id, { bloquear = false } = {}) {
    const [rows] = await conn.execute(
        `SELECT ${CAMPOS} FROM clientes WHERE id = ?${bloquear ? ' FOR UPDATE' : ''}`, [id]);
    if (!rows.length) throw naoEncontrado('Cliente não encontrado.');
    return { ...rows[0], ativo: Boolean(rows[0].ativo) };
}

// Lista: todos os usuários logados (necessária para registrar vendas).
// ?todos=1 inclui os desativados.
clientesRouter.get('/', async (req, res) => {
    const todos = req.query.todos === '1';
    const [rows] = await pool.execute(
        `SELECT ${CAMPOS} FROM clientes ${todos ? '' : 'WHERE ativo = TRUE'} ORDER BY ativo DESC, nome`,
    );
    res.json(rows.map((c) => ({ ...c, ativo: Boolean(c.ativo) })));
});

clientesRouter.use(exigirPerfil('ti', 'gerente'));

clientesRouter.post('/', async (req, res) => {
    const nome = v.texto(req.body?.nome, 'o nome', { max: 150 });
    const telefone = v.telefone(req.body?.telefone);
    const [r] = await semDuplicidade(
        pool.execute('INSERT INTO clientes (nome, telefone, criado_por) VALUES (?, ?, ?)',
            [nome, telefone, req.usuario.id]),
        DUPLICADO,
    );
    res.status(201).json(await buscar(pool, r.insertId));
});

clientesRouter.put('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const depois = {
        nome: v.texto(req.body?.nome, 'o nome', { max: 150 }),
        telefone: v.telefone(req.body?.telefone),
    };
    await transacao(async (conn) => {
        const antes = await buscar(conn, id, { bloquear: true });
        await semDuplicidade(
            conn.execute('UPDATE clientes SET nome = ?, telefone = ? WHERE id = ?',
                [depois.nome, depois.telefone, id]),
            DUPLICADO,
        );
        await registrarEdicoes(conn, { tabela: 'clientes', registroId: id, antes, depois, usuarioId: req.usuario.id });
    });
    res.json(await buscar(pool, id));
});

clientesRouter.patch('/:id/ativo', async (req, res) => {
    const id = v.id(req.params.id);
    const ativo = v.booleano(req.body?.ativo, 'ativo');
    await buscar(pool, id);
    await pool.execute('UPDATE clientes SET ativo = ? WHERE id = ?', [ativo, id]);
    res.json({ ok: true });
});
