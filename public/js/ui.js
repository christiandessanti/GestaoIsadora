/**
 * Utilitários de interface reaproveitados por todas as páginas.
 * Todo texto vindo do banco é inserido com textContent (nunca innerHTML),
 * o que impede a execução de código malicioso cadastrado em algum campo.
 */

export const UNIDADES = ['kg', 'g', 'L', 'ml', 'un', 'cx', 'pct'];
export const UNIDADES_INTEIRAS = ['un', 'cx', 'pct'];

// ---------------------------------------------------------------- DOM
/** Cria um elemento: el('button', { class: 'x', onclick: fn }, 'Texto') */
export function el(tag, props = {}, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else if (k === 'class') e.className = v;
        else if (k in e && typeof v !== 'string') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) {
        if (f === null || f === undefined || f === false) continue;
        e.append(f instanceof Node ? f : document.createTextNode(String(f)));
    }
    return e;
}

// ---------------------------------------------------------------- Formatação
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatarMoeda = (v) => moeda.format(Number(v ?? 0));

/** Quantidade com no máximo 1 casa decimal (inteira para un, cx e pct) + unidade. */
export function formatarQuantidade(q, unidade) {
    const casas = UNIDADES_INTEIRAS.includes(unidade) ? 0 : 1;
    const n = Number(q ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });
    return unidade ? `${n} ${unidade}` : n;
}

/** '2026-11-03' ou '2026-11-03 14:30:00' -> '03/11/2026' */
export function formatarData(d) {
    if (!d) return '—';
    const [a, m, dia] = String(d).slice(0, 10).split('-');
    return `${dia}/${m}/${a}`;
}

/** '2026-11-03 14:30:00' -> '03/11/2026 14:30' */
export function formatarDataHora(d) {
    if (!d) return '—';
    return `${formatarData(d)} ${String(d).slice(11, 16)}`.trim();
}

/** Data de hoje no formato do <input type="date"> (AAAA-MM-DD), no fuso local. */
export function hoje() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- Mensagens
let areaAvisos;
/** Mostra um aviso rápido no canto da tela. tipo: 'sucesso' | 'erro' */
export function avisar(mensagem, tipo = 'sucesso') {
    if (!areaAvisos) {
        areaAvisos = el('div', { class: 'avisos', 'aria-live': 'polite' });
        document.body.append(areaAvisos);
    }
    const aviso = el('div', { class: `aviso aviso-${tipo}`, role: tipo === 'erro' ? 'alert' : 'status' }, mensagem);
    areaAvisos.append(aviso);
    setTimeout(() => aviso.remove(), tipo === 'erro' ? 6000 : 3500);
}

// ---------------------------------------------------------------- Formulário em modal
/**
 * Abre um formulário em janela (dialog).
 * campos: [{ nome, rotulo, tipo, valor, opcoes, obrigatorio, ajuda, autocomplete, max, inputmode }]
 *   tipo: 'text' | 'password' | 'tel' | 'date' | 'select' | 'checkbox' | 'textarea' | 'decimal'
 * aoEnviar(valores): função async; se lançar erro, a mensagem aparece no próprio formulário.
 * Retorna uma Promise com o resultado de aoEnviar, ou null se cancelado.
 */
export function abrirFormulario({
    titulo, descricao, campos, textoConfirmar = 'Salvar', perigo = false, aoEnviar, acoes, conteudoExtra,
}) {
    return new Promise((resolve) => {
        const erro = el('p', { class: 'form-erro', role: 'alert' });
        const inputs = {};

        const linhas = campos.map((c) => {
            const id = `campo-${c.nome}-${Math.random().toString(36).slice(2, 8)}`;
            let input;
            if (c.tipo === 'select') {
                input = el('select', { id, name: c.nome, required: c.obrigatorio !== false },
                    c.opcoes.map((o) => el('option', { value: o.valor, selected: String(o.valor) === String(c.valor ?? '') }, o.rotulo)));
            } else if (c.tipo === 'textarea') {
                input = el('textarea', { id, name: c.nome, rows: 3, maxlength: c.max ?? 255 });
                input.value = c.valor ?? '';
            } else if (c.tipo === 'checkbox') {
                input = el('input', { id, name: c.nome, type: 'checkbox', checked: Boolean(c.valor) });
                inputs[c.nome] = input;
                return el('label', { class: 'form-checkbox', for: id }, input, c.rotulo);
            } else {
                const decimal = c.tipo === 'decimal';
                input = el('input', {
                    id, name: c.nome,
                    type: decimal ? 'text' : (c.tipo ?? 'text'),
                    inputmode: c.inputmode ?? (decimal ? 'decimal' : undefined),
                    autocomplete: c.autocomplete ?? (c.tipo === 'password' ? 'new-password' : 'off'),
                    maxlength: c.max,
                    required: c.obrigatorio !== false,
                });
                input.value = c.valor ?? '';
            }
            inputs[c.nome] = input;
            return el('div', { class: 'form-campo' },
                el('label', { for: id }, c.rotulo + (c.obrigatorio === false ? ' (opcional)' : '')),
                input,
                c.ajuda && el('small', {}, c.ajuda));
        });

        // "acoes" permite vários botões de envio (ex.: Entrada / Saída). A ação clicada vai para aoEnviar.
        const botoesEnvio = (acoes ?? [{ valor: 'confirmar', texto: textoConfirmar, classe: perigo ? 'botao-perigo' : 'botao-primario' }])
            .map((a) => el('button', { type: 'submit', value: a.valor, class: a.classe ?? 'botao-primario' }, a.texto));
        const botaoCancelar = el('button', { type: 'button', class: 'botao-secundario' }, 'Cancelar');

        const form = el('form', { class: 'form-modal', novalidate: true },
            el('h2', {}, titulo),
            descricao && el('p', { class: 'form-descricao' }, descricao),
            conteudoExtra,
            ...linhas,
            erro,
            el('div', { class: 'form-botoes' }, botaoCancelar, ...botoesEnvio));

        const dialog = el('dialog', { class: 'modal' }, form);
        document.body.append(dialog);

        const fechar = (resultado) => {
            dialog.close();
            dialog.remove();
            resolve(resultado);
        };

        botaoCancelar.addEventListener('click', () => fechar(null));
        dialog.addEventListener('cancel', (e) => { e.preventDefault(); fechar(null); });

        // Com mais de uma ação (ex.: Entrada/Saída), o Enter não envia: o usuário precisa escolher o botão.
        if (botoesEnvio.length > 1) {
            form.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault();
            });
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            erro.textContent = '';
            const valores = {};
            for (const [nome, input] of Object.entries(inputs)) {
                valores[nome] = input.type === 'checkbox' ? input.checked : input.value;
            }
            const acao = e.submitter?.value ?? botoesEnvio[0].value;
            botoesEnvio.forEach((b) => { b.disabled = true; });
            try {
                const resultado = aoEnviar ? await aoEnviar(valores, acao) : valores;
                fechar(resultado ?? true);
            } catch (err) {
                erro.textContent = err.message;
            } finally {
                botoesEnvio.forEach((b) => { b.disabled = false; });
            }
        });

        dialog.showModal();
        Object.values(inputs)[0]?.focus();
    });
}

/**
 * Pede a senha especial (ou a senha do TI) antes de executar uma ação protegida.
 * acao(senha) deve chamar a API enviando { senhaEspecial: senha }.
 */
export function confirmarComSenha({ titulo, mensagem, textoConfirmar = 'Excluir', acao }) {
    return abrirFormulario({
        titulo,
        descricao: mensagem,
        textoConfirmar,
        perigo: true,
        campos: [{
            nome: 'senha', rotulo: 'Senha especial', tipo: 'password', autocomplete: 'off',
            ajuda: 'A senha do usuário TI também é aceita.',
        }],
        aoEnviar: ({ senha }) => {
            if (!senha) throw new Error('Informe a senha especial.');
            return acao(senha);
        },
    });
}

/** Confirmação simples (sem senha). */
export function confirmar({ titulo, mensagem, textoConfirmar = 'Confirmar', perigo = false }) {
    return abrirFormulario({ titulo, descricao: mensagem, textoConfirmar, perigo, campos: [] });
}

// ---------------------------------------------------------------- Tabelas
/**
 * Monta uma tabela simples.
 * colunas: [{ titulo, valor: (linha) => texto | Node, classe }]
 */
export function tabela(colunas, linhas, { vazio = 'Nenhum registro.', classeLinha } = {}) {
    if (!linhas.length) return el('p', { class: 'tabela-vazia' }, vazio);
    return el('div', { class: 'tabela-container' },
        el('table', { class: 'tabela' },
            el('thead', {}, el('tr', {}, colunas.map((c) => el('th', { class: c.classe }, c.titulo)))),
            el('tbody', {}, linhas.map((l) =>
                el('tr', { class: classeLinha?.(l) },
                    colunas.map((c) => el('td', { class: c.classe, 'data-titulo': c.titulo }, c.valor(l))))))));
}

export function etiqueta(texto, tipo = 'neutra') {
    return el('span', { class: `etiqueta etiqueta-${tipo}` }, texto);
}

export function botaoPequeno(texto, onclick, tipo = 'secundario') {
    return el('button', { type: 'button', class: `botao-pequeno botao-${tipo}`, onclick }, texto);
}

// ---------------------------------------------------------------- Seleção múltipla (filtros)
/**
 * Grupo de caixas de seleção com "Marcar todos" / "Desmarcar todos". Tudo vem marcado.
 * itens: [{ valor, rotulo, detalhe? }]
 * valores(): null se todos estiverem marcados (= sem filtro), senão a lista dos marcados.
 */
export function criarSelecao({ titulo, itens, vazio = 'Nenhum item.' }) {
    const lista = el('div', { class: 'selecao-itens-lista' });
    const marcar = (v) => lista.querySelectorAll('input').forEach((c) => { c.checked = v; });

    const elemento = el('fieldset', { class: 'selecao-itens' },
        el('legend', {}, titulo,
            botaoPequeno('Marcar todos', () => marcar(true)),
            botaoPequeno('Desmarcar todos', () => marcar(false))),
        lista);

    function definirItens(novos) {
        lista.replaceChildren(...(novos.length
            ? novos.map((i) => el('label', { class: 'form-checkbox' },
                el('input', { type: 'checkbox', value: i.valor, checked: true }),
                i.rotulo, i.detalhe))
            : [el('span', { class: 'texto-suave' }, vazio)]));
    }
    definirItens(itens);

    return {
        elemento,
        definirItens,
        titulo,
        valores() {
            const caixas = [...lista.querySelectorAll('input')];
            const marcados = caixas.filter((c) => c.checked).map((c) => c.value);
            if (caixas.length && !marcados.length) throw new Error(`Selecione pelo menos um item em "${titulo}".`);
            return marcados.length === caixas.length ? null : marcados;
        },
    };
}

/** Converte texto digitado em número: aceita "1.234,56", "1234,56" e "1234.56". */
export function lerNumero(texto) {
    let t = String(texto ?? '').trim();
    if (!t) return NaN;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    return Number(t);
}

/** Número para exibir num campo de texto: 5.5 -> "5,50" (casas = 2) */
export const numeroParaCampo = (n, casas = 2) => Number(n).toFixed(casas).replace('.', ',');
