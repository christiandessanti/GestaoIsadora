import { Router } from 'express';
import { pool, transacao } from '../db.js';
import { exigirPerfil, exigirSenhaEspecial } from '../middlewares/auth.js';
import { registrarEdicoes } from '../services/historico.js';
import { semDuplicidade } from '../utils/mysql.js';
import * as v from '../utils/validacao.js';
import { naoEncontrado, conflito } from '../utils/erros.js';

export const categoriasRouter = Router();

const DUPLICADO = 'Já existe uma categoria com esse nome.';

async function buscar(conn, id, { bloquear = false } = {}) {
    const [rows] = await conn.execute(
        `SELECT id, nome, ativa FROM categorias_despesa WHERE id = ?${bloquear ? ' FOR UPDATE' : ''}`, [id]);
    if (!rows.length) throw naoEncontrado('Categoria não encontrada.');
    return { ...rows[0], ativa: Boolean(rows[0].ativa) };
}

// Lista com indicação de uso (categorias com registros não podem ser excluídas).
categoriasRouter.get('/', async (req, res) => {
    const todas = req.query.todas === '1';
    const [rows] = await pool.execute(
        `SELECT c.id, c.nome, c.ativa,
                (EXISTS(SELECT 1 FROM despesas d WHERE d.categoria_id = c.id)
                 OR EXISTS(SELECT 1 FROM despesas_excluidas de WHERE de.categoria_id = c.id)) AS tem_registros
           FROM categorias_despesa c
          ${todas ? '' : 'WHERE c.ativa = TRUE'}
          ORDER BY c.ativa DESC, c.nome`,
    );
    res.json(rows.map((c) => ({ ...c, ativa: Boolean(c.ativa), tem_registros: Boolean(c.tem_registros) })));
});

categoriasRouter.use(exigirPerfil('ti', 'gerente'));

categoriasRouter.post('/', async (req, res) => {
    const nome = v.texto(req.body?.nome, 'o nome');
    const [r] = await semDuplicidade(
        pool.execute('INSERT INTO categorias_despesa (nome) VALUES (?)', [nome]),
        DUPLICADO,
    );
    res.status(201).json(await buscar(pool, r.insertId));
});

// Renomear
categoriasRouter.put('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const depois = { nome: v.texto(req.body?.nome, 'o nome') };
    await transacao(async (conn) => {
        const antes = await buscar(conn, id, { bloquear: true });
        await semDuplicidade(
            conn.execute('UPDATE categorias_despesa SET nome = ? WHERE id = ?', [depois.nome, id]),
            DUPLICADO,
        );
        await registrarEdicoes(conn, { tabela: 'categorias_despesa', registroId: id, antes, depois, usuarioId: req.usuario.id });
    });
    res.json(await buscar(pool, id));
});

categoriasRouter.patch('/:id/ativa', async (req, res) => {
    const id = v.id(req.params.id);
    const ativa = v.booleano(req.body?.ativa, 'ativa');
    await buscar(pool, id);
    await pool.execute('UPDATE categorias_despesa SET ativa = ? WHERE id = ?', [ativa, id]);
    res.json({ ok: true });
});

// Excluir: só se nunca teve despesas (nem excluídas). Exige senha especial.
categoriasRouter.delete('/:id', exigirSenhaEspecial, async (req, res) => {
    const id = v.id(req.params.id);
    await buscar(pool, id);
    try {
        await pool.execute('DELETE FROM categorias_despesa WHERE id = ?', [id]);
    } catch (err) {
        // A chave estrangeira impede excluir categoria que tenha despesas.
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            throw conflito('Esta categoria possui despesas registradas. Ela pode apenas ser renomeada ou desativada.');
        }
        throw err;
    }
    res.json({ ok: true });
});
