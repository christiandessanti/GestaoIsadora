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
