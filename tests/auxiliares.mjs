/**
 * Funções compartilhadas pelos testes.
 * Os testes rodam contra um servidor iniciado pelo executor (tests/executar.mjs),
 * conectado ao banco de TESTES — nunca ao banco real.
 */

export const URL_BASE = process.env.TESTE_URL;

/** Usuários criados pelo executor antes de cada arquivo de teste. */
export const USUARIOS = {
    ti: { login: 'zzt_ti', senha: 'senha-ti-1234', perfil: 'ti' },
    gerente: { login: 'zzt_ger', senha: 'senha-ger-1234', perfil: 'gerente' },
    comum: { login: 'zzt_com', senha: 'senha-com-1234', perfil: 'comum' },
};

/**
 * Faz login e devolve uma função para chamar a API com a sessão:
 *   const ger = await sessao('gerente');
 *   const { s, d } = await ger('POST', '/api/clientes', { nome: 'X' });
 * s = status HTTP; d = JSON (ou Buffer, para PDF/CSV).
 */
export async function sessao(quem, senha) {
    const login = USUARIOS[quem]?.login ?? quem;
    const r = await fetch(`${URL_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, senha: senha ?? USUARIOS[quem].senha }),
    });
    if (!r.ok) throw new Error(`Falha no login de ${login}: ${r.status} ${await r.text()}`);
    const cookie = r.headers.get('set-cookie')?.split(';')[0];
    return async (method, url, body) => {
        const res = await fetch(URL_BASE + url, {
            method,
            headers: { 'Content-Type': 'application/json', cookie },
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: 'manual',
        });
        const tipo = res.headers.get('content-type') ?? '';
        const d = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
        return { s: res.status, d, headers: res.headers };
    };
}

// ---------------------------------------------------------------- Verificações
let falhas = 0;
let total = 0;

/** Verifica uma condição e imprime ✔ ou ✖. */
export function ok(nome, condicao, detalhe = '') {
    total += 1;
    if (!condicao) falhas += 1;
    console.log(`  ${condicao ? '✔' : '✖'} ${nome}${detalhe !== '' ? ` ${detalhe}` : ''}`);
    return condicao;
}

/** Verifica o status HTTP da resposta e devolve o corpo. */
export function esp(nome, resposta, status) {
    const certo = resposta.s === status;
    ok(nome, certo, certo ? '' : `-> ${resposta.s} (esperado ${status}) ${resposta.d?.erro ?? ''}`);
    return resposta.d;
}

export function secao(titulo) {
    console.log(`\n  --- ${titulo}`);
}

/** Encerra o arquivo de teste: código de saída 1 se houve falha. */
export function finalizar() {
    console.log(`\n  ${falhas ? `✖ ${falhas} de ${total} verificação(ões) falharam` : `✔ ${total} verificações passaram`}`);
    process.exitCode = falhas ? 1 : 0;
}
