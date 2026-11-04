import { api } from './api.js';
import './layout.js';
import { configurarRelatorio } from './paginas.js';
import { el, tabela, etiqueta, avisar, criarSelecao, formatarMoeda, formatarData } from './ui.js';

const form = document.querySelector('#form-relatorio');

// ================================================================ Filtros (tudo marcado por padrão)
const selReceitas = criarSelecao({
    titulo: 'Receitas',
    itens: [{ valor: 'avista', rotulo: 'Vendas à vista' }, { valor: 'aprazo', rotulo: 'Vendas a prazo' }],
});
const selCategorias = criarSelecao({ titulo: 'Categorias de despesa', itens: [], vazio: 'Nenhuma categoria para este filtro.' });
const selSecoes = criarSelecao({
    titulo: 'Seções exibidas',
    itens: [
        { valor: 'resumo', rotulo: 'Resumo' },
        { valor: 'categorias', rotulo: 'Despesas por categoria' },
        { valor: 'resultado', rotulo: 'Resultado do período' },
    ],
});
document.querySelector('#rel-selecoes').append(selReceitas.elemento, selCategorias.elemento, selSecoes.elemento);

async function carregarCategorias() {
    const status = form.status.value;
    const todas = await api('/api/categorias-despesa?todas=1');
    const filtradas = todas.filter((c) => status === 'ambas' || (status === 'ativas' ? c.ativa : !c.ativa));
    selCategorias.definirItens(filtradas.map((c) => ({
        valor: c.id, rotulo: c.nome, detalhe: !c.ativa && etiqueta('desativada', 'neutra'),
    })));
}
form.status.addEventListener('change', () => carregarCategorias().catch((e) => avisar(e.message, 'erro')));

configurarRelatorio({
    form,
    endpoint: '/api/dre',
    // valores() devolve null quando tudo está marcado (sem filtro) e lança erro se nada estiver marcado.
    parametros: () => ({
        status: form.status.value,
        receitas: selReceitas.valores(),
        categorias: selCategorias.valores(),
        secoes: selSecoes.valores(),
    }),
    mostrar: mostrarDre,
});

// ================================================================ Exibição
const pct = (n) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const nomeCategoria = (c) => [c.nome, !c.ativa && ' ', !c.ativa && etiqueta('desativada', 'neutra')];

function mostrarDre(dre) {
    const secoes = new Set(dre.filtros.secoes);
    const negativo = dre.resultado < 0;
    const partes = [];

    partes.push(el('p', { class: 'dre-periodo' },
        `Período: ${formatarData(dre.filtros.inicio)} a ${formatarData(dre.filtros.fim)}`));

    if (secoes.has('resumo')) {
        partes.push(el('section', { class: 'dre-resumo' },
            ...dre.receitas.map((r) => el('div', { class: 'dre-card' },
                el('span', {}, r.nome), el('strong', {}, formatarMoeda(r.valor)),
                el('small', {}, `${r.quantidade} venda${r.quantidade === 1 ? '' : 's'}`))),
            el('div', { class: 'dre-card' }, el('span', {}, 'Receita total'), el('strong', {}, formatarMoeda(dre.receitaTotal))),
            el('div', { class: 'dre-card' }, el('span', {}, 'Despesas'), el('strong', { class: 'valor-despesa' }, formatarMoeda(dre.despesaTotal))),
            el('div', { class: 'dre-card' }, el('span', {}, 'Resultado'),
                el('strong', { class: negativo ? 'valor-despesa' : '' }, formatarMoeda(dre.resultado)))));
    }

    if (secoes.has('categorias')) {
        partes.push(el('section', { class: 'cartao' },
            el('h3', {}, 'Despesas por categoria'),
            tabela([
                { titulo: 'Categoria', valor: nomeCategoria },
                { titulo: 'Lançamentos', classe: 'col-numero', valor: (c) => String(c.quantidade) },
                { titulo: 'Valor', classe: 'col-numero', valor: (c) => formatarMoeda(c.valor) },
                { titulo: '% das despesas', classe: 'col-numero', valor: (c) => pct(c.percentualDespesas) },
                { titulo: '% da receita', classe: 'col-numero', valor: (c) => pct(c.percentualReceita) },
            ], dre.categorias, { vazio: 'Nenhuma despesa no período para as categorias selecionadas.' }),
            dre.categorias.length > 0 && el('div', { class: 'dre-total' },
                el('span', {}, 'Total de despesas'), el('strong', { class: 'valor-despesa' }, formatarMoeda(dre.despesaTotal)))));
    }

    if (secoes.has('resultado')) {
        partes.push(el('section', { class: 'dre-resultado' },
            el('h3', {}, 'Resultado do período'),
            ...dre.receitas.map((r) => el('div', { class: 'dre-linha dre-linha-detalhe' },
                el('span', {}, r.nome), el('span', {}, formatarMoeda(r.valor)))),
            el('div', { class: 'dre-linha' }, el('span', {}, 'Receita de vendas'), el('strong', {}, formatarMoeda(dre.receitaTotal))),
            el('div', { class: 'dre-linha' }, el('span', {}, '(−) Despesas'),
                el('strong', { class: 'valor-despesa' }, `− ${formatarMoeda(dre.despesaTotal)}`)),
            el('div', { class: 'dre-linha dre-linha-detalhe' }, el('span', {}, 'Margem sobre a receita'), el('span', {}, pct(dre.margem))),
            el('div', { class: `dre-total ${negativo ? 'dre-total-negativo' : ''}` },
                el('span', {}, negativo ? '(=) Prejuízo' : '(=) Resultado'), el('strong', {}, formatarMoeda(dre.resultado)))));
    }

    document.querySelector('#resultado-dre').replaceChildren(...partes);
}

// ================================================================ Inicialização
// Carrega as categorias e já mostra o DRE do mês atual.
carregarCategorias()
    .then(() => form.requestSubmit())
    .catch((e) => avisar(e.message, 'erro'));
