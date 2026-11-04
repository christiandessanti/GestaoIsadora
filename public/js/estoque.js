import { api, baixarArquivo } from './api.js';
import { usuarioAtual } from './layout.js';
import {
    el, tabela, etiqueta, avisar, abrirFormulario,
    formatarQuantidade, formatarDataHora, hoje, UNIDADES_INTEIRAS,
} from './ui.js';

const gestor = ['ti', 'gerente'].includes(usuarioAtual.perfil);
const NOMES_OPERACAO = { inicial: 'Inicial', entrada: 'Entrada', saida: 'Saída' };

/** Ex.: etiqueta "Entrada +20 kg" ou "Saída −5 kg". */
function ultimaOperacao(tipo, qtd, unidade) {
    if (!tipo) return '—';
    const saida = tipo === 'saida';
    return etiqueta(`${NOMES_OPERACAO[tipo]} ${saida ? '−' : '+'}${formatarQuantidade(qtd, unidade)}`,
        saida ? 'saida' : 'entrada');
}

// ================================================================ Lista
async function carregarEstoque() {
    const produtos = await api('/api/materias-primas');
    document.querySelector('#contador-produtos').textContent =
        `${produtos.length} produto${produtos.length === 1 ? '' : 's'}`;

    const vazio = el('p', { class: 'tabela-vazia' },
        'Nenhuma matéria-prima cadastrada. ',
        gestor ? el('a', { href: 'configuracoes.html#secao-materias-primas' }, 'Cadastrar em Configurações') : 'Peça a um gerente para cadastrar.');

    document.querySelector('#lista-estoque').replaceChildren(produtos.length ? tabela([
        {
            titulo: 'Produto',
            valor: (p) => el('button', { type: 'button', class: 'link-produto', onclick: () => movimentar(p) }, p.nome),
        },
        { titulo: 'Quantidade', classe: 'col-numero', valor: (p) => formatarQuantidade(p.quantidade, p.unidade) },
        { titulo: 'Última operação', valor: (p) => ultimaOperacao(p.ultima_operacao_tipo, p.ultima_operacao_qtd, p.unidade) },
        { titulo: 'Data últ. alteração', valor: (p) => formatarDataHora(p.ultima_alteracao_em) },
    ], produtos) : vazio);
}

// ================================================================ Entrada / Saída
async function movimentar(p) {
    const inteira = UNIDADES_INTEIRAS.includes(p.unidade);
    const resultado = await abrirFormulario({
        titulo: 'Alterar estoque',
        conteudoExtra: el('div', { class: 'modal-produto' },
            el('strong', {}, p.nome),
            el('span', {}, 'Estoque atual: ', el('b', {}, formatarQuantidade(p.quantidade, p.unidade)))),
        campos: [
            {
                nome: 'quantidade', rotulo: `Quantidade (${p.unidade})`, tipo: 'decimal',
                inputmode: inteira ? 'numeric' : 'decimal',
                ajuda: inteira ? 'Apenas números inteiros.' : 'No máximo 1 casa decimal (ex.: 12,5).',
            },
            { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', obrigatorio: false, max: 255 },
        ],
        acoes: [
            { valor: 'saida', texto: '− Saída', classe: 'botao-perigo' },
            { valor: 'entrada', texto: '+ Entrada', classe: 'botao-primario' },
        ],
        aoEnviar: (dados, tipo) => api('/api/estoque/movimentacoes', {
            method: 'POST',
            body: { materiaPrimaId: p.id, tipo, quantidade: dados.quantidade, observacao: dados.observacao },
        }),
    });
    if (resultado) {
        avisar(`${resultado.ultima_operacao_tipo === 'saida' ? 'Saída' : 'Entrada'} registrada. `
            + `Estoque de ${resultado.nome}: ${formatarQuantidade(resultado.quantidade, resultado.unidade)}.`);
        carregarEstoque();
    }
}

// ================================================================ Relatório
const form = document.querySelector('#form-relatorio');
const erroRelatorio = form.querySelector('.form-erro');
const listaProdutos = document.querySelector('#rel-produtos');

const primeiroDiaDoMes = () => `${hoje().slice(0, 8)}01`;
form.inicio.value = primeiroDiaDoMes();
form.fim.value = hoje();

/** Atualiza as caixas de seleção conforme o status (ativos/ambos/excluídos). Tudo marcado por padrão. */
async function carregarProdutosFiltro() {
    const produtos = await api(`/api/estoque/relatorio/produtos?status=${form.status.value}`);
    listaProdutos.replaceChildren(...(produtos.length
        ? produtos.map((p) => el('label', { class: 'form-checkbox' },
            el('input', { type: 'checkbox', name: 'produto', value: p.id, checked: true }),
            p.nome, p.excluido && etiqueta('excluído', 'neutra')))
        : [el('span', { class: 'texto-suave' }, 'Nenhum produto para este filtro.')]));
}

form.status.addEventListener('change', () => carregarProdutosFiltro().catch((e) => avisar(e.message, 'erro')));
document.querySelector('#rel-marcar-todos').addEventListener('click', () => marcarTodos(true));
document.querySelector('#rel-desmarcar-todos').addEventListener('click', () => marcarTodos(false));

function marcarTodos(marcado) {
    for (const c of listaProdutos.querySelectorAll('input[type="checkbox"]')) c.checked = marcado;
}

/** Monta os parâmetros do relatório. Se todos estiverem marcados, envia "todos" (sem lista). */
function parametros(formato) {
    erroRelatorio.textContent = '';
    if (!form.inicio.value || !form.fim.value) throw new Error('Informe a data inicial e a data final.');
    if (form.inicio.value > form.fim.value) throw new Error('A data inicial não pode ser maior que a data final.');

    const caixas = [...listaProdutos.querySelectorAll('input[type="checkbox"]')];
    const marcados = caixas.filter((c) => c.checked).map((c) => c.value);
    if (caixas.length && !marcados.length) throw new Error('Selecione pelo menos um produto.');

    const p = new URLSearchParams({ inicio: form.inicio.value, fim: form.fim.value, status: form.status.value, formato });
    if (marcados.length < caixas.length) p.set('produtos', marcados.join(','));
    return p.toString();
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        mostrarRelatorio(await api(`/api/estoque/relatorio?${parametros('json')}`));
    } catch (err) {
        erroRelatorio.textContent = err.message;
    }
});

for (const formato of ['csv', 'pdf']) {
    document.querySelector(`#rel-${formato}`).addEventListener('click', async (e) => {
        const botao = e.currentTarget;
        botao.disabled = true;
        try {
            await baixarArquivo(`/api/estoque/relatorio?${parametros(formato)}`);
        } catch (err) {
            erroRelatorio.textContent = err.message;
        } finally {
            botao.disabled = false;
        }
    });
}

function mostrarRelatorio(rel) {
    const q = formatarQuantidade;
    const nome = (r) => [r.nome ?? r.produto, r.excluido && ' ', r.excluido && etiqueta('excluído', 'neutra')];
    const comSinal = (n, u) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${q(Math.abs(n), u)}`;

    document.querySelector('#resultado-relatorio').replaceChildren(
        el('h4', { class: 'relatorio-titulo' }, 'Resumo por produto'),
        tabela([
            { titulo: 'Produto', valor: nome },
            { titulo: 'Estoque no início', classe: 'col-numero', valor: (r) => q(r.estoqueInicial, r.unidade) },
            { titulo: 'Entradas', classe: 'col-numero', valor: (r) => `+${q(r.entradas, r.unidade)}` },
            { titulo: 'Saídas', classe: 'col-numero', valor: (r) => `${r.saidas ? '−' : ''}${q(r.saidas, r.unidade)}` },
            { titulo: 'Saldo do período', classe: 'col-numero', valor: (r) => el('strong', {}, comSinal(r.saldo, r.unidade)) },
            { titulo: 'Estoque no fim', classe: 'col-numero', valor: (r) => q(r.estoqueFinal, r.unidade) },
        ], rel.resumo, { vazio: 'Nenhum produto selecionado.' }),

        el('h4', { class: 'relatorio-titulo' }, `Movimentações (${rel.movimentacoes.length})`),
        tabela([
            { titulo: 'Data/hora', valor: (m) => formatarDataHora(m.data) },
            { titulo: 'Produto', valor: nome },
            { titulo: 'Tipo', valor: (m) => etiqueta(NOMES_OPERACAO[m.tipo], m.tipo === 'saida' ? 'saida' : 'entrada') },
            { titulo: 'Quantidade', classe: 'col-numero', valor: (m) => `${m.tipo === 'saida' ? '−' : '+'}${q(m.quantidade, m.unidade)}` },
            { titulo: 'Saldo após', classe: 'col-numero', valor: (m) => q(m.saldoApos, m.unidade) },
            { titulo: 'Observação', valor: (m) => m.observacao || '—' },
            { titulo: 'Usuário', valor: (m) => m.usuario },
        ], rel.movimentacoes, { vazio: 'Nenhuma movimentação no período.' }),
    );
}

// ================================================================ Inicialização
carregarEstoque().catch((e) => avisar(e.message, 'erro'));
carregarProdutosFiltro().catch((e) => avisar(e.message, 'erro'));
