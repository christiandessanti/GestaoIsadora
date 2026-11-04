/**
 * Erro com código HTTP. A mensagem é exibida ao usuário,
 * então deve ser clara e não revelar detalhes internos.
 */
export class HttpError extends Error {
    constructor(status, mensagem) {
        super(mensagem);
        this.status = status;
    }
}

export const naoAutenticado = (msg = 'Faça login para continuar.') => new HttpError(401, msg);
export const proibido = (msg = 'Você não tem permissão para esta ação.') => new HttpError(403, msg);
export const naoEncontrado = (msg = 'Registro não encontrado.') => new HttpError(404, msg);
export const invalido = (msg) => new HttpError(400, msg);
export const conflito = (msg) => new HttpError(409, msg);
