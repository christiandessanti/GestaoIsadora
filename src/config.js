import 'dotenv/config';

function obrigatoria(nome) {
    const valor = process.env[nome];
    if (!valor) {
        console.error(`Variável de ambiente obrigatória não definida: ${nome} (confira o arquivo .env)`);
        process.exit(1);
    }
    return valor;
}

export const config = {
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    producao: process.env.NODE_ENV === 'production',
    sessionSecret: obrigatoria('SESSION_SECRET'),
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        database: obrigatoria('DB_NAME'),
        user: obrigatoria('DB_USER'),
        password: obrigatoria('DB_PASSWORD'),
    },
};
