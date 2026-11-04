# Isadora ERP — contexto do projeto

> Documento de contexto para novas conversas com o Claude. Última atualização: 04/11/2026.
> Detalhes de uso e instalação: `README.md`. Implantação no VPS: `docs/DEPLOY.md`.

## Como trabalhar com o Christian (dono do projeto)

- Responder sempre em **português**.
- **Perguntar antes de mexer** em algo quando houver dúvida ou decisão de negócio/arquitetura.
- Trabalhar **por etapas**, fazendo **commit ao fim de cada etapa** (mensagem em português, com `Co-Authored-By`).
- Explicar opções com prós e contras quando ele pedir, e recomendar uma.
- **NUNCA** apagar/limpar dados no banco real `isadora_erp` (ele usa o sistema e tem dados próprios).
  Testes usam somente o banco `isadora_erp_teste` via `npm test`.

## O que é

ERP web para uma pequena empresa (biscoitos): estoque de matérias-primas, vendas, despesas e DRE.
Uso por até ~10 pessoas, no computador e no **navegador do celular** (versão reduzida). Será hospedado num **VPS**.

**Stack:** Node.js 24 + Express 5, MySQL 8 com **SQL puro** (`mysql2`, sempre `?` parametrizado — escolha do Christian, sem ORM),
sessão em cookie guardada no MySQL (`express-session` + `express-mysql-session`), bcrypt, `pdfkit` (PDF no servidor), helmet.
Frontend em HTML/CSS/JS puro (módulos ES), servido pelo Express a partir de `public/`.

## Situação atual

- Branch **`alteracoes`** (criada a partir de `prototipo_cliente`). **Ainda não foi juntada ao `main`.**
- Etapas 1 a 9 do plano **concluídas e commitadas**; todos os testes passam (`npm test` e `npm run test:ui`).
- Commits: Etapa 1 base · 2 login/sessões · 3 Configurações · ajustes de login e abas · 4 Estoque · 5 Vendas ·
  6 Despesas · 7 DRE · 8 Início + celular · 9 testes, README, DEPLOY, limpeza de CSS.

## Pendências / próximos passos

1. Christian testar o sistema manualmente (computador e celular na mesma rede: `http://IP:3000`, `HOST=0.0.0.0`).
2. Juntar `alteracoes` ao `main` (PR ou merge — perguntar qual ele prefere).
3. Implantar no VPS seguindo `docs/DEPLOY.md` (precisa de domínio; HTTPS é obrigatório para o login em produção).
4. No VPS o banco começa vazio (dados locais só migram com backup/restauração, se ele quiser).
5. Futuro: `db:setup` só cria tabelas novas; mudanças de colunas exigirão script de migração.

## Ambiente local (computador do Christian — Zorin OS 18 / Ubuntu 24.04)

- MySQL 8.0 instalado via apt; bancos `isadora_erp` (real) e `isadora_erp_teste` (testes); usuário `isadora_app`.
- DBeaver instalado para consultar o banco.
- `.env` na raiz (fora do Git) com: `SESSION_SECRET`, `DB_*`, `TI_LOGIN=ti`, `TI_SENHA`, `SENHA_ESPECIAL`,
  `HOST`, `DB_NAME_TESTE=isadora_erp_teste`, `CHROME_PATH=/usr/bin/google-chrome`. Nunca pedir/exibir senhas.
- Comandos: `npm run dev` · `npm start` · `npm run db:setup` · `npm test` · `npm run test:ui`.
- Bloqueio de login após 5 senhas erradas por 15 min (em memória; reiniciar o servidor libera).

## Regras de negócio decididas

**Perfis:** `ti` (criado pelo setup, nunca desativável, redefine senhas de outros sem a antiga), `gerente`
(cria usuários — inclusive gerentes —, desativa só comuns, altera senha especial, faz cadastros), `comum`
(registra vendas/despesas/movimentações, vê relatórios e DRE, troca a própria senha; não cria nada).
Gerente não desativa gerente. Permissões verificadas no backend.

**Senha especial:** exigida em toda exclusão; a senha do TI também é aceita. Alterável em Configurações (TI/gerente).

**Exclusões:** nada é apagado de fato — vai para `materias_primas_excluidas`/`movimentacoes_estoque_excluidas`,
`vendas_excluidas`/`vendas_itens_excluidos`, `despesas_excluidas`. Edições ficam em `historico_edicoes` (só no banco, sem tela).
Clientes, produtos de venda, usuários e categorias com registros só podem ser **desativados/reativados**.

**Cadastros:** todos centralizados em **Configurações** (abas: Minha senha, Senha especial, Usuários, Clientes,
Matérias-primas, Produtos de venda, Categorias). Nomes duplicados bloqueados (ignora maiúsculas/acentos).

**Estoque (matérias-primas):** colunas Produto | Quantidade | Última operação | Data últ. alteração. Modal com botões
**Entrada/Saída** (soma/subtrai), observação opcional, **estoque negativo bloqueado**. Estoque inicial vira movimentação.
Unidades em lista fixa: kg, g, L, ml, un, cx, pct. Quantidade com **no máximo 1 casa decimal** (inteira para un/cx/pct);
banco usa DECIMAL(12,3). Matéria-prima: só o nome é editável.

**Vendas:** cliente cadastrado (nome, telefone opcional, data de cadastro automática); vários **produtos de venda**
(catálogo separado da matéria-prima, sem estoque); quantidade × preço unitário, total calculado (em centavos inteiros,
no servidor e na tela); preço sugerido = último preço daquele produto para o cliente; pagamento à vista/a prazo.
Lista: mais recentes primeiro, carregamento contínuo. Unidade do produto de venda só muda se não houver vendas.

**Despesas:** categoria + valor R$ + data + observação. 20 categorias iniciais (Matéria Prima Estoque, Biscoito Estoque,
Folha de Pagamento, Vale, FGTS, Matéria Prima, Escritório, INSS, Notas (outros), "ICMS, PIS, COFINS" (uma só),
Salário Dessanti, Aluguel, Luz, Saulo, Caixas e Embalagens, Refinanciamento, Advogados, Máquinas, Sistema, Carro).

**Relatórios (Estoque, Vendas, Despesas) e DRE:** filtros por período e caixas de seleção (tudo marcado por padrão;
desmarcado sai do cálculo); status Ativos/Ambos/Excluídos (estoque) ou Ativas/Ambas/Desativadas (categorias);
exportação **PDF e CSV**. DRE: receitas à vista/a prazo, despesas por categoria (% das despesas e da receita),
resultado/prejuízo e margem; seções escolhíveis.

**Celular (≤768px):** barra fixa embaixo com Início, Estoque, Vendas, Despesas (listas + registrar/movimentar).
Relatórios, DRE e Configurações ficam só no computador. Login: botão mostrar senha; usuário exibido em maiúsculas.

## Estrutura (resumo)

```
public/   páginas HTML, main.css (protótipo), componentes.css, js/ (api, ui, paginas, layout, um script por página)
src/      server.js, config.js, db.js, middlewares/auth.js, routes/, services/ (pdf, csv, historico, vendas),
          utils/ (validacao, formato, erros), database/ (schema.sql, setup.js)
tests/    executar.mjs (recria o banco de testes por arquivo), auxiliares.mjs, unidade/, api/, ui/ (puppeteer-core)
docs/     DEPLOY.md
```

## Lições registradas

- Na Etapa 6, um script de limpeza de testes quase apagou dados reais (foi bloqueado). Por isso os testes passaram a
  usar banco separado. Não criar scripts que façam DELETE amplo no banco real.
- O teste de interface no Chrome encontrou bugs que os testes de API não pegavam (arredondamento na tela,
  conflito de classe CSS `venda-item`). Rodar `npm run test:ui` após mexer no frontend.
