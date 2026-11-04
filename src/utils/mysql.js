import { conflito } from './erros.js';

/**
 * Converte o erro de "valor duplicado" do MySQL numa mensagem amigável.
 * A comparação do banco (utf8mb4_unicode_ci) ignora maiúsculas e acentos:
 * "Açúcar" e "acucar" são considerados o mesmo nome.
 */
export async function semDuplicidade(promessa, mensagem) {
    try {
        return await promessa;
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') throw conflito(mensagem);
        throw err;
    }
}
