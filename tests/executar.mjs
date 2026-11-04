/**
 * Executor dos testes automáticos.
 *
 *   npm test          -> testes de unidade + testes da API
 *   npm run test:ui   -> também os testes da interface no navegador (Google Chrome)
 *
 * SEGURANÇA: os testes apagam e recriam dados livremente, por isso usam um banco
 * SEPARADO (DB_NAME_TESTE no .env). O executor se recusa a rodar se esse banco
 * não terminar em "_teste" ou se for o mesmo banco do sistema.
 *
 * Para cada arquivo de teste: zera o banco de testes, roda o setup (tabelas,
 * usuário TI, categorias), cria os usuários de teste e inicia um servidor novo.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import { USUARIOS } from './auxiliares.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.TESTE_PORTA) || 3999;
const COM_UI = process.argv.includes('--ui');

// ---------------------------------------------------------------- Proteção do banco real
const BANCO_TESTE = process.env.DB_NAME_TESTE;
if (!BANCO_TESTE) {
    console.error('Defina DB_NAME_TESTE no .env (ex.: isadora_erp_teste). Veja o README, seção "Testes".');
    process.exit(1);
}
if (!BANCO_TESTE.endsWith('_teste') || BANCO_TESTE === process.env.DB_NAME) {
    console.error(`Recusado: o banco de testes "${BANCO_TESTE}" deve terminar em "_teste" e ser diferente de DB_NAME.`);
    process.exit(1);
}
const ambiente = { ...process.env, DB_NAME: BANCO_TESTE, PORT: String(PORTA), NODE_ENV: 'test', TRUST_PROXY: '' };

// ---------------------------------------------------------------- Utilitários
function rodar(arquivo, env = ambiente, { silencioso = false } = {}) {
    return new Promise((resolve) => {
        const p = spawn(process.execPath, [arquivo], { cwd: RAIZ, env, stdio: silencioso ? 'pipe' : 'inherit' });
        let saida = '';
        if (silencioso) {
            p.stdout.on('data', (d) => { saida += d; });
            p.stderr.on('data', (d) => { saida += d; });
        }
        p.on('close', (codigo) => resolve({ codigo, saida }));
    });
}

async function conectar() {
    return mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: BANCO_TESTE,
        charset: 'utf8mb4',
    });
}

/** Apaga todas as tabelas do banco de testes e recria tudo pelo setup. */
async function prepararBanco() {
    const conn = await conectar();
    try {
        const [[{ banco }]] = await conn.query('SELECT DATABASE() AS banco');
        if (!banco.endsWith('_teste')) throw new Error(`Conectado ao banco errado: ${banco}`);
        const [tabelas] = await conn.query('SHOW TABLES');
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const t of tabelas) await conn.query(`DROP TABLE \`${Object.values(t)[0]}\``);
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
        await conn.end();
    }

    const setup = await rodar('src/database/setup.js', {
        ...ambiente,
        TI_SENHA: process.env.TI_SENHA || 'senha-ti-setup-teste',
        SENHA_ESPECIAL: process.env.SENHA_ESPECIAL || 'especial-teste',
    }, { silencioso: true });
    if (setup.codigo !== 0) throw new Error(`Falha no setup do banco de testes:\n${setup.saida}`);

    const c2 = await conectar();
    try {
        for (const u of Object.values(USUARIOS)) {
            await c2.execute('INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?, ?, ?, ?)',
                [`Teste ${u.perfil}`, u.login, await bcrypt.hash(u.senha, 4), u.perfil]);
        }
    } finally {
        await c2.end();
    }
}

async function iniciarServidor() {
    const servidor = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: ambiente, stdio: 'pipe' });
    let log = '';
    servidor.stdout.on('data', (d) => { log += d; });
    servidor.stderr.on('data', (d) => { log += d; });
    for (let i = 0; i < 50; i++) {
        try {
            if ((await fetch(`http://localhost:${PORTA}/api/health`)).ok) return { servidor, log: () => log };
        } catch { /* ainda subindo */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    servidor.kill();
    throw new Error(`O servidor de testes não iniciou:\n${log}`);
}

// ---------------------------------------------------------------- Execução
// Confere o acesso ao banco de testes antes de começar.
try {
    await (await conectar()).end();
} catch (err) {
    if (['ER_DBACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(err.code)) {
        console.error(`\nO banco de testes "${BANCO_TESTE}" não existe ou o usuário "${process.env.DB_USER}" não tem acesso a ele.`);
        console.error('Crie-o uma vez com:\n');
        console.error(`  sudo mysql -e "CREATE DATABASE IF NOT EXISTS ${BANCO_TESTE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; `
            + `GRANT ALL PRIVILEGES ON ${BANCO_TESTE}.* TO '${process.env.DB_USER}'@'localhost'; FLUSH PRIVILEGES;"\n`);
        process.exit(1);
    }
    throw err;
}

const resultados = [];

// 1. Testes de unidade (não precisam de banco nem servidor)
for (const arquivo of (await readdir(path.join(RAIZ, 'tests/unidade'))).filter((f) => f.endsWith('.test.mjs')).sort()) {
    console.log(`\n▶ unidade/${arquivo}`);
    const { codigo } = await rodar(`tests/unidade/${arquivo}`);
    resultados.push({ arquivo: `unidade/${arquivo}`, ok: codigo === 0 });
}

// 2. Testes da API (e da interface, com --ui)
const pastas = ['api', ...(COM_UI ? ['ui'] : [])];
for (const pasta of pastas) {
    const arquivos = (await readdir(path.join(RAIZ, 'tests', pasta))).filter((f) => f.endsWith('.test.mjs')).sort();
    for (const arquivo of arquivos) {
        console.log(`\n▶ ${pasta}/${arquivo}`);
        await prepararBanco();
        const { servidor, log } = await iniciarServidor();
        const { codigo } = await rodar(`tests/${pasta}/${arquivo}`, { ...ambiente, TESTE_URL: `http://localhost:${PORTA}` });
        servidor.kill();
        if (codigo !== 0 && /Error|erro/i.test(log())) console.log(`\n  Log do servidor:\n${log().replace(/^/gm, '    ')}`);
        resultados.push({ arquivo: `${pasta}/${arquivo}`, ok: codigo === 0 });
    }
}

console.log('\n================ Resumo ================');
for (const r of resultados) console.log(`${r.ok ? '✔' : '✖'} ${r.arquivo}`);
const falhou = resultados.filter((r) => !r.ok).length;
console.log(falhou ? `\n✖ ${falhou} arquivo(s) com falha` : '\n✔ Todos os testes passaram');
if (!COM_UI) console.log('(Testes da interface não executados. Use "npm run test:ui".)');
process.exitCode = falhou ? 1 : 0;
