import { api } from './api.js';
import { usuarioAtual } from './layout.js';
import {
    el, tabela, etiqueta, botaoPequeno, avisar, abrirFormulario, confirmar, confirmarComSenha,
    formatarData, formatarQuantidade, UNIDADES,
} from './ui.js';

const gestor = ['ti', 'gerente'].includes(usuarioAtual.perfil);
const NOMES_PERFIL = { ti: 'TI', gerente: 'Gerente', comum: 'Comum' };
const OPCOES_UNIDADE = UNIDADES.map((u) => ({ valor: u, rotulo: u }));

const statusEtiqueta = (ativo) => (ativo ? etiqueta('Ativo', 'sucesso') : etiqueta('Desativado', 'neutra'));

/** Envia um formulário fixo da página para a API e mostra o erro dentro dele. */
function ligarFormulario(form, url, mensagemSucesso) {
    const erro = form.querySelector('.form-erro');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        erro.textContent = '';
        const botao = form.querySelector('button[type="submit"]');
        botao.disabled = true;
        try {
            await api(url, { method: 'PUT', body: Object.fromEntries(new FormData(form)) });
            form.reset();
            avisar(mensagemSucesso);
        } catch (err) {
            erro.textContent = err.message;
        } finally {
            botao.disabled = false;
        }
    });
}

/** Ativa/desativa um registro, pedindo confirmação. */
async function alternarStatus({ url, campo = 'ativo', ativoAtual, nome, tipo, recarregar }) {
    const acao = ativoAtual ? 'Desativar' : 'Reativar';
    const ok = await confirmar({
        titulo: `${acao} ${tipo}`,
        mensagem: ativoAtual
            ? `"${nome}" deixará de aparecer nas opções de novos registros. O histórico é mantido.`
            : `"${nome}" voltará a aparecer nas opções de novos registros.`,
        textoConfirmar: acao,
        perigo: ativoAtual,
    });
    if (!ok) return;
    try {
        await api(url, { method: 'PATCH', body: { [campo]: !ativoAtual } });
        avisar(`${tipo.charAt(0).toUpperCase() + tipo.slice(1)} ${ativoAtual ? 'desativado(a)' : 'reativado(a)'}.`);
        await recarregar();
    } catch (err) {
        avisar(err.message, 'erro');
    }
}

// ================================================================ Senhas
ligarFormulario(document.querySelector('#form-minha-senha'), '/api/usuarios/me/senha', 'Sua senha foi alterada.');

// ================================================================ Usuários
async function carregarUsuarios() {
    const usuarios = await api('/api/usuarios');
    document.querySelector('#lista-usuarios').replaceChildren(tabela([
        { titulo: 'Nome', valor: (u) => u.nome },
        { titulo: 'Login', valor: (u) => u.login },
        { titulo: 'Perfil', valor: (u) => NOMES_PERFIL[u.perfil] },
        { titulo: 'Status', valor: (u) => statusEtiqueta(u.ativo) },
        {
            titulo: 'Ações', classe: 'col-acoes', valor: (u) => [
                u.podeRedefinirSenha && botaoPequeno('Redefinir senha', () => redefinirSenha(u)),
                u.podeAlterarStatus && botaoPequeno(u.ativo ? 'Desativar' : 'Reativar', () => alternarStatus({
                    url: `/api/usuarios/${u.id}/ativo`, ativoAtual: u.ativo, nome: u.nome, tipo: 'usuário',
                    recarregar: carregarUsuarios,
                }), u.ativo ? 'perigo' : 'secundario'),
            ],
        },
    ], usuarios, { classeLinha: (u) => (u.ativo ? '' : 'linha-inativa') }));
}

document.querySelector('#novo-usuario').addEventListener('click', async () => {
    const criado = await abrirFormulario({
        titulo: 'Novo usuário',
        campos: [
            { nome: 'nome', rotulo: 'Nome', max: 100 },
            { nome: 'login', rotulo: 'Login', max: 50, ajuda: 'Letras sem acento, números, ponto, hífen ou sublinhado.' },
            { nome: 'senha', rotulo: 'Senha', tipo: 'password', ajuda: 'Mínimo de 8 caracteres.' },
            { nome: 'confirmacao', rotulo: 'Confirmar senha', tipo: 'password' },
            { nome: 'gerente', rotulo: 'Privilégios de gerente', tipo: 'checkbox' },
        ],
        textoConfirmar: 'Criar usuário',
        aoEnviar: (dados) => api('/api/usuarios', { method: 'POST', body: dados }),
    });
    if (criado) {
        avisar('Usuário criado.');
        carregarUsuarios();
    }
});

async function redefinirSenha(u) {
    const ok = await abrirFormulario({
        titulo: 'Redefinir senha',
        descricao: `Definir uma nova senha para ${u.nome} (${u.login}).`,
        campos: [
            { nome: 'novaSenha', rotulo: 'Nova senha', tipo: 'password', ajuda: 'Mínimo de 8 caracteres.' },
            { nome: 'confirmacao', rotulo: 'Confirmar nova senha', tipo: 'password' },
        ],
        textoConfirmar: 'Redefinir',
        aoEnviar: (dados) => api(`/api/usuarios/${u.id}/senha`, { method: 'PUT', body: dados }),
    });
    if (ok) avisar('Senha redefinida.');
}

// ================================================================ Clientes
async function carregarClientes() {
    const clientes = await api('/api/clientes?todos=1');
    document.querySelector('#lista-clientes').replaceChildren(tabela([
        { titulo: 'Nome', valor: (c) => c.nome },
        { titulo: 'Telefone', valor: (c) => c.telefone || '—' },
        { titulo: 'Cadastro', valor: (c) => formatarData(c.criado_em) },
        { titulo: 'Status', valor: (c) => statusEtiqueta(c.ativo) },
        {
            titulo: 'Ações', classe: 'col-acoes', valor: (c) => [
                botaoPequeno('Editar', () => formularioCliente(c)),
                botaoPequeno(c.ativo ? 'Desativar' : 'Reativar', () => alternarStatus({
                    url: `/api/clientes/${c.id}/ativo`, ativoAtual: c.ativo, nome: c.nome, tipo: 'cliente',
                    recarregar: carregarClientes,
                }), c.ativo ? 'perigo' : 'secundario'),
            ],
        },
    ], clientes, { vazio: 'Nenhum cliente cadastrado.', classeLinha: (c) => (c.ativo ? '' : 'linha-inativa') }));
}

async function formularioCliente(c) {
    const ok = await abrirFormulario({
        titulo: c ? 'Editar cliente' : 'Novo cliente',
        descricao: c ? undefined : 'A data de cadastro é preenchida automaticamente.',
        campos: [
            { nome: 'nome', rotulo: 'Nome', valor: c?.nome, max: 150 },
            { nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', valor: c?.telefone, obrigatorio: false, max: 20 },
        ],
        aoEnviar: (dados) => api(c ? `/api/clientes/${c.id}` : '/api/clientes', { method: c ? 'PUT' : 'POST', body: dados }),
    });
    if (ok) {
        avisar(c ? 'Cliente atualizado.' : 'Cliente cadastrado.');
        carregarClientes();
    }
}
document.querySelector('#novo-cliente').addEventListener('click', () => formularioCliente());

// ================================================================ Matérias-primas
async function carregarMateriasPrimas() {
    const itens = await api('/api/materias-primas');
    document.querySelector('#lista-materias-primas').replaceChildren(tabela([
        { titulo: 'Nome', valor: (m) => m.nome },
        { titulo: 'Unidade', valor: (m) => m.unidade },
        { titulo: 'Estoque atual', valor: (m) => formatarQuantidade(m.quantidade, m.unidade) },
        {
            titulo: 'Ações', classe: 'col-acoes', valor: (m) => [
                botaoPequeno('Editar nome', () => editarMateriaPrima(m)),
                botaoPequeno('Excluir', () => excluirMateriaPrima(m), 'perigo'),
            ],
        },
    ], itens, { vazio: 'Nenhuma matéria-prima cadastrada.' }));
}

document.querySelector('#nova-materia-prima').addEventListener('click', async () => {
    const ok = await abrirFormulario({
        titulo: 'Nova matéria-prima',
        campos: [
            { nome: 'nome', rotulo: 'Nome', max: 100 },
            { nome: 'unidade', rotulo: 'Unidade de medida', tipo: 'select', opcoes: OPCOES_UNIDADE },
            {
                nome: 'estoqueInicial', rotulo: 'Estoque inicial', tipo: 'decimal', obrigatorio: false,
                ajuda: 'No máximo 1 casa decimal. Para un, cx e pct, apenas números inteiros.',
            },
        ],
        aoEnviar: (dados) => api('/api/materias-primas', { method: 'POST', body: dados }),
    });
    if (ok) {
        avisar('Matéria-prima cadastrada.');
        carregarMateriasPrimas();
    }
});

async function editarMateriaPrima(m) {
    const ok = await abrirFormulario({
        titulo: 'Editar matéria-prima',
        descricao: `A unidade (${m.unidade}) não pode ser alterada para não distorcer o estoque já lançado.`,
        campos: [{ nome: 'nome', rotulo: 'Nome', valor: m.nome, max: 100 }],
        aoEnviar: (dados) => api(`/api/materias-primas/${m.id}`, { method: 'PUT', body: dados }),
    });
    if (ok) {
        avisar('Matéria-prima atualizada.');
        carregarMateriasPrimas();
    }
}

async function excluirMateriaPrima(m) {
    const ok = await confirmarComSenha({
        titulo: 'Excluir matéria-prima',
        mensagem: `"${m.nome}" sairá do estoque. O cadastro e as movimentações serão guardados no histórico de excluídos.`,
        acao: (senha) => api(`/api/materias-primas/${m.id}`, { method: 'DELETE', body: { senhaEspecial: senha } }),
    });
    if (ok) {
        avisar('Matéria-prima excluída.');
        carregarMateriasPrimas();
    }
}

// ================================================================ Produtos de venda
async function carregarProdutosVenda() {
    const itens = await api('/api/produtos-venda?todos=1');
    document.querySelector('#lista-produtos-venda').replaceChildren(tabela([
        { titulo: 'Nome', valor: (p) => p.nome },
        { titulo: 'Unidade', valor: (p) => p.unidade },
        { titulo: 'Status', valor: (p) => statusEtiqueta(p.ativo) },
        {
            titulo: 'Ações', classe: 'col-acoes', valor: (p) => [
                botaoPequeno('Editar', () => formularioProdutoVenda(p)),
                botaoPequeno(p.ativo ? 'Desativar' : 'Reativar', () => alternarStatus({
                    url: `/api/produtos-venda/${p.id}/ativo`, ativoAtual: p.ativo, nome: p.nome, tipo: 'produto',
                    recarregar: carregarProdutosVenda,
                }), p.ativo ? 'perigo' : 'secundario'),
            ],
        },
    ], itens, { vazio: 'Nenhum produto de venda cadastrado.', classeLinha: (p) => (p.ativo ? '' : 'linha-inativa') }));
}

async function formularioProdutoVenda(p) {
    const ok = await abrirFormulario({
        titulo: p ? 'Editar produto de venda' : 'Novo produto de venda',
        descricao: p ? 'A unidade só pode ser alterada se o produto ainda não tiver vendas.' : undefined,
        campos: [
            { nome: 'nome', rotulo: 'Nome', valor: p?.nome, max: 100 },
            { nome: 'unidade', rotulo: 'Unidade de medida', tipo: 'select', opcoes: OPCOES_UNIDADE, valor: p?.unidade },
        ],
        aoEnviar: (dados) => api(p ? `/api/produtos-venda/${p.id}` : '/api/produtos-venda', { method: p ? 'PUT' : 'POST', body: dados }),
    });
    if (ok) {
        avisar(p ? 'Produto atualizado.' : 'Produto cadastrado.');
        carregarProdutosVenda();
    }
}
document.querySelector('#novo-produto-venda').addEventListener('click', () => formularioProdutoVenda());

// ================================================================ Categorias de despesa
async function carregarCategorias() {
    const itens = await api('/api/categorias-despesa?todas=1');
    document.querySelector('#lista-categorias').replaceChildren(tabela([
        { titulo: 'Nome', valor: (c) => c.nome },
        { titulo: 'Status', valor: (c) => (c.ativa ? etiqueta('Ativa', 'sucesso') : etiqueta('Desativada', 'neutra')) },
        {
            titulo: 'Ações', classe: 'col-acoes', valor: (c) => [
                botaoPequeno('Renomear', () => formularioCategoria(c)),
                botaoPequeno(c.ativa ? 'Desativar' : 'Reativar', () => alternarStatus({
                    url: `/api/categorias-despesa/${c.id}/ativa`, campo: 'ativa', ativoAtual: c.ativa, nome: c.nome,
                    tipo: 'categoria', recarregar: carregarCategorias,
                }), c.ativa ? 'perigo' : 'secundario'),
                !c.tem_registros && botaoPequeno('Excluir', () => excluirCategoria(c), 'perigo'),
            ],
        },
    ], itens, { classeLinha: (c) => (c.ativa ? '' : 'linha-inativa') }));
}

async function formularioCategoria(c) {
    const ok = await abrirFormulario({
        titulo: c ? 'Renomear categoria' : 'Nova categoria de despesa',
        campos: [{ nome: 'nome', rotulo: 'Nome', valor: c?.nome, max: 100 }],
        aoEnviar: (dados) => api(c ? `/api/categorias-despesa/${c.id}` : '/api/categorias-despesa', { method: c ? 'PUT' : 'POST', body: dados }),
    });
    if (ok) {
        avisar(c ? 'Categoria renomeada.' : 'Categoria criada.');
        carregarCategorias();
    }
}
document.querySelector('#nova-categoria').addEventListener('click', () => formularioCategoria());

async function excluirCategoria(c) {
    const ok = await confirmarComSenha({
        titulo: 'Excluir categoria',
        mensagem: `A categoria "${c.nome}" não tem despesas registradas e será excluída definitivamente.`,
        acao: (senha) => api(`/api/categorias-despesa/${c.id}`, { method: 'DELETE', body: { senhaEspecial: senha } }),
    });
    if (ok) {
        avisar('Categoria excluída.');
        carregarCategorias();
    }
}

// ================================================================ Inicialização
const secoes = [{ id: 'secao-minha-senha', nome: 'Minha senha' }];

if (gestor) {
    for (const s of document.querySelectorAll('.somente-gestao')) s.hidden = false;
    ligarFormulario(document.querySelector('#form-senha-especial'), '/api/configuracoes/senha-especial', 'Senha especial alterada.');
    secoes.push(
        { id: 'secao-senha-especial', nome: 'Senha especial' },
        { id: 'secao-usuarios', nome: 'Usuários' },
        { id: 'secao-clientes', nome: 'Clientes' },
        { id: 'secao-materias-primas', nome: 'Matérias-primas' },
        { id: 'secao-produtos-venda', nome: 'Produtos de venda' },
        { id: 'secao-categorias', nome: 'Categorias' },
    );
    const carregamentos = [carregarUsuarios, carregarClientes, carregarMateriasPrimas, carregarProdutosVenda, carregarCategorias];
    Promise.all(carregamentos.map((f) => f().catch((err) => avisar(err.message, 'erro'))));
}

// Atalhos para as seções (útil quando há muitas).
if (secoes.length > 1) {
    document.querySelector('#config-atalhos').replaceChildren(
        ...secoes.map((s) => el('a', { href: `#${s.id}` }, s.nome)));
}
