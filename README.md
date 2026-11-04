# Isadora ERP

Sistema de gestão para pequena empresa: estoque de matérias-primas, vendas, despesas e DRE.
Funciona no navegador do computador e do celular.

- **Backend:** Node.js + Express, MySQL (consultas SQL parametrizadas com `mysql2`)
- **Frontend:** HTML, CSS e JavaScript puro (sem framework), servido pelo próprio Express
- **Login:** sessão por cookie (`httpOnly`), senhas com bcrypt
- **Relatórios:** PDF (gerado no servidor com `pdfkit`) e CSV (compatível com o Excel)

---

## Funcionalidades

| Página | O que faz | No celular |
|---|---|---|
| **Início** | Vendas do mês, últimas vendas e estoque atual | ✅ |
| **Estoque** | Entradas e saídas (sem estoque negativo), relatório por período e produto | ✅ (sem relatório) |
| **Vendas** | Vendas com vários produtos, preço sugerido pela última venda ao cliente, relatório | ✅ (sem relatório) |
| **Despesas** | Despesas por categoria, relatório | ✅ (sem relatório) |
| **DRE** | Receitas, despesas por categoria e resultado, com filtros | ❌ |
| **Configurações** | Senhas, usuários, clientes, matérias-primas, produtos de venda e categorias | ❌ |

### Perfis de usuário

| Ação | TI | Gerente | Comum |
|---|:-:|:-:|:-:|
| Registrar vendas, despesas e movimentações de estoque | ✅ | ✅ | ✅ |
| Ver DRE e relatórios | ✅ | ✅ | ✅ |
| Cadastros (clientes, produtos, categorias, usuários) | ✅ | ✅ | ❌ |
| Desativar usuários | ✅ todos | ✅ só comuns | ❌ |
| Alterar a senha especial | ✅ | ✅ | ❌ |
| Redefinir a senha de outro usuário | ✅ | ❌ | ❌ |

- O usuário **TI** é criado pelo `npm run db:setup` e nunca pode ser desativado.
- **Exclusões** pedem a **senha especial** (a senha do TI também é aceita).
- Nada é apagado de verdade: produtos, vendas e despesas excluídos vão para tabelas `*_excluidas`,
  e toda edição fica registrada em `historico_edicoes`.

---

## Instalação (computador de desenvolvimento)

Requisitos: **Node.js 20+** e **MySQL 8**.

### 1. Banco de dados

```bash
sudo mysql -e "
  CREATE DATABASE isadora_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'isadora_app'@'localhost' IDENTIFIED BY 'SUA_SENHA_AQUI';
  GRANT ALL PRIVILEGES ON isadora_erp.* TO 'isadora_app'@'localhost';
  FLUSH PRIVILEGES;"
```

### 2. Projeto

```bash
npm install
cp .env.example .env
```

Edite o `.env` e preencha pelo menos:

| Variável | O que é |
|---|---|
| `SESSION_SECRET` | Texto aleatório longo. Gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DB_PASSWORD` | Senha do usuário `isadora_app` |
| `TI_SENHA` | Senha inicial do usuário TI (mínimo 8 caracteres) |
| `SENHA_ESPECIAL` | Senha especial inicial, usada nas exclusões (mínimo 6 caracteres) |

### 3. Criar as tabelas e os dados iniciais

```bash
npm run db:setup
```

Cria as tabelas, o usuário TI, a senha especial e as 20 categorias de despesa padrão.
Pode ser executado de novo sem duplicar nada (útil após atualizações que criem tabelas novas).

### 4. Rodar

```bash
npm run dev     # desenvolvimento (reinicia ao salvar arquivos)
npm start       # produção
```

Acesse `http://localhost:3000` e entre com o login `ti` e a `TI_SENHA`.

> **Testar no celular na mesma rede Wi-Fi:** com `HOST=0.0.0.0` no `.env`, acesse
> `http://IP-DO-COMPUTADOR:3000` no navegador do celular (o IP aparece com `hostname -I`).

---

## Testes

Os testes **usam um banco separado**, que é apagado e recriado a cada execução.
O executor se recusa a rodar se o banco de testes não terminar em `_teste`.

Criar o banco de testes (uma vez):

```bash
sudo mysql -e "
  CREATE DATABASE isadora_erp_teste CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  GRANT ALL PRIVILEGES ON isadora_erp_teste.* TO 'isadora_app'@'localhost';
  FLUSH PRIVILEGES;"
```

E no `.env`: `DB_NAME_TESTE=isadora_erp_teste`.

```bash
npm test          # validações + API (login, permissões, estoque, vendas, despesas, DRE)
npm run test:ui   # também a interface, no Google Chrome (sem abrir janela)
```

Para os testes de interface, o Chrome precisa estar instalado (`CHROME_PATH` no `.env`).
Para salvar capturas de tela: `CAPTURAS=/tmp/capturas npm run test:ui`.

Estrutura:

```
tests/
├── executar.mjs     ← prepara o banco de testes, sobe o servidor e roda cada arquivo
├── auxiliares.mjs   ← login, verificações (ok/esp) e usuários de teste
├── unidade/         ← validações e cálculos (sem banco)
├── api/             ← rotas da API, um arquivo por área
└── ui/              ← navegação real no Chrome (computador e celular)
```

---

## Estrutura do projeto

```
├── public/                 ← frontend (tudo que o navegador pode acessar)
│   ├── *.html              ← páginas
│   ├── main.css            ← layout geral (do protótipo)
│   ├── componentes.css     ← formulários, tabelas, modais, avisos, celular
│   └── js/
│       ├── api.js          ← chamadas à API e downloads
│       ├── ui.js           ← modais, tabelas, formatação, seleção múltipla
│       ├── paginas.js      ← lista paginada e formulário de relatório
│       ├── layout.js       ← cabeçalho, menu e barra do celular
│       └── <página>.js     ← um script por página
├── src/                    ← backend
│   ├── server.js           ← Express: segurança, sessões, rotas
│   ├── config.js / db.js   ← configuração e conexão com o MySQL
│   ├── middlewares/auth.js ← login, perfis, senha especial, proteção de páginas
│   ├── routes/             ← uma rota por área (vendas, despesas, estoque, dre...)
│   ├── services/           ← regras de negócio, PDF, CSV, histórico
│   ├── utils/              ← validação, formatação, erros
│   └── database/
│       ├── schema.sql      ← tabelas
│       └── setup.js        ← cria tabelas e dados iniciais
├── tests/                  ← testes automáticos
└── docs/DEPLOY.md          ← como colocar no VPS
```

---

## Colocar no ar (VPS)

Veja o passo a passo em [`docs/DEPLOY.md`](docs/DEPLOY.md): Node como serviço, Nginx, HTTPS e backup automático.

## Licença

MIT. Veja [LICENSE](LICENSE).
