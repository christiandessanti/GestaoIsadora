/**
 * Regras de negócio das vendas: validação dos itens, cálculo de valores
 * e consulta dos itens de várias vendas de uma vez.
 */
import * as v from '../utils/validacao.js';
import { invalido } from '../utils/erros.js';

export const NOMES_PAGAMENTO = { avista: 'À vista', aprazo: 'A prazo' };
const MAX_ITENS = 100;
const MAX_TOTAL_CENTAVOS = 999_999_999_999n; // limite do DECIMAL(12,2)

export const paraCentavos = (valor) => Math.round(Number(valor) * 100);
export const deCentavos = (c) => (Number(c) / 100).toFixed(2);

/**
 * Subtotal = quantidade × preço, arredondado para centavos.
 * Feito com inteiros (BigInt) para não ter erros de arredondamento de ponto flutuante.
 */
export function calcularSubtotalCentavos(quantidade, preco) {
    const milesimos = BigInt(Math.round(Number(quantidade) * 1000));
    const centavos = BigInt(paraCentavos(preco));
    return (milesimos * centavos + 500n) / 1000n;
}

/**
 * Valida os dados enviados pelo formulário de venda.
 * "produtosPorId" contém os produtos que podem ser usados nesta venda.
 */
export function validarVenda(body, { produtosPorId }) {
    const clienteId = v.id(body?.clienteId);
    const pagamento = body?.pagamento;
    if (!NOMES_PAGAMENTO[pagamento]) throw invalido('Selecione a forma de pagamento.');
    const dataVenda = v.data(body?.dataVenda, 'a data da venda');

    const itensBrutos = Array.isArray(body?.itens) ? body.itens : [];
    if (!itensBrutos.length) throw invalido('Adicione pelo menos um produto à venda.');
    if (itensBrutos.length > MAX_ITENS) throw invalido(`Uma venda pode ter no máximo ${MAX_ITENS} produtos.`);

    const vistos = new Set();
    let total = 0n;
    const itens = itensBrutos.map((item, i) => {
        const pos = `Produto ${i + 1}`;
        const produtoId = Number(item?.produtoId);
        const produto = produtosPorId.get(produtoId);
        if (!produto) throw invalido(`${pos}: selecione um produto válido.`);
        if (vistos.has(produtoId)) throw invalido(`O produto "${produto.nome}" foi adicionado mais de uma vez.`);
        vistos.add(produtoId);

        const quantidade = v.quantidade(item?.quantidade, produto.unidade, { campo: `a quantidade de "${produto.nome}"` });
        const precoUnitario = v.dinheiro(item?.precoUnitario, `o preço de "${produto.nome}"`);
        const subtotal = calcularSubtotalCentavos(quantidade, precoUnitario);
        total += subtotal;
        return { produtoId, quantidade, precoUnitario, subtotal: deCentavos(subtotal) };
    });

    if (total > MAX_TOTAL_CENTAVOS) throw invalido('O valor total da venda é grande demais.');
    if (total === 0n) throw invalido('O valor total da venda deve ser maior que zero.');

    return { clienteId, pagamento, dataVenda, itens, valorTotal: deCentavos(total) };
}

/** Busca os itens (com nome e unidade do produto) de várias vendas. Retorna Map vendaId -> itens. */
export async function buscarItens(conn, vendaIds, { tabela = 'vendas_itens' } = {}) {
    const mapa = new Map(vendaIds.map((id) => [id, []]));
    if (!vendaIds.length) return mapa;
    const [rows] = await conn.query(
        `SELECT i.venda_id, i.produto_id, p.nome AS produto, p.unidade, p.ativo AS produto_ativo,
                i.quantidade, i.preco_unitario, i.subtotal
           FROM ${tabela} i
           JOIN produtos_venda p ON p.id = i.produto_id
          WHERE i.venda_id IN (?)
          ORDER BY i.id`,
        [vendaIds],
    );
    for (const r of rows) {
        mapa.get(r.venda_id).push({
            produtoId: r.produto_id,
            produto: r.produto,
            unidade: r.unidade,
            produtoAtivo: Boolean(r.produto_ativo),
            quantidade: r.quantidade,
            precoUnitario: r.preco_unitario,
            subtotal: r.subtotal,
        });
    }
    return mapa;
}

/** Texto curto com os itens, usado no histórico de edições. Ex.: "Biscoito A: 10 x 5.50" */
export function resumoItens(itens) {
    return itens
        .map((i) => `${i.produto ?? `#${i.produtoId}`}: ${Number(i.quantidade)} x ${Number(i.precoUnitario).toFixed(2)}`)
        .join('; ');
}
