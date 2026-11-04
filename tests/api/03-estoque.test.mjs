/** Entradas, saídas, estoque negativo, concorrência, exclusão e relatório de estoque. */
import { sessao, ok, esp, secao, finalizar } from '../auxiliares.mjs';

const ger = await sessao('gerente');
const com = await sessao('comum');
const mov = (id, tipo, quantidade, observacao) =>
    com('POST', '/api/estoque/movimentacoes', { materiaPrimaId: id, tipo, quantidade, observacao });

const far = (await ger('POST', '/api/materias-primas', { nome: 'Farinha', unidade: 'kg', estoqueInicial: '100' })).d;
const ovo = (await ger('POST', '/api/materias-primas', { nome: 'Ovos', unidade: 'un', estoqueInicial: '30' })).d;
const lei = (await ger('POST', '/api/materias-primas', { nome: 'Leite', unidade: 'L' })).d;

secao('Movimentações (usuário comum)');
let r = esp('entrada 20,5 kg', await mov(far.id, 'entrada', '20,5', 'Compra fornecedor X'), 201);
ok('saldo 120,5 e última operação "entrada 20,5"', Number(r.quantidade) === 120.5 && r.ultima_operacao_tipo === 'entrada' && Number(r.ultima_operacao_qtd) === 20.5);
r = esp('saída 0,5 kg', await mov(far.id, 'saida', '0.5'), 201);
ok('saldo 120', Number(r.quantidade) === 120);
esp('saída maior que o estoque', await mov(far.id, 'saida', '120,1'), 409);
esp('saída que zera o estoque', await mov(ovo.id, 'saida', '30'), 201);
esp('saída com estoque zerado', await mov(ovo.id, 'saida', '1'), 409);
esp('decimal em "un"', await mov(ovo.id, 'entrada', '2,5'), 400);
esp('2 casas decimais', await mov(far.id, 'entrada', '1,25'), 400);
esp('quantidade zero', await mov(far.id, 'entrada', '0'), 400);
esp('tipo inválido', await mov(far.id, 'ajuste', '1'), 400);
esp('produto inexistente', await mov(999999, 'entrada', '1'), 404);
esp('entrada de 10 L de leite', await mov(lei.id, 'entrada', '10'), 201);

secao('Concorrência: 15 saídas simultâneas de 1 L com 10 L em estoque');
const resultados = await Promise.all(Array.from({ length: 15 }, () => mov(lei.id, 'saida', '1')));
const aceitas = resultados.filter((x) => x.s === 201).length;
ok('exatamente 10 aceitas e 5 recusadas', aceitas === 10 && resultados.filter((x) => x.s === 409).length === 5, `(${aceitas} aceitas)`);
ok('estoque termina em zero, nunca negativo', Number((await com('GET', '/api/materias-primas')).d.find((p) => p.id === lei.id).quantidade) === 0);

secao('Exclusão e relatório');
esp('excluir Ovos', await ger('DELETE', `/api/materias-primas/${ovo.id}`, { senhaEspecial: 'senha-ti-1234' }), 200);
const hoje = new Date().toLocaleDateString('sv-SE');
const P = `inicio=${hoje}&fim=${hoje}`;
const ativos = esp('relatório: somente ativos', await com('GET', `/api/estoque/relatorio?${P}&status=ativos`), 200);
const fr = ativos.resumo.find((x) => x.nome === 'Farinha');
ok('excluídos não aparecem', !ativos.resumo.some((x) => x.nome === 'Ovos'));
ok('Farinha: entradas 120,5 (inicial + entrada), saídas 0,5, saldo 120', fr.entradas === 120.5 && fr.saidas === 0.5 && fr.saldo === 120 && fr.estoqueFinal === 120);
const exc = esp('relatório: somente excluídos', await com('GET', `/api/estoque/relatorio?${P}&status=excluidos`), 200);
ok('Ovos com movimentações preservadas', exc.resumo.length === 1 && exc.resumo[0].entradas === 30 && exc.movimentacoes.length === 2);
const ambos = esp('relatório: ambos, filtrado por produto', await com('GET', `/api/estoque/relatorio?${P}&status=ambos&produtos=${far.id},${ovo.id}`), 200);
ok('2 produtos e 5 movimentações', ambos.resumo.length === 2 && ambos.movimentacoes.length === 5);
ok('nome do produto nas movimentações', ambos.movimentacoes.every((m) => m.produto));
const amanha = new Date(Date.now() + 864e5).toLocaleDateString('sv-SE');
const fut = esp('período futuro', await com('GET', `/api/estoque/relatorio?inicio=${amanha}&fim=${amanha}&produtos=${far.id}`), 200);
ok('estoque no início = 120 e sem movimentações', fut.resumo[0].estoqueInicial === 120 && fut.movimentacoes.length === 0);
esp('datas invertidas', await com('GET', `/api/estoque/relatorio?inicio=${amanha}&fim=${hoje}`), 400);
esp('status inválido', await com('GET', `/api/estoque/relatorio?${P}&status=xx`), 400);

secao('Exportação');
const csv = esp('CSV', await com('GET', `/api/estoque/relatorio?${P}&status=ambos&formato=csv`), 200);
ok('CSV com BOM UTF-8 e separador ";"', csv[0] === 0xEF && csv.toString('utf8').includes('Produto;Unidade;Status'));
const pdf = esp('PDF', await com('GET', `/api/estoque/relatorio?${P}&status=ambos&formato=pdf`), 200);
ok('PDF válido', pdf.subarray(0, 4).toString() === '%PDF');

finalizar();
