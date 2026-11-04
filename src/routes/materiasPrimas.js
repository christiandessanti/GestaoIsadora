import { Router } from 'express';
import { pool, transacao } from '../db.js';
import { exigirPerfil, exigirSenhaEspecial } from '../middlewares/auth.js';
import { registrarEdicoes } from '../services/historico.js';
import { semDuplicidade } from '../utils/mysql.js';
import * as v from '../utils/validacao.js';
import { naoEncontrado } from '../utils/erros.js';

export const materiasPrimasRouter = Router();

const DUPLICADO = 'Já existe uma matéria-prima com esse nome.';
const CAMPOS = `id, nome, unidade, quantidade, ultima_operacao_tipo, ultima_operacao_qtd,
                ultima_alteracao_em, criado_em`;

async function buscar(conn, id, { bloquear = false } = {}) {
    const [rows] = await conn.execute(
        `SELECT ${CAMPOS} FROM materias_primas WHERE id = ?${bloquear ? ' FOR UPDATE' : ''}`, [id]);
    if (!rows.length) throw naoEncontrado('Matéria-prima não encontrada.');
    return rows[0];
}

materiasPrimasRouter.get('/', async (req, res) => {
    const [rows] = await pool.execute(`SELECT ${CAMPOS} FROM materias_primas ORDER BY nome`);
    res.json(rows);
});

materiasPrimasRouter.use(exigirPerfil('ti', 'gerente'));

/** Cria a matéria-prima. O estoque inicial (se maior que zero) vira a primeira movimentação. */
materiasPrimasRouter.post('/', async (req, res) => {
    const nome = v.texto(req.body?.nome, 'o nome');
    const unidade = v.unidade(req.body?.unidade);
    const inicial = v.quantidade(req.body?.estoqueInicial || '0', unidade,
        { campo: 'o estoque inicial', permitirZero: true });
    const temInicial = Number(inicial) > 0;

    const id = await transacao(async (conn) => {
        const [r] = await semDuplicidade(
            conn.execute(
                `INSERT INTO materias_primas
                    (nome, unidade, quantidade, ultima_operacao_tipo, ultima_operacao_qtd, ultima_alteracao_em, criado_por)
                 VALUES (?, ?, ?, ?, ?, ${temInicial ? 'NOW()' : 'NULL'}, ?)`,
                [nome, unidade, inicial, temInicial ? 'inicial' : null, temInicial ? inicial : null, req.usuario.id],
            ),
            DUPLICADO,
        );
        if (temInicial) {
            await conn.execute(
                `INSERT INTO movimentacoes_estoque (materia_prima_id, tipo, quantidade, saldo_apos, observacao, usuario_id)
                 VALUES (?, 'inicial', ?, ?, 'Estoque inicial', ?)`,
                [r.insertId, inicial, inicial, req.usuario.id],
            );
        }
        return r.insertId;
    });
    res.status(201).json(await buscar(pool, id));
});

/** Edita apenas o nome (a unidade não muda, para não distorcer o estoque já lançado). */
materiasPrimasRouter.put('/:id', async (req, res) => {
    const id = v.id(req.params.id);
    const depois = { nome: v.texto(req.body?.nome, 'o nome') };
    await transacao(async (conn) => {
        const antes = await buscar(conn, id, { bloquear: true });
        await semDuplicidade(
            conn.execute('UPDATE materias_primas SET nome = ? WHERE id = ?', [depois.nome, id]),
            DUPLICADO,
        );
        await registrarEdicoes(conn, { tabela: 'materias_primas', registroId: id, antes, depois, usuarioId: req.usuario.id });
    });
    res.json(await buscar(pool, id));
});

/**
 * Exclui a matéria-prima: move o cadastro e todas as movimentações dela
 * para as tabelas de excluídos, mantendo o histórico para relatórios.
 */
materiasPrimasRouter.delete('/:id', exigirSenhaEspecial, async (req, res) => {
    const id = v.id(req.params.id);
    await transacao(async (conn) => {
        await buscar(conn, id, { bloquear: true });
        await conn.execute(
            `INSERT INTO materias_primas_excluidas
                (id, nome, unidade, quantidade, ultima_operacao_tipo, ultima_operacao_qtd,
                 ultima_alteracao_em, criado_por, criado_em, excluido_por)
             SELECT id, nome, unidade, quantidade, ultima_operacao_tipo, ultima_operacao_qtd,
                    ultima_alteracao_em, criado_por, criado_em, ?
               FROM materias_primas WHERE id = ?`,
            [req.usuario.id, id],
        );
        await conn.execute(
            `INSERT INTO movimentacoes_estoque_excluidas
                (id, materia_prima_id, tipo, quantidade, saldo_apos, observacao, usuario_id, criado_em)
             SELECT id, materia_prima_id, tipo, quantidade, saldo_apos, observacao, usuario_id, criado_em
               FROM movimentacoes_estoque WHERE materia_prima_id = ?`,
            [id],
        );
        await conn.execute('DELETE FROM movimentacoes_estoque WHERE materia_prima_id = ?', [id]);
        await conn.execute('DELETE FROM materias_primas WHERE id = ?', [id]);
    });
    res.json({ ok: true });
});
