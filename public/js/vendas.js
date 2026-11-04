import { api, baixarArquivo } from './api.js';
import './layout.js';
import {
    el, tabela, etiqueta, botaoPequeno, avisar, confirmarComSenha, criarSelecao,
    formatarMoeda, formatarQuantidade, formatarData, hoje, lerNumero, numeroParaCampo, UNIDADES_INTEIRAS,
} from './ui.js';

const NOMES_PAGAMENTO = { avista: 'À vista', aprazo: 'A prazo' };
const textoItens = (itens) => itens.map((i) => `${i.produto} (${formatarQuantidade(i.quantidade, i.unidade)})`).join(', ');

// ================================================================ Lista (mais recentes primeiro)
const lista = document.querySelector('#lista-vendas');
const botaoMais = document.querySelector('#carregar-mais');
let proxima = null;
let carregando = false;
let corpoTabela = null;

const COLUNAS = [
    { titulo: 'Data', valor: (x) => formatarData(x.data_venda) },
    { titulo: 'Cliente', valor: (x) => x.cliente },
    { titulo: 'Produtos', valor: (x) => textoItens(x.itens) },
    { titulo: 'Pagamento', valor: (x) => etiqueta(NOMES_PAGAMENTO[x.pagamento], x.pagamento === 'avista' ? 'sucesso' : 'neutra') },
    { titulo: 'Valor', classe: 'col-numero', valor: (x) => el('strong', {}, formatarMoeda(x.valor_total)) },
    {
        titulo: 'Ações', classe: 'col-acoes', valor: (x) => [
            botaoPequeno('Editar', () => abrirVenda(x.id)),
            botaoPequeno('Excluir', () => excluirVenda(x), 'perigo'),
        ],
    },
];

async function carregarVendas({ reiniciar = false } = {}) {
    if (carregando) return;
    carregando = true;
    try {
        if (reiniciar) proxima = null;
        const url = proxima ? `/api/vendas?apos=${encodeURIComponent(proxima)}` : '/api/vendas';
        const { vendas, proxima: seguinte } = await api(url);

        if (reiniciar || !corpoTabela) {
            const t = tabela(COLUNAS, vendas, { vazio: 'Nenhuma venda registrada ainda.' });
            lista.replaceChildren(t);
            corpoTabela = t.querySelector('tbody');
        } else {
            // Acrescenta as linhas da nova página à tabela existente.
            const t = tabela(COLUNAS, vendas);
            t.querySelectorAll('tbody tr').forEach((tr) => corpoTabela.append(tr));
        }
        proxima = seguinte;
        botaoMais.hidden = !proxima;
    } catch (err) {
        avisar(err.message, 'erro');
    } finally {
        carregando = false;
    }
}

botaoMais.addEventListener('click', () => carregarVendas());

// Carrega a próxima página automaticamente quando o botão "Carregar mais" aparece na tela.
new IntersectionObserver((entradas) => {
    if (entradas.some((e) => e.isIntersecting) && proxima) carregarVendas();
}, { rootMargin: '200px' }).observe(botaoMais);

// ================================================================ Formulário de venda
async function abrirVenda(id) {
    try {
        const [clientes, produtos, venda] = await Promise.all([
            api('/api/clientes'),
            api('/api/produtos-venda'),
            id ? api(`/api/vendas/${id}`) : null,
        ]);
        if (!clientes.length || !produtos.length) {
            avisar('Cadastre pelo menos um cliente e um produto de venda em Configurações antes de registrar vendas.', 'erro');
            return;
        }
        formularioVenda({ clientes, produtos, venda });
    } catch (err) {
        avisar(err.message, 'erro');
    }
}
document.querySelector('#nova-venda').addEventListener('click', () => abrirVenda());

function formularioVenda({ clientes, produtos, venda }) {
    // Na edição, cliente/produtos desativados que já estão na venda continuam disponíveis.
    if (venda && !clientes.some((c) => c.id === venda.cliente_id)) {
        clientes.push({ id: venda.cliente_id, nome: `${venda.cliente} (desativado)` });
    }
    for (const i of venda?.itens ?? []) {
        if (!produtos.some((p) => p.id === i.produtoId)) {
            produtos.push({ id: i.produtoId, nome: `${i.produto} (desativado)`, unidade: i.unidade });
        }
    }
    const produtoPorId = new Map(produtos.map((p) => [String(p.id), p]));
    let ultimosPrecos = {};

    // ---------- Campos principais
    const selCliente = el('select', { id: 'venda-cliente', required: true },
        el('option', { value: '' }, 'Selecione o cliente...'),
        clientes.map((c) => el('option', { value: c.id, selected: c.id === venda?.cliente_id }, c.nome)));
    const inpData = el('input', { type: 'date', id: 'venda-data', required: true });
    inpData.value = venda?.data_venda ?? hoje();
    const selPagamento = el('select', { id: 'venda-pagamento' },
        Object.entries(NOMES_PAGAMENTO).map(([valor, rotulo]) =>
            el('option', { value: valor, selected: valor === venda?.pagamento }, rotulo)));

    const itensContainer = el('div', { class: 'venda-itens' });
    const totalEl = el('strong', {}, formatarMoeda(0));
    const erro = el('p', { class: 'form-erro', role: 'alert' });

    // ---------- Linha de item
    function adicionarItem(item) {
        const selProduto = el('select', { 'aria-label': 'Produto' },
            el('option', { value: '' }, 'Produto...'),
            produtos.map((p) => el('option', { value: p.id, selected: p.id === item?.produtoId }, `${p.nome} (${p.unidade})`)));
        const inpQtd = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Qtd.', 'aria-label': 'Quantidade' });
        const inpPreco = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Preço un. (R$)', 'aria-label': 'Preço unitário' });
        const subtotal = el('span', { class: 'venda-item-subtotal' }, formatarMoeda(0));
        const remover = el('button', { type: 'button', class: 'botao-pequeno botao-perigo', 'aria-label': 'Remover produto' }, '✕');

        if (item) {
            inpQtd.value = formatarQuantidade(item.quantidade).replace(/\./g, '');
            inpPreco.value = numeroParaCampo(item.precoUnitario);
            inpPreco.dataset.editado = '1';
        }

        const linha = el('div', { class: 'venda-item' }, selProduto, inpQtd, inpPreco, subtotal, remover);
        linha.atualizarPreco = () => {
            if (inpPreco.dataset.editado) return; // não sobrescreve o que o usuário digitou
            const ultimo = ultimosPrecos[selProduto.value];
            inpPreco.value = ultimo ? numeroParaCampo(ultimo) : '';
            inpPreco.classList.toggle('preco-sugerido', Boolean(ultimo));
        };
        linha.dados = () => ({ produtoId: Number(selProduto.value), quantidade: inpQtd.value, precoUnitario: inpPreco.value });

        selProduto.addEventListener('change', () => {
            const p = produtoPorId.get(selProduto.value);
            inpQtd.inputMode = p && UNIDADES_INTEIRAS.includes(p.unidade) ? 'numeric' : 'decimal';
            inpQtd.placeholder = p ? `Qtd. (${p.unidade})` : 'Qtd.';
            linha.atualizarPreco();
            recalcular();
        });
        inpPreco.addEventListener('input', () => {
            inpPreco.dataset.editado = inpPreco.value ? '1' : '';
            inpPreco.classList.remove('preco-sugerido');
            recalcular();
        });
        inpQtd.addEventListener('input', recalcular);
        remover.addEventListener('click', () => {
            linha.remove();
            if (!itensContainer.children.length) adicionarItem();
            recalcular();
        });

        itensContainer.append(linha);
        selProduto.dispatchEvent(new Event('change'));
        if (item) inpPreco.dataset.editado = '1';
        return linha;
    }

    function recalcular() {
        let total = 0;
        for (const linha of itensContainer.children) {
            const { quantidade, precoUnitario } = linha.dados();
            const q = lerNumero(quantidade);
            const p = lerNumero(precoUnitario);
            const sub = Number.isFinite(q) && Number.isFinite(p) ? Math.round(q * p * 100) / 100 : 0;
            linha.querySelector('.venda-item-subtotal').textContent = formatarMoeda(sub);
            total += sub;
        }
        totalEl.textContent = formatarMoeda(total);
    }

    // Ao escolher o cliente, busca o último preço praticado para cada produto.
    async function carregarPrecos() {
        ultimosPrecos = selCliente.value
            ? await api(`/api/vendas/ultimos-precos?clienteId=${selCliente.value}`).catch(() => ({}))
            : {};
        for (const linha of itensContainer.children) linha.atualizarPreco();
        recalcular();
    }
    selCliente.addEventListener('change', carregarPrecos);

    // ---------- Montagem do modal
    const botaoSalvar = el('button', { type: 'submit', class: 'botao-primario' }, venda ? 'Salvar alterações' : 'Registrar venda');
    const botaoCancelar = el('button', { type: 'button', class: 'botao-secundario' }, 'Cancelar');

    const form = el('form', { class: 'form-modal', novalidate: true },
        el('h2', {}, venda ? 'Editar venda' : 'Registrar venda'),
        el('div', { class: 'form-campo' }, el('label', { for: 'venda-cliente' }, 'Cliente'), selCliente),
        el('div', { class: 'form-grade-2' },
            el('div', { class: 'form-campo' }, el('label', { for: 'venda-data' }, 'Data da venda'), inpData),
            el('div', { class: 'form-campo' }, el('label', { for: 'venda-pagamento' }, 'Forma de pagamento'), selPagamento)),
        el('div', { class: 'form-campo' },
            el('label', {}, 'Produtos'),
            el('small', {}, 'Quantidade com no máximo 1 casa decimal (inteira para un, cx e pct). '
                + 'O preço da última venda para o cliente é sugerido automaticamente.'),
            itensContainer,
            el('button', { type: 'button', class: 'botao-pequeno botao-secundario botao-adicionar', onclick: () => adicionarItem().querySelector('select').focus() },
                '+ Adicionar produto')),
        el('div', { class: 'venda-total' }, el('span', {}, 'Total da venda'), totalEl),
        erro,
        el('div', { class: 'form-botoes' }, botaoCancelar, botaoSalvar));

    const dialog = el('dialog', { class: 'modal modal-largo' }, form);
    document.body.append(dialog);
    const fechar = () => { dialog.close(); dialog.remove(); };
    botaoCancelar.addEventListener('click', fechar);
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); fechar(); });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        erro.textContent = '';
        botaoSalvar.disabled = true;
        try {
            const corpo = {
                clienteId: Number(selCliente.value) || null,
                dataVenda: inpData.value,
                pagamento: selPagamento.value,
                itens: [...itensContainer.children].map((l) => l.dados()),
            };
            if (!corpo.clienteId) throw new Error('Selecione o cliente.');
            await api(venda ? `/api/vendas/${venda.id}` : '/api/vendas', { method: venda ? 'PUT' : 'POST', body: corpo });
            fechar();
            avisar(venda ? 'Venda atualizada.' : 'Venda registrada.');
            carregarVendas({ reiniciar: true });
        } catch (err) {
            erro.textContent = err.message;
        } finally {
            botaoSalvar.disabled = false;
        }
    });

    (venda?.itens.length ? venda.itens : [null]).forEach((i) => adicionarItem(i ?? undefined));
    recalcular();
    dialog.showModal();
    if (venda) carregarPrecos(); else selCliente.focus();
}

// ================================================================ Excluir
async function excluirVenda(x) {
    const ok = await confirmarComSenha({
        titulo: 'Excluir venda',
        mensagem: `Venda de ${formatarMoeda(x.valor_total)} para ${x.cliente} em ${formatarData(x.data_venda)}. `
            + 'Ela será movida para o histórico de vendas excluídas.',
        acao: (senha) => api(`/api/vendas/${x.id}`, { method: 'DELETE', body: { senhaEspecial: senha } }),
    });
    if (ok) {
        avisar('Venda excluída.');
        carregarVendas({ reiniciar: true });
    }
}

// ================================================================ Relatório
const form = document.querySelector('#form-relatorio');
const erroRel = form.querySelector('.form-erro');
form.inicio.value = `${hoje().slice(0, 8)}01`;
form.fim.value = hoje();

const selPagamentos = criarSelecao({
    titulo: 'Formas de pagamento',
    itens: Object.entries(NOMES_PAGAMENTO).map(([valor, rotulo]) => ({ valor, rotulo })),
});
const selClientes = criarSelecao({ titulo: 'Clientes', itens: [], vazio: 'Nenhum cliente cadastrado.' });
const selProdutos = criarSelecao({ titulo: 'Produtos', itens: [], vazio: 'Nenhum produto cadastrado.' });
document.querySelector('#rel-selecoes').append(selPagamentos.elemento, selClientes.elemento, selProdutos.elemento);

async function carregarFiltros() {
    const [clientes, produtos] = await Promise.all([api('/api/clientes?todos=1'), api('/api/produtos-venda?todos=1')]);
    const desativado = (ativo) => (ativo ? null : etiqueta('desativado', 'neutra'));
    selClientes.definirItens(clientes.map((c) => ({ valor: c.id, rotulo: c.nome, detalhe: desativado(c.ativo) })));
    selProdutos.definirItens(produtos.map((p) => ({ valor: p.id, rotulo: p.nome, detalhe: desativado(p.ativo) })));
}

function parametros(formato) {
    erroRel.textContent = '';
    if (!form.inicio.value || !form.fim.value) throw new Error('Informe a data inicial e a data final.');
    if (form.inicio.value > form.fim.value) throw new Error('A data inicial não pode ser maior que a data final.');
    const p = new URLSearchParams({ inicio: form.inicio.value, fim: form.fim.value, formato });
    const filtros = { pagamentos: selPagamentos, clientes: selClientes, produtos: selProdutos };
    for (const [nome, sel] of Object.entries(filtros)) {
        const valores = sel.valores();
        if (valores) p.set(nome, valores.join(','));
    }
    return p.toString();
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        mostrarRelatorio(await api(`/api/vendas/relatorio?${parametros('json')}`));
    } catch (err) {
        erroRel.textContent = err.message;
    }
});

for (const formato of ['csv', 'pdf']) {
    document.querySelector(`#rel-${formato}`).addEventListener('click', async (e) => {
        const botao = e.currentTarget;
        botao.disabled = true;
        try {
            await baixarArquivo(`/api/vendas/relatorio?${parametros(formato)}`);
        } catch (err) {
            erroRel.textContent = err.message;
        } finally {
            botao.disabled = false;
        }
    });
}

function mostrarRelatorio(rel) {
    const r = rel.resumo;
    const card = (rotulo, valor) => el('div', { class: 'resumo-card' }, el('span', {}, rotulo), el('strong', {}, valor));

    document.querySelector('#resultado-relatorio').replaceChildren(
        rel.apenasProdutosSelecionados
            && el('p', { class: 'relatorio-aviso' }, 'Os valores consideram apenas os produtos selecionados.'),
        el('div', { class: 'resumo-cards' },
            card('Vendas', String(r.quantidadeVendas)),
            card('Total vendido', formatarMoeda(r.total)),
            card('À vista', formatarMoeda(r.avista)),
            card('A prazo', formatarMoeda(r.aprazo)),
            card('Ticket médio', formatarMoeda(r.ticketMedio))),

        el('h4', { class: 'relatorio-titulo' }, 'Por cliente'),
        tabela([
            { titulo: 'Cliente', valor: (c) => c.cliente },
            { titulo: 'Vendas', classe: 'col-numero', valor: (c) => String(c.quantidadeVendas) },
            { titulo: 'Total', classe: 'col-numero', valor: (c) => formatarMoeda(c.total) },
        ], rel.porCliente, { vazio: 'Nenhuma venda no período.' }),

        el('h4', { class: 'relatorio-titulo' }, 'Por produto'),
        tabela([
            { titulo: 'Produto', valor: (p) => p.produto },
            { titulo: 'Quantidade', classe: 'col-numero', valor: (p) => formatarQuantidade(p.quantidade, p.unidade) },
            { titulo: 'Total', classe: 'col-numero', valor: (p) => formatarMoeda(p.total) },
        ], rel.porProduto, { vazio: 'Nenhuma venda no período.' }),

        el('h4', { class: 'relatorio-titulo' }, `Vendas (${rel.vendas.length})`),
        tabela([
            { titulo: 'Data', valor: (x) => formatarData(x.data) },
            { titulo: 'Cliente', valor: (x) => x.cliente },
            { titulo: 'Produtos', valor: (x) => textoItens(x.itens) },
            { titulo: 'Pagamento', valor: (x) => NOMES_PAGAMENTO[x.pagamento] },
            { titulo: 'Valor', classe: 'col-numero', valor: (x) => formatarMoeda(x.total) },
        ], rel.vendas, { vazio: 'Nenhuma venda no período.' }),
    );
}

// ================================================================ Inicialização
carregarVendas({ reiniciar: true });
carregarFiltros().catch((e) => avisar(e.message, 'erro'));
