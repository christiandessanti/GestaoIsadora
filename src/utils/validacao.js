import { invalido } from './erros.js';

export const UNIDADES = ['kg', 'g', 'L', 'ml', 'un', 'cx', 'pct'];
export const UNIDADES_INTEIRAS = ['un', 'cx', 'pct'];

/** Texto obrigatório (ou opcional), sem espaços nas pontas e com tamanho máximo. */
export function texto(valor, campo, { max = 100, min = 1, opcional = false } = {}) {
    const t = String(valor ?? '').trim().replace(/\s+/g, ' ');
    if (!t) {
        if (opcional) return null;
        throw invalido(`Informe ${campo}.`);
    }
    if (t.length < min) throw invalido(`${capitalizar(campo)} deve ter pelo menos ${min} caracteres.`);
    if (t.length > max) throw invalido(`${capitalizar(campo)} deve ter no máximo ${max} caracteres.`);
    return t;
}

export function unidade(valor) {
    if (!UNIDADES.includes(valor)) throw invalido(`Unidade inválida. Use: ${UNIDADES.join(', ')}.`);
    return valor;
}

/**
 * Quantidade de estoque/venda: no máximo 1 casa decimal; inteira para un, cx e pct.
 * Aceita "12,5", "12.5" ou 12.5. Retorna texto ("12.5") para gravar sem erro de arredondamento.
 */
export function quantidade(valor, und, { campo = 'a quantidade', permitirZero = false } = {}) {
    let t = String(valor ?? '').trim().replace(',', '.');
    // Zeros decimais à direita não mudam o valor: "5.000" -> "5", "2.50" -> "2.5".
    if (/^\d+\.\d+$/.test(t)) t = t.replace(/\.?0+$/, '');
    if (!t) throw invalido(`Informe ${campo}.`);
    if (t.startsWith('-')) throw invalido(`${capitalizar(campo)} não pode ser ${feminino(campo) ? 'negativa' : 'negativo'}.`);

    const inteira = UNIDADES_INTEIRAS.includes(und);
    const formato = inteira ? /^\d{1,9}$/ : /^\d{1,9}(\.\d)?$/;
    if (!formato.test(t)) {
        throw invalido(inteira
            ? `${capitalizar(campo)} deve ser um número inteiro para a unidade "${und}".`
            : `${capitalizar(campo)} deve ser um número com no máximo 1 casa decimal.`);
    }
    if (!permitirZero && Number(t) === 0) throw invalido(`${capitalizar(campo)} deve ser maior que zero.`);
    return t;
}

/** Valor em reais: até 2 casas decimais. Aceita "1.234,56", "1234,56" ou 1234.56. */
export function dinheiro(valor, campo = 'o valor', { permitirZero = false } = {}) {
    let t = String(valor ?? '').trim();
    if (t.startsWith('-')) throw invalido(`${capitalizar(campo)} não pode ser ${feminino(campo) ? 'negativa' : 'negativo'}.`);
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(t)) throw invalido(`${capitalizar(campo)} inválido. Use o formato 1250,50.`);
    if (!permitirZero && Number(t) === 0) throw invalido(`${capitalizar(campo)} deve ser maior que zero.`);
    return Number(t).toFixed(2); // sempre com 2 casas: "2600" -> "2600.00"
}

/** Data no formato AAAA-MM-DD (o mesmo do <input type="date">). */
export function data(valor, campo = 'a data') {
    const t = String(valor ?? '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw invalido(`${capitalizar(campo)} inválida.`);
    return t;
}

/** Telefone opcional: mantém apenas dígitos e símbolos comuns. */
export function telefone(valor) {
    const t = String(valor ?? '').trim();
    if (!t) return null;
    if (!/^[\d\s()+-]{8,20}$/.test(t)) throw invalido('Telefone inválido.');
    return t;
}

export function id(valor, mensagem = 'Identificador inválido.') {
    const n = Number(valor);
    if (!Number.isInteger(n) || n <= 0) throw invalido(mensagem);
    return n;
}

export function booleano(valor, campo) {
    if (typeof valor !== 'boolean') throw invalido(`Campo "${campo}" inválido.`);
    return valor;
}

/** Nova senha + confirmação. */
export function novaSenha(senha, confirmacao, { min = 8 } = {}) {
    const s = String(senha ?? '');
    if (s.length < min) throw invalido(`A nova senha deve ter pelo menos ${min} caracteres.`);
    if (s.length > 72) throw invalido('A nova senha deve ter no máximo 72 caracteres.');
    if (s !== String(confirmacao ?? '')) throw invalido('A confirmação não confere com a nova senha.');
    return s;
}

/** O campo começa com artigo feminino? ('a quantidade' -> true, 'o valor' -> false) */
const feminino = (campo) => /^as? /.test(campo);

function capitalizar(campo) {
    const t = campo.replace(/^(o|a|os|as) /, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
}
