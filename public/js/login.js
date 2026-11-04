import { api } from './api.js';

const form = document.querySelector('#form-login');
const erro = document.querySelector('#erro-login');
const botao = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    erro.textContent = '';
    botao.disabled = true;
    botao.textContent = 'Entrando...';

    try {
        await api('/api/auth/login', {
            method: 'POST',
            body: {
                login: form.usuario.value,
                senha: form.senha.value,
            },
        });
        window.location.href = '/main';
    } catch (e) {
        erro.textContent = e.message;
        form.senha.value = '';
        form.senha.focus();
    } finally {
        botao.disabled = false;
        botao.textContent = 'Entrar';
    }
});
