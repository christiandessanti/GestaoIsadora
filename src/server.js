import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import { config } from './config.js';
import { pool } from './db.js';
import { carregarUsuario, exigirLogin, protegerPaginas } from './middlewares/auth.js';
import { authRouter } from './routes/auth.js';
import { usuariosRouter } from './routes/usuarios.js';
import { configuracoesRouter } from './routes/configuracoes.js';
import { clientesRouter } from './routes/clientes.js';
import { produtosVendaRouter } from './routes/produtosVenda.js';
import { categoriasRouter } from './routes/categorias.js';
import { materiasPrimasRouter } from './routes/materiasPrimas.js';
import { estoqueRouter } from './routes/estoque.js';
import { vendasRouter } from './routes/vendas.js';
import { despesasRouter } from './routes/despesas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000; // 8 horas sem uso -> precisa logar de novo

const app = express();

// No VPS, se houver um proxy reverso (ex.: Nginx) na frente do Node,
// defina TRUST_PROXY=1 no .env para que o IP real do usuário seja reconhecido.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

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

// Sessões guardadas no MySQL (tabela "sessions", criada automaticamente).
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: DURACAO_SESSAO_MS,
    createDatabaseTable: true,
}, pool);

app.use(session({
    name: 'isadora.sid',
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true, // renova o prazo a cada requisição
    cookie: {
        httpOnly: true,           // JavaScript da página não consegue ler o cookie
        sameSite: 'lax',          // o cookie não é enviado em requisições vindas de outros sites
        secure: config.producao,  // em produção, só trafega via HTTPS
        maxAge: DURACAO_SESSAO_MS,
    },
}));

app.use(carregarUsuario);

// ---------------- API ----------------
app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
});

app.use('/api/auth', authRouter);

// Daqui para baixo, toda rota da API exige login.
app.use('/api', exigirLogin);

app.use('/api/usuarios', usuariosRouter);
app.use('/api/configuracoes', configuracoesRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/produtos-venda', produtosVendaRouter);
app.use('/api/categorias-despesa', categoriasRouter);
app.use('/api/materias-primas', materiasPrimasRouter);
app.use('/api/estoque', estoqueRouter);
app.use('/api/vendas', vendasRouter);
app.use('/api/despesas', despesasRouter);

// Rota de API inexistente.
app.use('/api', (req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada.' });
});

// ---------------- Frontend ----------------
app.use(protegerPaginas);
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Tratamento central de erros: o detalhe vai para o log, o usuário recebe uma mensagem genérica.
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ erro: 'Dados enviados em formato inválido.' });
    }
    if (err.status && err.status < 500) {
        return res.status(err.status).json({ erro: err.message });
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro interno no servidor.' });
});

app.listen(config.port, () => {
    console.log(`Isadora ERP rodando em http://localhost:${config.port}`);
});
