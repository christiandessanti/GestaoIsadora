/**
 * Comportamentos de página reaproveitados: lista paginada e formulário de relatório.
 */
import { api, baixarArquivo } from './api.js';
import { tabela, avisar, hoje } from './ui.js';

/**
 * Lista com os registros mais recentes primeiro, carregando mais ao rolar a página.
 * A API deve responder { [chave]: [...], proxima: 'cursor' | null } e aceitar ?apos=cursor.
 */
export function listaPaginada({ container, botaoMais, url, chave, colunas, vazio }) {
    let proxima = null;
    let carregando = false;
    let corpo = null;

    async function carregar(reiniciar) {
        if (carregando) return;
        carregando = true;
        try {
            if (reiniciar) proxima = null;
            const dados = await api(proxima ? `${url}?apos=${encodeURIComponent(proxima)}` : url);
            const registros = dados[chave];
            if (reiniciar || !corpo) {
                const t = tabela(colunas, registros, { vazio });
                container.replaceChildren(t);
                corpo = t.querySelector('tbody');
            } else {
                tabela(colunas, registros).querySelectorAll('tbody tr').forEach((tr) => corpo.append(tr));
            }
            proxima = dados.proxima;
            botaoMais.hidden = !proxima;
        } catch (err) {
            avisar(err.message, 'erro');
        } finally {
            carregando = false;
        }
    }

    botaoMais.addEventListener('click', () => carregar(false));
    // Carrega a próxima página automaticamente quando o botão "Carregar mais" fica visível.
    new IntersectionObserver((entradas) => {
        if (entradas.some((e) => e.isIntersecting) && proxima) carregar(false);
    }, { rootMargin: '200px' }).observe(botaoMais);

    carregar(true);
    return { recarregar: () => carregar(true) };
}

/**
 * Liga um formulário de relatório: datas (padrão: do dia 1º do mês até hoje),
 * botão "Gerar relatório" (submit), "Exportar CSV" (#rel-csv) e "Exportar PDF" (#rel-pdf).
 *
 * parametros(): objeto com os filtros extras; valores null são omitidos. Pode lançar Error (mostrado no formulário).
 * mostrar(dados): exibe o resultado na tela.
 */
export function configurarRelatorio({ form, endpoint, parametros = () => ({}), mostrar }) {
    const erro = form.querySelector('.form-erro');
    form.inicio.value = `${hoje().slice(0, 8)}01`;
    form.fim.value = hoje();

    function montarUrl(formato) {
        erro.textContent = '';
        if (!form.inicio.value || !form.fim.value) throw new Error('Informe a data inicial e a data final.');
        if (form.inicio.value > form.fim.value) throw new Error('A data inicial não pode ser maior que a data final.');
        const p = new URLSearchParams({ inicio: form.inicio.value, fim: form.fim.value, formato });
        for (const [k, valor] of Object.entries(parametros())) {
            if (valor !== null && valor !== undefined) p.set(k, Array.isArray(valor) ? valor.join(',') : valor);
        }
        return `${endpoint}?${p}`;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const botao = e.submitter;
        if (botao) botao.disabled = true;
        try {
            mostrar(await api(montarUrl('json')));
        } catch (err) {
            erro.textContent = err.message;
        } finally {
            if (botao) botao.disabled = false;
        }
    });

    for (const formato of ['csv', 'pdf']) {
        form.querySelector(`#rel-${formato}`)?.addEventListener('click', async (e) => {
            const botao = e.currentTarget;
            botao.disabled = true;
            try {
                await baixarArquivo(montarUrl(formato));
            } catch (err) {
                erro.textContent = err.message;
            } finally {
                botao.disabled = false;
            }
        });
    }
}
