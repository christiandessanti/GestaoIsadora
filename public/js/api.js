/**
 * Chamada à API do servidor (JSON).
 * - Sessão expirada (401): volta para a tela de login.
 * - Outros erros: lança um Error com a mensagem enviada pelo servidor.
 */
export async function api(url, { method = 'GET', body } = {}) {
    const opcoes = {
        method,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
    };
    if (body !== undefined) {
        opcoes.headers['Content-Type'] = 'application/json';
        opcoes.body = JSON.stringify(body);
    }

    let resposta;
    try {
        resposta = await fetch(url, opcoes);
    } catch {
        throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.');
    }

    const dados = resposta.headers.get('Content-Type')?.includes('application/json')
        ? await resposta.json()
        : null;

    if (resposta.status === 401 && !url.startsWith('/api/auth/login')) {
        window.location.href = '/';
        throw new Error(dados?.erro ?? 'Sessão expirada.');
    }
    if (!resposta.ok) {
        throw new Error(dados?.erro ?? `Erro ${resposta.status}`);
    }
    return dados;
}

/**
 * Baixa um arquivo gerado pelo servidor (PDF/CSV).
 * Usa fetch para conseguir mostrar a mensagem de erro, se houver.
 */
export async function baixarArquivo(url) {
    let resposta;
    try {
        resposta = await fetch(url, { credentials: 'same-origin' });
    } catch {
        throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão.');
    }
    if (resposta.status === 401) {
        window.location.href = '/';
        return;
    }
    if (!resposta.ok) {
        const dados = await resposta.json().catch(() => null);
        throw new Error(dados?.erro ?? `Erro ${resposta.status}`);
    }
    const nome = /filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') ?? '')?.[1] ?? 'arquivo';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await resposta.blob());
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
