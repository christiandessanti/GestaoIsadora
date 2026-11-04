/** Login, sessão, proteção de páginas/rotas e bloqueio por tentativas. */
import { URL_BASE, sessao, ok, esp, secao, finalizar } from '../auxiliares.mjs';

const login = (corpo) => fetch(`${URL_BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
});

secao('Sem login');
let r = await fetch(`${URL_BASE}/main`, { redirect: 'manual' });
ok('página interna redireciona para o login', r.status === 302 && r.headers.get('location') === '/');
r = await fetch(`${URL_BASE}/api/clientes`);
ok('API responde 401', r.status === 401);
ok('CSS e scripts continuam acessíveis', (await fetch(`${URL_BASE}/main.css`)).status === 200);

// Arquivos sensíveis nunca podem ser entregues (sem login: redireciona ou 404; com login: 404).
const SENSIVEIS = ['/.env', '/.env.example', '/src/server.js', '/src/config.js', '/.git/config', '/package.json', '/%2e%2e/.env', '/tests/auxiliares.mjs'];
async function conteudoExposto(cookie) {
    for (const caminho of SENSIVEIS) {
        const resp = await fetch(URL_BASE + caminho, { redirect: 'manual', headers: cookie ? { cookie } : {} });
        const corpo = await resp.text();
        if (resp.status === 200 || /DB_PASSWORD|SESSION_SECRET|express|\[core\]/.test(corpo)) return `${caminho} -> ${resp.status}`;
    }
    return null;
}
let exposto = await conteudoExposto();
ok('arquivos sensíveis não são servidos (sem login)', exposto === null, exposto ?? '');

secao('Login');
r = await login({ login: 'zzt_com', senha: 'errada' });
ok('senha errada -> 401', r.status === 401);
ok('mensagem não revela se o usuário existe', (await r.json()).erro === 'Usuário ou senha incorretos.');
r = await login({ login: 'ZZT_COM', senha: 'senha-com-1234' });
ok('login não diferencia maiúsculas', r.status === 200);
const cookie = r.headers.get('set-cookie') ?? '';
ok('cookie de sessão httpOnly e SameSite', /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie));
r = await fetch(`${URL_BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{x' });
ok('JSON inválido -> 400', r.status === 400);

const cookieLogado = (await login({ login: 'zzt_ger', senha: 'senha-ger-1234' })).headers.get('set-cookie').split(';')[0];
exposto = await conteudoExposto(cookieLogado);
ok('arquivos sensíveis não são servidos (com login)', exposto === null, exposto ?? '');

const com = await sessao('comum');
const me = esp('/api/auth/me logado', await com('GET', '/api/auth/me'), 200);
ok('dados do usuário sem a senha', me.login === 'zzt_com' && !('senha_hash' in me));
r = await com('GET', '/');
ok('tela de login redireciona logado para /main', r.s === 302);

secao('Desativação imediata');
const ti = await sessao('ti');
const usuarios = (await ti('GET', '/api/usuarios')).d;
const idCom = usuarios.find((u) => u.login === 'zzt_com').id;
await ti('PATCH', `/api/usuarios/${idCom}/ativo`, { ativo: false });
esp('usuário desativado perde o acesso na hora', await com('GET', '/api/auth/me'), 401);
ok('desativado não consegue logar', (await login({ login: 'zzt_com', senha: 'senha-com-1234' })).status === 401);
await ti('PATCH', `/api/usuarios/${idCom}/ativo`, { ativo: true });

secao('Logout');
const ger = await sessao('gerente');
esp('logout', await ger('POST', '/api/auth/logout'), 200);
esp('sessão encerrada', await ger('GET', '/api/auth/me'), 401);

// Por último: o bloqueio afeta todos os logins deste endereço IP até o servidor reiniciar.
secao('Bloqueio por tentativas (força bruta)');
let ultimo;
for (let i = 0; i < 6; i++) ultimo = await login({ login: 'zzt_ger', senha: 'errada' });
ok('após 5 erros, bloqueia por 15 minutos', ultimo.status === 429 && (await ultimo.json()).erro.includes('15 minuto'));
ok('bloqueado mesmo com a senha certa', (await login({ login: 'zzt_ger', senha: 'senha-ger-1234' })).status === 429);

finalizar();
