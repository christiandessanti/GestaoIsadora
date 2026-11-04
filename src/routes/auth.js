import { Router } from 'express';
import { pool } from '../db.js';
import { conferir } from '../services/senhas.js';
import { minutosBloqueado, registrarFalha, limpar } from '../services/limiteTentativas.js';
import { exigirLogin } from '../middlewares/auth.js';
import { HttpError, invalido } from '../utils/erros.js';

export const authRouter = Router();

const MSG_LOGIN_INVALIDO = 'Usuário ou senha incorretos.';

authRouter.post('/login', async (req, res) => {
    const login = String(req.body?.login ?? '').trim().toLowerCase();
    const senha = String(req.body?.senha ?? '');
    if (!login || !senha) throw invalido('Informe usuário e senha.');

    // Bloqueio por usuário+IP e também por IP (evita testar vários logins).
    const chaves = [`login:${req.ip}:${login}`, `login-ip:${req.ip}`];
    const minutos = Math.max(...chaves.map(minutosBloqueado));
    if (minutos) {
        throw new HttpError(429, `Muitas tentativas erradas. Tente novamente em ${minutos} minuto(s).`);
    }

    const [rows] = await pool.execute(
        'SELECT id, nome, login, perfil, senha_hash, ativo FROM usuarios WHERE login = ?',
        [login],
    );
    const usuario = rows[0];
    const senhaOk = await conferir(senha, usuario?.senha_hash);

    if (!usuario || !senhaOk || !usuario.ativo) {
        chaves.forEach(registrarFalha);
        throw new HttpError(401, MSG_LOGIN_INVALIDO);
    }
    chaves.forEach(limpar);

    // Gera um novo ID de sessão no login (evita "session fixation").
    await new Promise((resolve, reject) =>
        req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.usuarioId = usuario.id;
    await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve())));

    res.json({ id: usuario.id, nome: usuario.nome, login: usuario.login, perfil: usuario.perfil });
});

authRouter.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie('isadora.sid');
        res.json({ ok: true });
    });
});

authRouter.get('/me', exigirLogin, (req, res) => {
    res.json(req.usuario);
});
