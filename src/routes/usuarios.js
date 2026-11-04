import { Router } from 'express';
import { pool } from '../db.js';
import { exigirPerfil } from '../middlewares/auth.js';
import { conferir, gerarHash } from '../services/senhas.js';
import { minutosBloqueado, registrarFalha, limpar } from '../services/limiteTentativas.js';
import { semDuplicidade } from '../utils/mysql.js';
import * as v from '../utils/validacao.js';
import { HttpError, invalido, naoEncontrado, proibido } from '../utils/erros.js';

export const usuariosRouter = Router();

const CAMPOS = 'id, nome, login, perfil, ativo, criado_em';

/**
 * Regras para desativar/reativar:
 * - ninguém altera o TI, nem a si mesmo;
 * - o TI altera qualquer outro usuário;
 * - o gerente altera apenas usuários comuns.
 */
export function podeAlterarStatus(ator, alvo) {
    if (alvo.perfil === 'ti' || ator.id === alvo.id) return false;
    if (ator.perfil === 'ti') return true;
    return ator.perfil === 'gerente' && alvo.perfil === 'comum';
}

async function buscar(id) {
    const [rows] = await pool.execute(`SELECT ${CAMPOS} FROM usuarios WHERE id = ?`, [id]);
    if (!rows.length) throw naoEncontrado('Usuário não encontrado.');
    return rows[0];
}

// ---------- Própria senha (todos os perfis) ----------
usuariosRouter.put('/me/senha', async (req, res) => {
    const chave = `minha-senha:${req.usuario.id}`;
    const minutos = minutosBloqueado(chave);
    if (minutos) throw new HttpError(429, `Muitas tentativas erradas. Tente novamente em ${minutos} minuto(s).`);

    const nova = v.novaSenha(req.body?.novaSenha, req.body?.confirmacao);
    const [rows] = await pool.execute('SELECT senha_hash FROM usuarios WHERE id = ?', [req.usuario.id]);
    if (!await conferir(req.body?.senhaAtual, rows[0]?.senha_hash)) {
        registrarFalha(chave);
        throw invalido('A senha atual está incorreta.');
    }
    limpar(chave);

    await pool.execute('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [await gerarHash(nova), req.usuario.id]);
    res.json({ ok: true });
});

// ---------- Gestão de usuários (TI e gerentes) ----------
usuariosRouter.use(exigirPerfil('ti', 'gerente'));

usuariosRouter.get('/', async (req, res) => {
    const [rows] = await pool.execute(
        `SELECT ${CAMPOS} FROM usuarios ORDER BY ativo DESC, FIELD(perfil, 'ti', 'gerente', 'comum'), nome`,
    );
    res.json(rows.map((u) => ({
        ...u,
        ativo: Boolean(u.ativo),
        podeAlterarStatus: podeAlterarStatus(req.usuario, u),
        podeRedefinirSenha: req.usuario.perfil === 'ti' && u.id !== req.usuario.id,
    })));
});

usuariosRouter.post('/', async (req, res) => {
    const nome = v.texto(req.body?.nome, 'o nome', { max: 100 });
    const login = v.texto(req.body?.login, 'o login', { min: 3, max: 50 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(login)) {
        throw invalido('O login pode ter apenas letras sem acento, números, ponto, hífen e sublinhado.');
    }
    const senha = v.novaSenha(req.body?.senha, req.body?.confirmacao);
    const perfil = req.body?.gerente === true ? 'gerente' : 'comum';

    const [r] = await semDuplicidade(
        pool.execute(
            'INSERT INTO usuarios (nome, login, senha_hash, perfil, criado_por) VALUES (?, ?, ?, ?, ?)',
            [nome, login, await gerarHash(senha), perfil, req.usuario.id],
        ),
        'Já existe um usuário com esse login.',
    );
    res.status(201).json(await buscar(r.insertId));
});

usuariosRouter.patch('/:id/ativo', async (req, res) => {
    const alvo = await buscar(v.id(req.params.id));
    const ativo = v.booleano(req.body?.ativo, 'ativo');
    if (!podeAlterarStatus(req.usuario, alvo)) throw proibido('Você não pode alterar o status deste usuário.');

    await pool.execute('UPDATE usuarios SET ativo = ? WHERE id = ?', [ativo, alvo.id]);
    res.json({ ok: true });
});

// Somente o TI redefine a senha de outro usuário, sem precisar da senha antiga.
usuariosRouter.put('/:id/senha', exigirPerfil('ti'), async (req, res) => {
    const alvo = await buscar(v.id(req.params.id));
    if (alvo.id === req.usuario.id) throw invalido('Para a sua própria senha, use "Minha senha".');
    const nova = v.novaSenha(req.body?.novaSenha, req.body?.confirmacao);

    await pool.execute('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [await gerarHash(nova), alvo.id]);
    res.json({ ok: true });
});
