import { api } from './api.js';
import './layout.js';
import { listaPaginada, configurarRelatorio } from './paginas.js';
import {
    el, tabela, etiqueta, botaoPequeno, avisar, abrirFormulario, confirmarComSenha, criarSelecao,
    formatarMoeda, formatarData, hoje, numeroParaCampo,
} from './ui.js';

const nomeCategoria = (nome, ativa) => [nome, !ativa && ' ', !ativa && etiqueta('desativada', 'neutra')];

// ================================================================ Lista (mais recentes primeiro)
const listaDespesas = listaPaginada({
    container: document.querySelector('#lista-despesas'),
    botaoMais: document.querySelector('#carregar-mais'),
    url: '/api/despesas',
    chave: 'despesas',
    vazio: 'Nenhuma despesa registrada ainda.',
    colunas: [
        { titulo: 'Data', valor: (d) => formatarData(d.data_despesa) },
        { titulo: 'Categoria', valor: (d) => nomeCategoria(d.categoria, d.categoria_ativa) },
        { titulo: 'Observação', valor: (d) => d.observacao || '—' },
        { titulo: 'Valor', classe: 'col-numero', valor: (d) => el('strong', {}, formatarMoeda(d.valor)) },
        {
            titulo: 'Ações', classe: 'col-acoes', valor: (d) => [
                botaoPequeno('Editar', () => formularioDespesa(d)),
                botaoPequeno('Excluir', () => excluirDespesa(d), 'perigo'),
            ],
        },
    ],
});

// ================================================================ Registrar / editar
async function formularioDespesa(despesa) {
    let categorias;
    try {
        categorias = await api('/api/categorias-despesa');
    } catch (err) {
        avisar(err.message, 'erro');
        return;
    }
    // Na edição, a categoria atual continua disponível mesmo se tiver sido desativada.
    if (despesa && !categorias.some((c) => c.id === despesa.categoria_id)) {
        categorias.push({ id: despesa.categoria_id, nome: `${despesa.categoria} (desativada)` });
    }

    const ok = await abrirFormulario({
        titulo: despesa ? 'Editar despesa' : 'Registrar despesa',
        campos: [
            {
                nome: 'categoriaId', rotulo: 'Categoria', tipo: 'select', valor: despesa?.categoria_id ?? '',
                opcoes: [{ valor: '', rotulo: 'Selecione a categoria...' }, ...categorias.map((c) => ({ valor: c.id, rotulo: c.nome }))],
            },
            {
                nome: 'valor', rotulo: 'Valor (R$)', tipo: 'decimal',
                valor: despesa ? numeroParaCampo(despesa.valor) : '', ajuda: 'Ex.: 1250,50',
            },
            { nome: 'dataDespesa', rotulo: 'Data', tipo: 'date', valor: despesa?.data_despesa ?? hoje() },
            { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', obrigatorio: false, valor: despesa?.observacao, max: 255 },
        ],
        textoConfirmar: despesa ? 'Salvar alterações' : 'Registrar despesa',
        aoEnviar: (dados) => {
            if (!dados.categoriaId) throw new Error('Selecione a categoria.');
            return api(despesa ? `/api/despesas/${despesa.id}` : '/api/despesas', {
                method: despesa ? 'PUT' : 'POST',
                body: { ...dados, categoriaId: Number(dados.categoriaId) },
            });
        },
    });
    if (ok) {
        avisar(despesa ? 'Despesa atualizada.' : 'Despesa registrada.');
        listaDespesas.recarregar();
    }
}
document.querySelector('#nova-despesa').addEventListener('click', () => formularioDespesa());

async function excluirDespesa(d) {
    const ok = await confirmarComSenha({
        titulo: 'Excluir despesa',
        mensagem: `Despesa de ${formatarMoeda(d.valor)} (${d.categoria}) em ${formatarData(d.data_despesa)}. `
            + 'Ela será movida para o histórico de despesas excluídas.',
        acao: (senha) => api(`/api/despesas/${d.id}`, { method: 'DELETE', body: { senhaEspecial: senha } }),
    });
    if (ok) {
        avisar('Despesa excluída.');
        listaDespesas.recarregar();
    }
}

// ================================================================ Relatório
const form = document.querySelector('#form-relatorio');
const selCategorias = criarSelecao({ titulo: 'Categorias que devem aparecer', itens: [], vazio: 'Nenhuma categoria para este filtro.' });
document.querySelector('#rel-selecoes').append(selCategorias.elemento);

/** Lista as categorias conforme o status escolhido (ativas/ambas/desativadas). Tudo marcado por padrão. */
async function carregarCategoriasFiltro() {
    const status = form.status.value;
    const todas = await api('/api/categorias-despesa?todas=1');
    const filtradas = todas.filter((c) => status === 'ambas' || (status === 'ativas' ? c.ativa : !c.ativa));
    selCategorias.definirItens(filtradas.map((c) => ({
        valor: c.id, rotulo: c.nome, detalhe: !c.ativa && etiqueta('desativada', 'neutra'),
    })));
}
form.status.addEventListener('change', () => carregarCategoriasFiltro().catch((e) => avisar(e.message, 'erro')));

configurarRelatorio({
    form,
    endpoint: '/api/despesas/relatorio',
    parametros: () => ({ status: form.status.value, categorias: selCategorias.valores() }),
    mostrar: mostrarRelatorio,
});

function mostrarRelatorio(rel) {
    const pct = (n) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    document.querySelector('#resultado-relatorio').replaceChildren(
        el('div', { class: 'resumo-cards' },
            el('div', { class: 'resumo-card' }, el('span', {}, 'Lançamentos'), el('strong', {}, String(rel.resumo.quantidade))),
            el('div', { class: 'resumo-card' }, el('span', {}, 'Total de despesas'), el('strong', {}, formatarMoeda(rel.resumo.total)))),

        el('h4', { class: 'relatorio-titulo' }, 'Por categoria'),
        tabela([
            { titulo: 'Categoria', valor: (g) => nomeCategoria(g.categoria, g.ativa) },
            { titulo: 'Lançamentos', classe: 'col-numero', valor: (g) => String(g.quantidade) },
            { titulo: 'Total', classe: 'col-numero', valor: (g) => formatarMoeda(g.total) },
            { titulo: '% do total', classe: 'col-numero', valor: (g) => pct(g.percentual) },
        ], rel.porCategoria, { vazio: 'Nenhuma despesa no período.' }),

        el('h4', { class: 'relatorio-titulo' }, `Despesas (${rel.despesas.length})`),
        tabela([
            { titulo: 'Data', valor: (d) => formatarData(d.data) },
            { titulo: 'Categoria', valor: (d) => nomeCategoria(d.categoria, d.categoriaAtiva) },
            { titulo: 'Valor', classe: 'col-numero', valor: (d) => formatarMoeda(d.valor) },
            { titulo: 'Observação', valor: (d) => d.observacao || '—' },
            { titulo: 'Usuário', valor: (d) => d.usuario },
        ], rel.despesas, { vazio: 'Nenhuma despesa no período.' }),
    );
}

// ================================================================ Inicialização
carregarCategoriasFiltro().catch((e) => avisar(e.message, 'erro'));
