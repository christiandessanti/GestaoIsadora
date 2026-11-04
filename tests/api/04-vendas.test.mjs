/** Vendas: registro, cálculos, último preço, desativados, edição, paginação, exclusão e relatório. */
import { sessao, ok, esp, secao, finalizar } from '../auxiliares.mjs';

const ger = await sessao('gerente');
const com = await sessao('comum');
const c1 = (await ger('POST', '/api/clientes', { nome: 'Mercado Bom Preço' })).d;
const c2 = (await ger('POST', '/api/clientes', { nome: 'Padaria Central' })).d;
const pA = (await ger('POST', '/api/produtos-venda', { nome: 'Biscoito Maizena', unidade: 'cx' })).d;
const pB = (await ger('POST', '/api/produtos-venda', { nome: 'Biscoito Granel', unidade: 'kg' })).d;
const vender = (corpo) => com('POST', '/api/vendas', { clienteId: c1.id, pagamento: 'avista', dataVenda: '2026-10-15', ...corpo });
const item = (produtoId, quantidade, precoUnitario) => ({ produtoId, quantidade, precoUnitario });

secao('Registro');
let v1 = esp('venda com 2 itens', await vender({ itens: [item(pA.id, '10', '12,50'), item(pB.id, '2,5', '19,99')] }), 201);
ok('total 174,98 (125,00 + 49,975 arredondado)', v1.valor_total === '174.98' && v1.itens[1].subtotal === '49.98');
esp('sem itens', await vender({ itens: [] }), 400);
esp('produto repetido', await vender({ itens: [item(pA.id, '1', '1'), item(pA.id, '1', '1')] }), 400);
esp('decimal em "cx"', await vender({ itens: [item(pA.id, '1,5', '1')] }), 400);
esp('preço com 3 casas', await vender({ itens: [item(pA.id, '1', '1,005')] }), 400);
esp('pagamento inválido', await vender({ pagamento: 'pix', itens: [item(pA.id, '1', '1')] }), 400);
esp('data inválida', await vender({ dataVenda: '2026-13-01', itens: [item(pA.id, '1', '1')] }), 400);
esp('cliente inexistente', await vender({ clienteId: 99999, itens: [item(pA.id, '1', '1')] }), 400);

secao('Último preço praticado');
await vender({ pagamento: 'aprazo', dataVenda: '2026-10-20', itens: [item(pA.id, '5', '13,00')] });
const precos = esp('últimos preços do cliente', await com('GET', `/api/vendas/ultimos-precos?clienteId=${c1.id}`), 200);
ok('usa a venda mais recente de cada produto', precos[pA.id] === '13.00' && precos[pB.id] === '19.99', JSON.stringify(precos));
ok('cliente sem histórico -> vazio', Object.keys((await com('GET', `/api/vendas/ultimos-precos?clienteId=${c2.id}`)).d).length === 0);

secao('Cadastros desativados');
await ger('PATCH', `/api/clientes/${c2.id}/ativo`, { ativo: false });
esp('venda para cliente desativado', await vender({ clienteId: c2.id, itens: [item(pA.id, '1', '1')] }), 400);
await ger('PATCH', `/api/clientes/${c2.id}/ativo`, { ativo: true });
await ger('PATCH', `/api/produtos-venda/${pB.id}/ativo`, { ativo: false });
esp('venda nova com produto desativado', await vender({ itens: [item(pB.id, '1', '1')] }), 400);
esp('editar venda que já tinha o produto desativado', await com('PUT', `/api/vendas/${v1.id}`,
    { clienteId: c1.id, pagamento: 'avista', dataVenda: '2026-10-15', itens: [item(pA.id, '10', '12,50'), item(pB.id, '3', '20')] }), 200);
await ger('PATCH', `/api/produtos-venda/${pB.id}/ativo`, { ativo: true });
esp('não troca unidade de produto com vendas', await ger('PUT', `/api/produtos-venda/${pA.id}`, { nome: pA.nome, unidade: 'un' }), 409);

secao('Edição');
v1 = esp('editar cliente, pagamento, data e itens', await com('PUT', `/api/vendas/${v1.id}`,
    { clienteId: c2.id, pagamento: 'aprazo', dataVenda: '2026-10-16', itens: [item(pA.id, '4', '12,50')] }), 200);
ok('novo total 50,00 e cliente alterado', v1.valor_total === '50.00' && v1.itens.length === 1 && v1.cliente === 'Padaria Central');
const atual = (await com('GET', `/api/vendas/${v1.id}`)).d;
esp('aceita quantidades no formato do banco ("4.000")', await com('PUT', `/api/vendas/${v1.id}`,
    { clienteId: c2.id, pagamento: 'aprazo', dataVenda: '2026-10-16', itens: atual.itens.map((i) => item(i.produtoId, i.quantidade, i.precoUnitario)) }), 200);

secao('Paginação (mais recentes primeiro)');
for (let i = 0; i < 35; i++) {
    await vender({ dataVenda: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, itens: [item(pA.id, '1', String(i + 1))] });
}
const p1 = esp('página 1', await com('GET', '/api/vendas'), 200);
const p2 = esp('página 2', await com('GET', `/api/vendas?apos=${encodeURIComponent(p1.proxima)}`), 200);
const todas = [...p1.vendas, ...p2.vendas];
ok('30 + 7 vendas, sem repetição, sem próxima página', p1.vendas.length === 30 && p2.vendas.length === 7 && new Set(todas.map((x) => x.id)).size === 37 && p2.proxima === null);
ok('ordenadas da mais recente para a mais antiga', todas.every((x, i) => i === 0 || x.data_venda <= todas[i - 1].data_venda));

secao('Exclusão');
esp('excluir sem senha', await com('DELETE', `/api/vendas/${v1.id}`, {}), 403);
esp('excluir com senha', await com('DELETE', `/api/vendas/${v1.id}`, { senhaEspecial: 'senha-ti-1234' }), 200);
esp('venda excluída não é encontrada', await com('GET', `/api/vendas/${v1.id}`), 404);

secao('Relatório');
let rel = esp('outubro', await com('GET', '/api/vendas/relatorio?inicio=2026-10-01&fim=2026-10-31'), 200);
ok('só a venda de 20/10 (a excluída não conta)', rel.resumo.quantidadeVendas === 1 && rel.resumo.total === 65 && rel.resumo.aprazo === 65);
rel = esp('setembro', await com('GET', '/api/vendas/relatorio?inicio=2026-09-01&fim=2026-09-30'), 200);
ok('35 vendas, total 630, ticket médio 18', rel.resumo.quantidadeVendas === 35 && rel.resumo.total === 630 && rel.resumo.ticketMedio === 18);
rel = esp('filtro: só a prazo', await com('GET', '/api/vendas/relatorio?inicio=2026-09-01&fim=2026-10-31&pagamentos=aprazo'), 200);
ok('1 venda a prazo', rel.resumo.quantidadeVendas === 1);
rel = esp('filtro: produto', await com('GET', `/api/vendas/relatorio?inicio=2026-09-01&fim=2026-10-31&produtos=${pB.id}`), 200);
ok('sem vendas do produto B no período (a única foi excluída)', rel.resumo.quantidadeVendas === 0 && rel.apenasProdutosSelecionados);
esp('pagamento inválido no filtro', await com('GET', '/api/vendas/relatorio?inicio=2026-09-01&fim=2026-10-31&pagamentos=pix'), 400);
const pdf = esp('PDF', await com('GET', '/api/vendas/relatorio?inicio=2026-09-01&fim=2026-10-31&formato=pdf'), 200);
ok('PDF válido', pdf.subarray(0, 4).toString() === '%PDF');
esp('CSV', await com('GET', '/api/vendas/relatorio?inicio=2026-09-01&fim=2026-10-31&formato=csv'), 200);

finalizar();
