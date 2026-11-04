import { api } from './api.js';
import './layout.js';
import { el, avisar, formatarMoeda, formatarData, formatarQuantidade } from './ui.js';

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

async function carregar() {
    const dados = await api('/api/inicio');

    // ---------- Vendas do mês
    const { vendasMes, ultimasVendas } = dados;
    const mes = NOMES_MES[Number(vendasMes.inicio.slice(5, 7)) - 1];
    document.querySelector('#total-vendas-mes').textContent = formatarMoeda(vendasMes.total);
    document.querySelector('#info-vendas-mes').textContent =
        `${vendasMes.quantidade} venda${vendasMes.quantidade === 1 ? '' : 's'} em ${mes}`;

    document.querySelector('#ultimas-vendas').replaceChildren(...(ultimasVendas.length
        ? [el('h3', { class: 'subtitulo-card' }, 'Últimas vendas'),
            ...ultimasVendas.map((v) => el('div', { class: 'venda-item' },
                el('div', {},
                    el('span', { class: 'cliente' }, v.cliente),
                    el('span', { class: 'data-venda' }, formatarData(v.data_venda))),
                el('span', { class: 'valor-venda' }, formatarMoeda(v.valor_total))))]
        : [el('p', { class: 'tabela-vazia' }, 'Nenhuma venda registrada ainda.')]));

    // ---------- Estoque (todos os produtos)
    const { estoque } = dados;
    document.querySelector('#contador-estoque').textContent =
        `${estoque.length} produto${estoque.length === 1 ? '' : 's'}`;
    document.querySelector('#lista-estoque-inicio').replaceChildren(...(estoque.length
        ? estoque.map((p) => el('div', { class: `estoque-item ${Number(p.quantidade) === 0 ? 'estoque-zerado' : ''}` },
            el('span', {}, p.nome),
            el('span', {}, formatarQuantidade(p.quantidade, p.unidade))))
        : [el('p', { class: 'tabela-vazia' }, 'Nenhuma matéria-prima cadastrada.')]));
}

carregar().catch((e) => avisar(e.message, 'erro'));
