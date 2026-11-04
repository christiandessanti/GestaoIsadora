import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();

// Cabeçalhos de segurança. A política de conteúdo libera apenas o próprio
// servidor e as fontes do Google usadas no layout.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            'default-src': ["'self'"],
            'style-src': ["'self'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'https://fonts.gstatic.com'],
            'img-src': ["'self'", 'data:'],
            'script-src': ["'self'"],
            'upgrade-insecure-requests': config.producao ? [] : null,
        },
    },
}));

app.use(express.json({ limit: '100kb' }));

// Verificação rápida de que o servidor e o banco estão funcionando.
app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
});

// Frontend (somente o conteúdo da pasta public/ é acessível pelo navegador).
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Rota de API inexistente.
app.use('/api', (req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada.' });
});

// Tratamento central de erros: o detalhe vai para o log, o usuário recebe uma mensagem genérica.
app.use((err, req, res, next) => {
    if (err.status && err.status < 500) {
        return res.status(err.status).json({ erro: err.message });
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro interno no servidor.' });
});

app.listen(config.port, () => {
    console.log(`Isadora ERP rodando em http://localhost:${config.port}`);
});
