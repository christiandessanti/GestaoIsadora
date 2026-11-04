/** Despesas: registro, categorias desativadas, edição com histórico, exclusão e relatório. */
import { sessao, ok, esp, secao, finalizar } from '../auxiliares.mjs';

const ger = await sessao('gerente');
const com = await sessao('comum');
const cats = (await com('GET', '/api/categorias-despesa')).d;
const aluguel = cats.find((c) => c.nome === 'Aluguel');
const luz = cats.find((c) => c.nome === 'Luz');
const internet = (await ger('POST', '/api/categorias-despesa', { nome: 'Internet' })).d;
const registrar = (categoriaId, valor, dataDespesa, observacao) => com('POST', '/api/despesas', { categoriaId, valor, dataDespesa, observacao });

secao('Registro');
const d1 = esp('aluguel 2.500,00', await registrar(aluguel.id, '2.500,00', '2026-10-05', 'Aluguel outubro'), 201);
ok('valor gravado 2500.00', d1.valor === '2500.00');
esp('luz 345,67', await registrar(luz.id, '345,67', '2026-10-10'), 201);
const d3 = esp('internet 99,90', await registrar(internet.id, '99.90', '2026-10-12'), 201);
esp('valor zero', await registrar(luz.id, '0', '2026-10-10'), 400);
esp('valor negativo', await registrar(luz.id, '-10', '2026-10-10'), 400);
esp('sem categoria', await com('POST', '/api/despesas', { valor: '10', dataDespesa: '2026-10-10' }), 400);
esp('data inválida', await registrar(luz.id, '10', '10/10/2026'), 400);

secao('Categorias');
esp('categoria com despesas não pode ser excluída', await ger('DELETE', `/api/categorias-despesa/${internet.id}`, { senhaEspecial: 'senha-ti-1234' }), 409);
await ger('PATCH', `/api/categorias-despesa/${internet.id}/ativa`, { ativa: false });
esp('nova despesa em categoria desativada', await registrar(internet.id, '10', '2026-10-10'), 400);
esp('editar despesa que já era dessa categoria', await com('PUT', `/api/despesas/${d3.id}`,
    { categoriaId: internet.id, valor: '109,90', dataDespesa: '2026-10-12', observacao: 'Plano novo' }), 200);

secao('Edição');
const e1 = esp('trocar categoria e valor', await com('PUT', `/api/despesas/${d1.id}`,
    { categoriaId: luz.id, valor: '2600', dataDespesa: '2026-10-05', observacao: 'Aluguel outubro' }), 200);
ok('categoria Luz e valor 2600.00', e1.categoria === 'Luz' && e1.valor === '2600.00');
await com('PUT', `/api/despesas/${d1.id}`, { categoriaId: aluguel.id, valor: '2500', dataDespesa: '2026-10-05', observacao: 'Aluguel outubro' });

secao('Lista e exclusão');
const lista = esp('lista', await com('GET', '/api/despesas'), 200);
ok('3 despesas, mais recente primeiro', lista.despesas.length === 3 && lista.despesas[0].data_despesa === '2026-10-12');
esp('excluir com senha errada', await com('DELETE', `/api/despesas/${d3.id}`, { senhaEspecial: 'x' }), 403);
esp('excluir com senha', await com('DELETE', `/api/despesas/${d3.id}`, { senhaEspecial: 'senha-ti-1234' }), 200);
esp('categoria com despesa excluída continua protegida', await ger('DELETE', `/api/categorias-despesa/${internet.id}`, { senhaEspecial: 'senha-ti-1234' }), 409);
await registrar(luz.id, '50', '2026-10-20');
await ger('PATCH', `/api/categorias-despesa/${internet.id}/ativa`, { ativa: true });
await registrar(internet.id, '120', '2026-10-25');
await ger('PATCH', `/api/categorias-despesa/${internet.id}/ativa`, { ativa: false });

secao('Relatório (outubro)');
const P = 'inicio=2026-10-01&fim=2026-10-31';
let r = esp('somente ativas', await com('GET', `/api/despesas/relatorio?${P}&status=ativas`), 200);
ok('2500 + 345,67 + 50 = 2895,67', r.resumo.total === 2895.67 && r.resumo.quantidade === 3);
r = esp('ativas e desativadas', await com('GET', `/api/despesas/relatorio?${P}&status=ambas`), 200);
ok('+ 120 = 3015,67 (a excluída não conta)', r.resumo.total === 3015.67 && r.resumo.quantidade === 4);
ok('percentuais somam 100%', Math.abs(r.porCategoria.reduce((s, g) => s + g.percentual, 0) - 100) < 1e-9);
r = esp('somente desativadas', await com('GET', `/api/despesas/relatorio?${P}&status=desativadas`), 200);
ok('só Internet, 120', r.resumo.total === 120 && r.porCategoria.length === 1);
r = esp('só a categoria Luz', await com('GET', `/api/despesas/relatorio?${P}&status=ambas&categorias=${luz.id}`), 200);
ok('345,67 + 50 = 395,67', r.resumo.total === 395.67);
esp('status inválido', await com('GET', `/api/despesas/relatorio?${P}&status=xx`), 400);
ok('PDF válido', (await com('GET', `/api/despesas/relatorio?${P}&status=ambas&formato=pdf`)).d.subarray(0, 4).toString() === '%PDF');
esp('CSV', await com('GET', `/api/despesas/relatorio?${P}&formato=csv`), 200);

finalizar();
