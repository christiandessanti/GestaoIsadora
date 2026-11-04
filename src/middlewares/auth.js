import path from 'node:path';
import { pool } from '../db.js';
import { naoAutenticado, proibido, HttpError } from '../utils/erros.js';
import { conferirSenhaEspecial } from '../services/senhas.js';
import { minutosBloqueado, registrarFalha, limpar } from '../services/limiteTentativas.js';

/**
 * Carrega o usuário da sessão a cada requisição.
 * Consultar o banco toda vez garante que um usuário desativado
 * perca o acesso imediatamente, mesmo com a sessão aberta.
 */
export async function carregarUsuario(req, res, next) {
    const id = req.session?.usuarioId;
    if (!id) return next();

    const [rows] = await pool.execute(
        'SELECT id, nome, login, perfil FROM usuarios WHERE id = ? AND ativo = TRUE',
        [id],
    );
    if (rows.length) {
        req.usuario = rows[0];
    } else {
        await new Promise((resolve) => req.session.destroy(resolve));
    }
    next();
}

/** Bloqueia rotas da API para quem não está logado. */
export function exigirLogin(req, res, next) {
    if (!req.usuario) throw naoAutenticado();
    next();
}

/** Libera a rota apenas para os perfis informados. Ex.: exigirPerfil('ti', 'gerente') */
export function exigirPerfil(...perfis) {
    return (req, res, next) => {
        if (!req.usuario) throw naoAutenticado();
        if (!perfis.includes(req.usuario.perfil)) throw proibido();
        next();
    };
}

/**
 * Exige a senha especial (ou a senha do TI) no campo "senhaEspecial" do corpo da requisição.
 * Tentativas erradas contam para o bloqueio temporário do usuário.
 */
export async function exigirSenhaEspecial(req, res, next) {
    const chave = `especial:${req.usuario.id}`;
    const minutos = minutosBloqueado(chave);
    if (minutos) {
        throw new HttpError(429, `Muitas tentativas erradas. Tente novamente em ${minutos} minuto(s).`);
    }
    if (!await conferirSenhaEspecial(req.body?.senhaEspecial)) {
        registrarFalha(chave);
        throw new HttpError(403, 'Senha especial incorreta.');
    }
    limpar(chave);
    next();
}

/**
 * Protege as páginas HTML: sem login, redireciona para a tela de login.
 * Com login, a tela de login redireciona para o início.
 * CSS, imagens e scripts continuam acessíveis (a tela de login precisa deles).
 */
const PAGINAS_PUBLICAS = new Set(['/', '/index', '/index.html']);

export function protegerPaginas(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const ext = path.extname(req.path);
    const ehPagina = ext === '' || ext === '.html';
    if (!ehPagina) return next();

    // Evita que o navegador mostre páginas do cache depois do logout.
    res.set('Cache-Control', 'no-store');

    if (PAGINAS_PUBLICAS.has(req.path)) {
        return req.usuario ? res.redirect('/main') : next();
    }
    if (!req.usuario) return res.redirect('/');
    next();
}
