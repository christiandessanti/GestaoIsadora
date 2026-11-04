import bcrypt from 'bcrypt';
import { pool } from '../db.js';

export const BCRYPT_ROUNDS = 12;

// Hash fictício usado quando o usuário não existe, para que a resposta demore
// o mesmo tempo e não revele quais logins existem.
const HASH_FICTICIO = bcrypt.hashSync('senha-ficticia-para-tempo-constante', BCRYPT_ROUNDS);

export const gerarHash = (senha) => bcrypt.hash(senha, BCRYPT_ROUNDS);

/** Compara a senha com o hash. Se o hash não existir, compara com um fictício e retorna false. */
export async function conferir(senha, hash) {
    const ok = await bcrypt.compare(String(senha ?? ''), hash ?? HASH_FICTICIO);
    return Boolean(hash) && ok;
}

/**
 * Valida a senha que libera operações protegidas (ex.: exclusões).
 * Aceita a senha especial OU a senha de login de qualquer usuário TI ativo.
 */
export async function conferirSenhaEspecial(senha) {
    if (!senha) return false;

    const [cfg] = await pool.execute(
        "SELECT valor FROM configuracoes WHERE chave = 'senha_especial_hash'",
    );
    if (cfg.length && await bcrypt.compare(senha, cfg[0].valor)) return true;

    const [tis] = await pool.execute(
        "SELECT senha_hash FROM usuarios WHERE perfil = 'ti' AND ativo = TRUE",
    );
    for (const ti of tis) {
        if (await bcrypt.compare(senha, ti.senha_hash)) return true;
    }
    return false;
}
