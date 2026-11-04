/**
 * Partes comuns das páginas internas: usuário logado, botão "Sair"
 * e destaque do item atual no menu.
 * Exporta "usuarioAtual" para que cada página saiba o perfil de quem está logado.
 */
import { api } from './api.js';

export const usuarioAtual = await api('/api/auth/me');

const nome = document.querySelector('#usuario-nome');
if (nome) nome.textContent = usuarioAtual.nome;

document.querySelector('#botao-sair')?.addEventListener('click', async () => {
    try {
        await api('/api/auth/logout', { method: 'POST' });
    } finally {
        window.location.href = '/';
    }
});

// Destaca no menu a página atual.
const paginaAtual = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/main';
for (const link of document.querySelectorAll('nav a')) {
    const destino = new URL(link.href).pathname.replace(/\.html$/, '');
    if (destino === paginaAtual) link.classList.add('ativo');
}

// ---------------------------------------------------------------- Celular
// Barra de navegação fixa na parte de baixo (visível apenas em telas pequenas, via CSS).
const ITENS_BARRA = [
    { href: 'main.html', rotulo: 'Início', icone: '⌂' },
    { href: 'estoque.html', rotulo: 'Estoque', icone: '▦' },
    { href: 'vendas.html', rotulo: 'Vendas', icone: '$' },
    { href: 'despesas.html', rotulo: 'Despesas', icone: '⇩' },
];
const barra = document.createElement('nav');
barra.className = 'barra-inferior';
barra.setAttribute('aria-label', 'Navegação principal');
for (const item of ITENS_BARRA) {
    const link = document.createElement('a');
    link.href = item.href;
    const icone = document.createElement('span');
    icone.className = 'barra-icone';
    icone.setAttribute('aria-hidden', 'true');
    icone.textContent = item.icone;
    link.append(icone, item.rotulo);
    if (new URL(link.href).pathname.replace(/\.html$/, '') === paginaAtual) link.classList.add('ativo');
    barra.append(link);
}
document.body.append(barra);

// DRE e Configurações não fazem parte da versão para celular.
if (['/dre', '/configuracoes'].includes(paginaAtual)) document.body.classList.add('pagina-somente-desktop');
