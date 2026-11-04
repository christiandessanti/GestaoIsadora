/** Usuários, senhas, clientes, produtos de venda, matérias-primas e categorias. */
import { sessao, ok, esp, secao, finalizar } from '../auxiliares.mjs';

const ti = await sessao('ti');
const ger = await sessao('gerente');
let com = await sessao('comum');

secao('Usuários e permissões');
esp('comum não lista usuários', await com('GET', '/api/usuarios'), 403);
const lista = esp('gerente lista usuários', await ger('GET', '/api/usuarios'), 200);
const uTI = lista.find((u) => u.login === 'zzt_ti');
const uCom = lista.find((u) => u.login === 'zzt_com');
ok('gerente não pode alterar o TI', uTI.podeAlterarStatus === false);
const novoG = esp('gerente cria gerente', await ger('POST', '/api/usuarios',
    { nome: 'Novo Gerente', login: 'ZZT_novoger', senha: '12345678', confirmacao: '12345678', gerente: true }), 201);
ok('login salvo em minúsculas e perfil gerente', novoG.login === 'zzt_novoger' && novoG.perfil === 'gerente');
esp('login duplicado', await ger('POST', '/api/usuarios', { nome: 'X', login: 'zzt_novoger', senha: '12345678', confirmacao: '12345678' }), 409);
esp('login com acento', await ger('POST', '/api/usuarios', { nome: 'X', login: 'joão', senha: '12345678', confirmacao: '12345678' }), 400);
esp('senha curta', await ger('POST', '/api/usuarios', { nome: 'X', login: 'zzt_x', senha: '123', confirmacao: '123' }), 400);
esp('gerente não desativa gerente', await ger('PATCH', `/api/usuarios/${novoG.id}/ativo`, { ativo: false }), 403);
esp('gerente não desativa TI', await ger('PATCH', `/api/usuarios/${uTI.id}/ativo`, { ativo: false }), 403);
esp('gerente desativa comum', await ger('PATCH', `/api/usuarios/${uCom.id}/ativo`, { ativo: false }), 200);
esp('gerente reativa comum', await ger('PATCH', `/api/usuarios/${uCom.id}/ativo`, { ativo: true }), 200);
esp('TI desativa gerente', await ti('PATCH', `/api/usuarios/${novoG.id}/ativo`, { ativo: false }), 200);
esp('TI não desativa a si mesmo', await ti('PATCH', `/api/usuarios/${uTI.id}/ativo`, { ativo: false }), 403);
esp('gerente não redefine senha', await ger('PUT', `/api/usuarios/${uCom.id}/senha`, { novaSenha: 'nova-senha-1', confirmacao: 'nova-senha-1' }), 403);
esp('TI redefine senha sem a antiga', await ti('PUT', `/api/usuarios/${uCom.id}/senha`, { novaSenha: 'nova-senha-1', confirmacao: 'nova-senha-1' }), 200);
com = await sessao('comum', 'nova-senha-1');
esp('trocar a própria senha com a atual errada', await com('PUT', '/api/usuarios/me/senha', { senhaAtual: 'errada', novaSenha: 'outra-senha-1', confirmacao: 'outra-senha-1' }), 400);
esp('trocar a própria senha', await com('PUT', '/api/usuarios/me/senha', { senhaAtual: 'nova-senha-1', novaSenha: 'outra-senha-1', confirmacao: 'outra-senha-1' }), 200);

secao('Senha especial');
esp('comum não altera', await com('PUT', '/api/configuracoes/senha-especial', { senhaEspecial: 'x', novaSenha: '123456', confirmacao: '123456' }), 403);
esp('senha atual errada', await ger('PUT', '/api/configuracoes/senha-especial', { senhaEspecial: 'errada', novaSenha: 'esp-nova-1', confirmacao: 'esp-nova-1' }), 403);
esp('senha do TI aceita como atual', await ger('PUT', '/api/configuracoes/senha-especial', { senhaEspecial: 'senha-ti-1234', novaSenha: 'esp-nova-1', confirmacao: 'esp-nova-1' }), 200);

secao('Clientes');
esp('comum não cria cliente', await com('POST', '/api/clientes', { nome: 'Cliente' }), 403);
const cli = esp('gerente cria cliente', await ger('POST', '/api/clientes', { nome: '  João   da Silva ', telefone: '(11) 99999-0000' }), 201);
ok('nome normalizado e data automática', cli.nome === 'João da Silva' && /^\d{4}-\d{2}-\d{2}/.test(cli.criado_em));
esp('duplicado ignorando acento e maiúsculas', await ger('POST', '/api/clientes', { nome: 'joao da silva' }), 409);
esp('telefone inválido', await ger('POST', '/api/clientes', { nome: 'Outro', telefone: 'abc' }), 400);
esp('editar cliente', await ger('PUT', `/api/clientes/${cli.id}`, { nome: 'João da Silva Ltda', telefone: '' }), 200);
esp('desativar cliente', await ger('PATCH', `/api/clientes/${cli.id}/ativo`, { ativo: false }), 200);
ok('desativado some da lista padrão', (await com('GET', '/api/clientes')).d.length === 0);
ok('aparece com todos=1', (await ger('GET', '/api/clientes?todos=1')).d.length === 1);

secao('Produtos de venda');
const pv = esp('criar produto', await ger('POST', '/api/produtos-venda', { nome: 'Biscoito', unidade: 'cx' }), 201);
esp('unidade inválida', await ger('POST', '/api/produtos-venda', { nome: 'Y', unidade: 'litro' }), 400);
esp('trocar unidade sem vendas', await ger('PUT', `/api/produtos-venda/${pv.id}`, { nome: 'Biscoito', unidade: 'pct' }), 200);

secao('Matérias-primas');
const mp = esp('criar com estoque inicial 120,5 kg', await ger('POST', '/api/materias-primas', { nome: 'Farinha', unidade: 'kg', estoqueInicial: '120,5' }), 201);
ok('estoque e última operação "inicial"', Number(mp.quantidade) === 120.5 && mp.ultima_operacao_tipo === 'inicial');
esp('2 casas decimais', await ger('POST', '/api/materias-primas', { nome: 'X', unidade: 'kg', estoqueInicial: '1,25' }), 400);
esp('decimal em "un"', await ger('POST', '/api/materias-primas', { nome: 'X', unidade: 'un', estoqueInicial: '1,5' }), 400);
const mp2 = esp('criar sem estoque inicial', await ger('POST', '/api/materias-primas', { nome: 'Ovos', unidade: 'un' }), 201);
esp('editar nome', await ger('PUT', `/api/materias-primas/${mp.id}`, { nome: 'Farinha de Trigo' }), 200);
esp('excluir sem senha', await ger('DELETE', `/api/materias-primas/${mp.id}`, {}), 403);
esp('excluir com senha especial', await ger('DELETE', `/api/materias-primas/${mp.id}`, { senhaEspecial: 'esp-nova-1' }), 200);
esp('excluir com senha do TI', await ger('DELETE', `/api/materias-primas/${mp2.id}`, { senhaEspecial: 'senha-ti-1234' }), 200);

secao('Categorias de despesa');
ok('20 categorias padrão', (await com('GET', '/api/categorias-despesa')).d.length === 20);
const cat = esp('criar categoria', await ger('POST', '/api/categorias-despesa', { nome: 'Internet' }), 201);
esp('duplicada', await ger('POST', '/api/categorias-despesa', { nome: 'aluguel' }), 409);
esp('renomear', await ger('PUT', `/api/categorias-despesa/${cat.id}`, { nome: 'Internet e Telefone' }), 200);
esp('desativar', await ger('PATCH', `/api/categorias-despesa/${cat.id}/ativa`, { ativa: false }), 200);
esp('excluir sem registros', await ger('DELETE', `/api/categorias-despesa/${cat.id}`, { senhaEspecial: 'esp-nova-1' }), 200);

finalizar();
