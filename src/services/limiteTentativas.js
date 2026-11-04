/**
 * Limita tentativas de senha erradas (proteção contra força bruta).
 *
 * Após MAX_FALHAS erros dentro da JANELA, a chave fica bloqueada por BLOQUEIO.
 * Os dados ficam em memória: suficiente para um único servidor (VPS).
 * Ao reiniciar o servidor, os contadores são zerados.
 */
const MAX_FALHAS = 5;
const JANELA_MS = 15 * 60 * 1000;
const BLOQUEIO_MS = 15 * 60 * 1000;

const registros = new Map(); // chave -> { falhas, primeiraFalha, bloqueadoAte }

function obter(chave) {
    const agora = Date.now();
    const r = registros.get(chave);
    if (!r) return null;
    const expirado = r.bloqueadoAte
        ? agora >= r.bloqueadoAte
        : agora - r.primeiraFalha > JANELA_MS;
    if (expirado) {
        registros.delete(chave);
        return null;
    }
    return r;
}

/** Retorna os minutos restantes de bloqueio, ou 0 se a chave estiver liberada. */
export function minutosBloqueado(chave) {
    const r = obter(chave);
    if (!r?.bloqueadoAte) return 0;
    return Math.ceil((r.bloqueadoAte - Date.now()) / 60000);
}

export function registrarFalha(chave) {
    const agora = Date.now();
    const r = obter(chave) ?? { falhas: 0, primeiraFalha: agora, bloqueadoAte: null };
    r.falhas += 1;
    if (r.falhas >= MAX_FALHAS) r.bloqueadoAte = agora + BLOQUEIO_MS;
    registros.set(chave, r);
}

export function limpar(chave) {
    registros.delete(chave);
}

// Limpeza periódica para não acumular memória.
setInterval(() => {
    for (const chave of registros.keys()) obter(chave);
}, JANELA_MS).unref();
