import { Router } from 'express';
import { pool } from '../db.js';
import { exigirPerfil, exigirSenhaEspecial } from '../middlewares/auth.js';
import { gerarHash } from '../services/senhas.js';
import * as v from '../utils/validacao.js';

export const configuracoesRouter = Router();

/**
 * Altera a senha especial. Exige a senha especial atual (ou a senha do TI)
 * no campo "senhaEspecial", conferida pelo middleware.
 */
configuracoesRouter.put(
    '/senha-especial',
    exigirPerfil('ti', 'gerente'),
    exigirSenhaEspecial,
    async (req, res) => {
        const nova = v.novaSenha(req.body?.novaSenha, req.body?.confirmacao, { min: 6 });
        await pool.execute(
            `INSERT INTO configuracoes (chave, valor, atualizado_por) VALUES ('senha_especial_hash', ?, ?)
             ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_por = VALUES(atualizado_por)`,
            [await gerarHash(nova), req.usuario.id],
        );
        res.json({ ok: true });
    },
);
