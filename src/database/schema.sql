-- =============================================================
-- Isadora ERP - estrutura do banco de dados (MySQL 8)
-- Pode ser executado várias vezes: só cria o que ainda não existe.
-- =============================================================

-- -------------------------------------------------------------
-- Usuários e configurações
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome          VARCHAR(100) NOT NULL,
    login         VARCHAR(50)  NOT NULL UNIQUE,
    senha_hash    VARCHAR(255) NOT NULL,
    perfil        ENUM('ti', 'gerente', 'comum') NOT NULL DEFAULT 'comum',
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    criado_por    INT UNSIGNED NULL,
    criado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuarios_criado_por FOREIGN KEY (criado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB;

-- Configurações gerais em formato chave/valor (ex.: senha_especial_hash).
CREATE TABLE IF NOT EXISTS configuracoes (
    chave          VARCHAR(100) PRIMARY KEY,
    valor          TEXT NOT NULL,
    atualizado_por INT UNSIGNED NULL,
    atualizado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_config_usuario FOREIGN KEY (atualizado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- Estoque de matéria-prima
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materias_primas (
    id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome                 VARCHAR(100) NOT NULL UNIQUE,
    unidade              ENUM('kg', 'g', 'L', 'ml', 'un', 'cx', 'pct') NOT NULL,
    quantidade           DECIMAL(12,3) NOT NULL DEFAULT 0,
    ultima_operacao_tipo ENUM('inicial', 'entrada', 'saida') NULL,
    ultima_operacao_qtd  DECIMAL(12,3) NULL,
    ultima_alteracao_em  DATETIME NULL,
    criado_por           INT UNSIGNED NOT NULL,
    criado_em            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_mp_quantidade CHECK (quantidade >= 0),
    CONSTRAINT fk_mp_criado_por FOREIGN KEY (criado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    materia_prima_id INT UNSIGNED NOT NULL,
    tipo             ENUM('inicial', 'entrada', 'saida') NOT NULL,
    quantidade       DECIMAL(12,3) NOT NULL,
    saldo_apos       DECIMAL(12,3) NOT NULL,
    observacao       VARCHAR(255) NULL,
    usuario_id       INT UNSIGNED NOT NULL,
    criado_em        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_mov_quantidade CHECK (quantidade > 0),
    CONSTRAINT fk_mov_mp FOREIGN KEY (materia_prima_id) REFERENCES materias_primas (id),
    CONSTRAINT fk_mov_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    INDEX idx_mov_data (criado_em),
    INDEX idx_mov_mp_data (materia_prima_id, criado_em)
) ENGINE=InnoDB;

-- Matérias-primas excluídas (mantém o mesmo id da tabela original).
CREATE TABLE IF NOT EXISTS materias_primas_excluidas (
    id                   INT UNSIGNED PRIMARY KEY,
    nome                 VARCHAR(100) NOT NULL,
    unidade              ENUM('kg', 'g', 'L', 'ml', 'un', 'cx', 'pct') NOT NULL,
    quantidade           DECIMAL(12,3) NOT NULL,
    ultima_operacao_tipo ENUM('inicial', 'entrada', 'saida') NULL,
    ultima_operacao_qtd  DECIMAL(12,3) NULL,
    ultima_alteracao_em  DATETIME NULL,
    criado_por           INT UNSIGNED NOT NULL,
    criado_em            DATETIME NOT NULL,
    excluido_por         INT UNSIGNED NOT NULL,
    excluido_em          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mpe_excluido_por FOREIGN KEY (excluido_por) REFERENCES usuarios (id)
) ENGINE=InnoDB;

-- Movimentações das matérias-primas excluídas (mantém o mesmo id original).
CREATE TABLE IF NOT EXISTS movimentacoes_estoque_excluidas (
    id               INT UNSIGNED PRIMARY KEY,
    materia_prima_id INT UNSIGNED NOT NULL,
    tipo             ENUM('inicial', 'entrada', 'saida') NOT NULL,
    quantidade       DECIMAL(12,3) NOT NULL,
    saldo_apos       DECIMAL(12,3) NOT NULL,
    observacao       VARCHAR(255) NULL,
    usuario_id       INT UNSIGNED NOT NULL,
    criado_em        DATETIME NOT NULL,
    CONSTRAINT fk_move_mp FOREIGN KEY (materia_prima_id) REFERENCES materias_primas_excluidas (id),
    INDEX idx_move_data (criado_em)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- Clientes e produtos de venda
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome        VARCHAR(150) NOT NULL UNIQUE,
    telefone    VARCHAR(20) NULL,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE,
    criado_por  INT UNSIGNED NOT NULL,
    criado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_clientes_criado_por FOREIGN KEY (criado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS produtos_venda (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome        VARCHAR(100) NOT NULL UNIQUE,
    unidade     ENUM('kg', 'g', 'L', 'ml', 'un', 'cx', 'pct') NOT NULL,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE,
    criado_por  INT UNSIGNED NOT NULL,
    criado_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pv_criado_por FOREIGN KEY (criado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- Vendas
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendas (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cliente_id    INT UNSIGNED NOT NULL,
    pagamento     ENUM('avista', 'aprazo') NOT NULL,
    data_venda    DATE NOT NULL,
    valor_total   DECIMAL(12,2) NOT NULL,
    usuario_id    INT UNSIGNED NOT NULL,
    criado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_vendas_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
    CONSTRAINT fk_vendas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    INDEX idx_vendas_data (data_venda)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendas_itens (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    venda_id       INT UNSIGNED NOT NULL,
    produto_id     INT UNSIGNED NOT NULL,
    quantidade     DECIMAL(12,3) NOT NULL,
    preco_unitario DECIMAL(12,2) NOT NULL,
    subtotal       DECIMAL(12,2) NOT NULL,
    CONSTRAINT chk_vi_quantidade CHECK (quantidade > 0),
    CONSTRAINT chk_vi_preco CHECK (preco_unitario >= 0),
    CONSTRAINT fk_vi_venda FOREIGN KEY (venda_id) REFERENCES vendas (id) ON DELETE CASCADE,
    CONSTRAINT fk_vi_produto FOREIGN KEY (produto_id) REFERENCES produtos_venda (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendas_excluidas (
    id            INT UNSIGNED PRIMARY KEY,
    cliente_id    INT UNSIGNED NOT NULL,
    pagamento     ENUM('avista', 'aprazo') NOT NULL,
    data_venda    DATE NOT NULL,
    valor_total   DECIMAL(12,2) NOT NULL,
    usuario_id    INT UNSIGNED NOT NULL,
    criado_em     DATETIME NOT NULL,
    atualizado_em DATETIME NOT NULL,
    excluido_por  INT UNSIGNED NOT NULL,
    excluido_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ve_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
    CONSTRAINT fk_ve_excluido_por FOREIGN KEY (excluido_por) REFERENCES usuarios (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendas_itens_excluidos (
    id             INT UNSIGNED PRIMARY KEY,
    venda_id       INT UNSIGNED NOT NULL,
    produto_id     INT UNSIGNED NOT NULL,
    quantidade     DECIMAL(12,3) NOT NULL,
    preco_unitario DECIMAL(12,2) NOT NULL,
    subtotal       DECIMAL(12,2) NOT NULL,
    CONSTRAINT fk_vie_venda FOREIGN KEY (venda_id) REFERENCES vendas_excluidas (id),
    CONSTRAINT fk_vie_produto FOREIGN KEY (produto_id) REFERENCES produtos_venda (id)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- Despesas
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias_despesa (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome       VARCHAR(100) NOT NULL UNIQUE,
    ativa      BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS despesas (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    categoria_id  INT UNSIGNED NOT NULL,
    valor         DECIMAL(12,2) NOT NULL,
    data_despesa  DATE NOT NULL,
    observacao    VARCHAR(255) NULL,
    usuario_id    INT UNSIGNED NOT NULL,
    criado_em     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_desp_valor CHECK (valor > 0),
    CONSTRAINT fk_desp_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_despesa (id),
    CONSTRAINT fk_desp_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    INDEX idx_desp_data (data_despesa)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS despesas_excluidas (
    id            INT UNSIGNED PRIMARY KEY,
    categoria_id  INT UNSIGNED NOT NULL,
    valor         DECIMAL(12,2) NOT NULL,
    data_despesa  DATE NOT NULL,
    observacao    VARCHAR(255) NULL,
    usuario_id    INT UNSIGNED NOT NULL,
    criado_em     DATETIME NOT NULL,
    atualizado_em DATETIME NOT NULL,
    excluido_por  INT UNSIGNED NOT NULL,
    excluido_em   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_de_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_despesa (id),
    CONSTRAINT fk_de_excluido_por FOREIGN KEY (excluido_por) REFERENCES usuarios (id)
) ENGINE=InnoDB;

-- -------------------------------------------------------------
-- Histórico de edições (vendas, despesas e demais cadastros)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historico_edicoes (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tabela       VARCHAR(50)  NOT NULL,
    registro_id  INT UNSIGNED NOT NULL,
    campo        VARCHAR(50)  NOT NULL,
    valor_antigo TEXT NULL,
    valor_novo   TEXT NULL,
    usuario_id   INT UNSIGNED NOT NULL,
    criado_em    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hist_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
    INDEX idx_hist_registro (tabela, registro_id)
) ENGINE=InnoDB;
