/**
 * Prepara o banco de dados:
 *  1. Cria as tabelas (schema.sql) que ainda não existirem.
 *  2. Cria o usuário TI, se ainda não existir.
 *  3. Define a senha especial inicial, se ainda não existir.
 *  4. Cadastra as categorias de despesa padrão que ainda não existirem.
 *
 * Pode ser executado várias vezes sem duplicar dados:  npm run db:setup
 */
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const BCRYPT_ROUNDS = 12;

const CATEGORIAS_PADRAO = [
    'Matéria Prima Estoque',
    'Biscoito Estoque',
    'Folha de Pagamento',
    'Vale',
    'FGTS',
    'Matéria Prima',
    'Escritório',
    'INSS',
    'Notas (outros)',
    'ICMS, PIS, COFINS',
    'Salário Dessanti',
    'Aluguel',
    'Luz',
    'Saulo',
    'Caixas e Embalagens',
    'Refinanciamento',
    'Advogados',
    'Máquinas',
    'Sistema',
    'Carro',
];

async function main() {
    const conn = await mysql.createConnection({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        charset: 'utf8mb4',
        multipleStatements: true, // necessário apenas aqui, para rodar o schema.sql inteiro
    });

    try {
        // 1. Tabelas
        const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
        await conn.query(schema);
        console.log('✔ Tabelas verificadas/criadas.');

        // 2. Usuário TI
        const [tis] = await conn.execute("SELECT id FROM usuarios WHERE perfil = 'ti' LIMIT 1");
        if (tis.length === 0) {
            const nome = process.env.TI_NOME || 'TI';
            const login = process.env.TI_LOGIN || 'ti';
            const senha = process.env.TI_SENHA;
            if (!senha || senha.length < 8) {
                throw new Error('Defina TI_SENHA no .env com pelo menos 8 caracteres.');
            }
            const hash = await bcrypt.hash(senha, BCRYPT_ROUNDS);
            await conn.execute(
                "INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?, ?, ?, 'ti')",
                [nome, login, hash],
            );
            console.log(`✔ Usuário TI criado (login: ${login}).`);
        } else {
            console.log('• Usuário TI já existe (não alterado).');
        }

        // 3. Senha especial
        const [cfg] = await conn.execute(
            "SELECT chave FROM configuracoes WHERE chave = 'senha_especial_hash'",
        );
        if (cfg.length === 0) {
            const senha = process.env.SENHA_ESPECIAL;
            if (!senha || senha.length < 6) {
                throw new Error('Defina SENHA_ESPECIAL no .env com pelo menos 6 caracteres.');
            }
            const hash = await bcrypt.hash(senha, BCRYPT_ROUNDS);
            await conn.execute(
                "INSERT INTO configuracoes (chave, valor) VALUES ('senha_especial_hash', ?)",
                [hash],
            );
            console.log('✔ Senha especial inicial definida.');
        } else {
            console.log('• Senha especial já definida (não alterada).');
        }

        // 4. Categorias de despesa
        let novas = 0;
        for (const nome of CATEGORIAS_PADRAO) {
            const [r] = await conn.execute(
                'INSERT IGNORE INTO categorias_despesa (nome) VALUES (?)',
                [nome],
            );
            novas += r.affectedRows;
        }
        console.log(`✔ Categorias de despesa: ${novas} criada(s), ${CATEGORIAS_PADRAO.length - novas} já existia(m).`);

        console.log('\nBanco pronto.');
    } finally {
        await conn.end();
    }
}

main().catch((err) => {
    console.error('✖ Erro ao preparar o banco:', err.message);
    process.exit(1);
});
