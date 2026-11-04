/** DRE: receitas, despesas por categoria, resultado, margem e filtros. */
import { sessao, ok, esp, secao, finalizar } from '../auxiliares.mjs';

const ger = await sessao('gerente');
const com = await sessao('comum');
const cli = (await ger('POST', '/api/clientes', { nome: 'Cliente DRE' })).d;
const prod = (await ger('POST', '/api/produtos-venda', { nome: 'Produto DRE', unidade: 'un' })).d;
const cats = (await com('GET', '/api/categorias-despesa')).d;
const aluguel = cats.find((c) => c.nome === 'Aluguel');
const luz = cats.find((c) => c.nome === 'Luz');
const antiga = (await ger('POST', '/api/categorias-despesa', { nome: 'Antiga' })).d;

const venda = (pagamento, dataVenda, preco) => com('POST', '/api/vendas',
    { clienteId: cli.id, pagamento, dataVenda, itens: [{ produtoId: prod.id, quantidade: '1', precoUnitario: preco }] });
const despesa = (categoriaId, dataDespesa, valor) => com('POST', '/api/despesas', { categoriaId, valor, dataDespesa });

await venda('avista', '2025-03-05', '1000');
await venda('avista', '2025-03-20', '300,50');
await venda('aprazo', '2025-03-25', '700');
await venda('avista', '2025-04-01', '9999');      // fora do período
await despesa(aluguel.id, '2025-03-01', '800');
await despesa(luz.id, '2025-03-15', '150,25');
await despesa(antiga.id, '2025-03-10', '100');
await despesa(aluguel.id, '2025-02-28', '5000');  // fora do período
await ger('PATCH', `/api/categorias-despesa/${antiga.id}/ativa`, { ativa: false });

const P = 'inicio=2025-03-01&fim=2025-03-31';

secao('Cálculos');
let d = esp('DRE padrão (categorias ativas)', await com('GET', `/api/dre?${P}`), 200);
ok('receita 2000,50 = 1300,50 à vista + 700 a prazo', d.receitaTotal === 2000.5 && d.receitas[0].valor === 1300.5 && d.receitas[1].valor === 700);
ok('despesas 950,25 (sem a categoria desativada)', d.despesaTotal === 950.25 && d.categorias.length === 2);
ok('resultado 1050,25 e margem 52,5%', d.resultado === 1050.25 && Math.abs(d.margem - 52.5) < 0.01);

secao('Filtros');
d = esp('ativas e desativadas', await com('GET', `/api/dre?${P}&status=ambas`), 200);
ok('despesas 1050,25 e resultado 950,25', d.despesaTotal === 1050.25 && d.resultado === 950.25);
d = esp('somente desativadas', await com('GET', `/api/dre?${P}&status=desativadas`), 200);
ok('só a categoria Antiga', d.despesaTotal === 100 && d.categorias[0].ativa === false);
d = esp('só a prazo e só Luz', await com('GET', `/api/dre?${P}&receitas=aprazo&categorias=${luz.id}`), 200);
ok('700 - 150,25 = 549,75', d.receitaTotal === 700 && d.despesaTotal === 150.25 && d.resultado === 549.75);
d = esp('prejuízo', await com('GET', '/api/dre?inicio=2025-02-01&fim=2025-03-31&status=ambas&receitas=aprazo'), 200);
ok('700 - 6050,25 = -5350,25', d.resultado === -5350.25);
d = esp('período sem lançamentos', await com('GET', '/api/dre?inicio=2024-01-01&fim=2024-01-31'), 200);
ok('tudo zero e margem nula', d.receitaTotal === 0 && d.despesaTotal === 0 && d.resultado === 0 && d.margem === null);
esp('tipo de receita inválido', await com('GET', `/api/dre?${P}&receitas=pix`), 400);
esp('seção inválida', await com('GET', `/api/dre?${P}&secoes=xyz`), 400);

secao('Exportação');
ok('PDF válido', (await com('GET', `/api/dre?${P}&formato=pdf`)).d.subarray(0, 4).toString() === '%PDF');
const csv = (await com('GET', `/api/dre?${P}&secoes=resultado&formato=csv`)).d.toString('utf8');
ok('CSV só com a seção escolhida', csv.includes('Resultado do período') && !csv.includes('Despesas por categoria'));

finalizar();
