import { api } from './api.js';
import './layout.js';
import { listaPaginada, configurarRelatorio } from './paginas.js';
import {
    el, tabela, etiqueta, botaoPequeno, avisar, confirmarComSenha, criarSelecao,
    formatarMoeda, formatarQuantidade, formatarData, hoje, lerNumero, numeroParaCampo, UNIDADES_INTEIRAS,
} from './ui.js';

const NOMES_PAGAMENTO = { avista: 'À vista', aprazo: 'A prazo' };
const textoItens = (itens) => itens.map((i) => `${i.produto} (${formatarQuantidade(i.quantidade, i.unidade)})`).join(', ');

// ================================================================ Lista (mais recentes primeiro)
const listaVendas = listaPaginada({
    container: document.querySelector('#lista-vendas'),
    botaoMais: document.querySelector('#carregar-mais'),
    url: '/api/vendas',
    chave: 'vendas',
    vazio: 'Nenhuma venda registrada ainda.',
    colunas: [
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
    ],
});

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
        const inpPreco = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Preço (R$)', 'aria-label': 'Preço unitário' });
        const subtotal = el('span', { class: 'item-venda-subtotal' }, formatarMoeda(0));
        const remover = el('button', { type: 'button', class: 'botao-pequeno botao-perigo', 'aria-label': 'Remover produto' }, '✕');

        if (item) {
            inpQtd.value = formatarQuantidade(item.quantidade).replace(/\./g, '');
            inpPreco.value = numeroParaCampo(item.precoUnitario);
            inpPreco.dataset.editado = '1';
        }

        const linha = el('div', { class: 'item-venda' }, selProduto, inpQtd, inpPreco, subtotal, remover);
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

    /**
     * Subtotal em centavos, calculado com inteiros (milésimos × centavos), igual ao servidor.
     * Evita erros de ponto flutuante: 2,5 × 19,99 = 49,975 -> R$ 49,98 (e não 49,97).
     */
    function subtotalCentavos(quantidade, preco) {
        const q = lerNumero(quantidade);
        const p = lerNumero(preco);
        if (!Number.isFinite(q) || !Number.isFinite(p)) return 0;
        const milesimos = Math.round(q * 1000);
        const centavos = Math.round(p * 100);
        return Number((BigInt(milesimos) * BigInt(centavos) + 500n) / 1000n);
    }

    function recalcular() {
        let total = 0;
        for (const linha of itensContainer.children) {
            const { quantidade, precoUnitario } = linha.dados();
            const sub = subtotalCentavos(quantidade, precoUnitario);
            linha.querySelector('.item-venda-subtotal').textContent = formatarMoeda(sub / 100);
            total += sub;
        }
        totalEl.textContent = formatarMoeda(total / 100);
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
            listaVendas.recarregar();
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
        listaVendas.recarregar();
    }
}

// ================================================================ Relatório
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

configurarRelatorio({
    form: document.querySelector('#form-relatorio'),
    endpoint: '/api/vendas/relatorio',
    parametros: () => ({
        pagamentos: selPagamentos.valores(),
        clientes: selClientes.valores(),
        produtos: selProdutos.valores(),
    }),
    mostrar: mostrarRelatorio,
});

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
carregarFiltros().catch((e) => avisar(e.message, 'erro'));
