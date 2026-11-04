/**
 * Registra no histórico_edicoes cada campo que mudou numa edição.
 * Deve ser chamado dentro da mesma transação da alteração.
 */
export async function registrarEdicoes(conn, { tabela, registroId, antes, depois, usuarioId }) {
    for (const campo of Object.keys(depois)) {
        const antigo = normalizar(antes[campo]);
        const novo = normalizar(depois[campo]);
        if (antigo === novo) continue;
        await conn.execute(
            `INSERT INTO historico_edicoes (tabela, registro_id, campo, valor_antigo, valor_novo, usuario_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [tabela, registroId, campo, antigo, novo, usuarioId],
        );
    }
}

function normalizar(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    // Remove zeros à direita de decimais ("12.500" -> "12.5") para comparar valores iguais.
    const s = String(v);
    return /^-?\d+\.\d+$/.test(s) ? s.replace(/\.?0+$/, '') : s;
}
