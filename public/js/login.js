import { api } from './api.js';

const form = document.querySelector('#form-login');
const erro = document.querySelector('#erro-login');
const botao = form.querySelector('button[type="submit"]');
const mostrarSenha = document.querySelector('#mostrar-senha');

// Mostrar/ocultar a senha digitada.
mostrarSenha.addEventListener('click', () => {
    const visivel = form.senha.type === 'text';
    form.senha.type = visivel ? 'password' : 'text';
    mostrarSenha.textContent = visivel ? 'Mostrar' : 'Ocultar';
    mostrarSenha.setAttribute('aria-pressed', String(!visivel));
    form.senha.focus();
});

// Usuário sempre em letras maiúsculas na tela (o login não diferencia maiúsculas/minúsculas).
form.usuario.addEventListener('input', () => {
    const { selectionStart, selectionEnd } = form.usuario;
    form.usuario.value = form.usuario.value.toUpperCase();
    form.usuario.setSelectionRange(selectionStart, selectionEnd);
});

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
        form.senha.type = 'password';
        mostrarSenha.textContent = 'Mostrar';
        mostrarSenha.setAttribute('aria-pressed', 'false');
        form.senha.focus();
    } finally {
        botao.disabled = false;
        botao.textContent = 'Entrar';
    }
});
