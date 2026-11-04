# Colocando o Isadora ERP no VPS

Guia para **Ubuntu 24.04** (também serve para Debian 12). Ao final você terá:

```
Navegador ──HTTPS──► Nginx (porta 443) ──► Node/Express (127.0.0.1:3000) ──► MySQL (local)
```

- O Node **não fica exposto** na internet: só o Nginx recebe conexões.
- O MySQL só aceita conexões do próprio servidor.
- HTTPS com certificado gratuito (Let's Encrypt), renovado automaticamente.
- Backup diário do banco.

> **Antes de começar:** você precisa de um **domínio** (ex.: `erp.suaempresa.com.br`) com um
> registro **A** apontando para o IP do VPS. O HTTPS é obrigatório: em produção o cookie de
> login só é enviado por HTTPS, então **sem HTTPS o login não funciona**.

Nos comandos abaixo, troque `erp.suaempresa.com.br` pelo seu domínio.

---

## 1. Preparar o servidor

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx mysql-server ufw

# Firewall: libera apenas SSH e o Nginx (HTTP/HTTPS)
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### Node.js 24 (repositório oficial NodeSource)

O Node do repositório padrão do Ubuntu é antigo. Instale a versão 24:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh          # (opcional) confira o script antes de executar
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node -v                                # deve mostrar v24.x
```

### Usuário do sistema para a aplicação

A aplicação roda com um usuário próprio, sem privilégios de administrador:

```bash
sudo adduser --system --group --home /opt/isadora-erp isadora
```

---

## 2. Banco de dados

```bash
sudo mysql_secure_installation
```

Respostas recomendadas em produção: **ative** a validação de senha (`y`) e responda `y` para o resto.

```bash
sudo mysql -e "
  CREATE DATABASE isadora_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER 'isadora_app'@'localhost' IDENTIFIED BY 'UMA_SENHA_FORTE';
  GRANT ALL PRIVILEGES ON isadora_erp.* TO 'isadora_app'@'localhost';
  FLUSH PRIVILEGES;"
```

> O MySQL do Ubuntu já escuta só em `127.0.0.1`. Confira com
> `sudo ss -tlnp | grep 3306`: deve aparecer `127.0.0.1:3306`, nunca `0.0.0.0:3306`.

---

## 3. Instalar a aplicação

```bash
sudo -u isadora git clone https://github.com/SEU_USUARIO/GestaoIsadora.git /opt/isadora-erp/app
cd /opt/isadora-erp/app
sudo -u isadora npm ci --omit=dev
```

### Configuração (`.env`)

```bash
sudo -u isadora cp .env.example .env
sudo -u isadora chmod 600 .env
sudo -u isadora nano .env
```

Valores para **produção**:

```ini
PORT=3000
HOST=127.0.0.1          # só o Nginx acessa o Node
NODE_ENV=production     # cookie de sessão só via HTTPS
TRUST_PROXY=1           # o Node está atrás do Nginx

SESSION_SECRET=...      # gere um novo! (comando abaixo) - nunca reutilize o do desenvolvimento
DB_HOST=localhost
DB_PORT=3306
DB_NAME=isadora_erp
DB_USER=isadora_app
DB_PASSWORD=UMA_SENHA_FORTE

TI_NOME=TI
TI_LOGIN=ti
TI_SENHA=...            # senha forte para o usuário TI
SENHA_ESPECIAL=...      # senha especial inicial
```

Gerar o `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Criar as tabelas e os dados iniciais:

```bash
sudo -u isadora npm run db:setup
```

> Depois do primeiro acesso, você pode **apagar `TI_SENHA` e `SENHA_ESPECIAL` do `.env`**:
> eles só são usados na criação inicial e as senhas reais já estão guardadas (criptografadas) no banco.

---

## 4. Rodar como serviço (inicia com o servidor e reinicia se cair)

Crie `/etc/systemd/system/isadora-erp.service`:

```bash
sudo nano /etc/systemd/system/isadora-erp.service
```

```ini
[Unit]
Description=Isadora ERP
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=isadora
Group=isadora
WorkingDirectory=/opt/isadora-erp/app
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5

# Proteções extras
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/isadora-erp

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now isadora-erp
sudo systemctl status isadora-erp          # deve mostrar "active (running)"
curl http://127.0.0.1:3000/api/health      # deve responder {"ok":true}
```

Ver os logs:

```bash
sudo journalctl -u isadora-erp -f
```

---

## 5. Nginx (proxy reverso)

Crie `/etc/nginx/sites-available/isadora-erp`:

```nginx
server {
    listen 80;
    server_name erp.suaempresa.com.br;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/isadora-erp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erp.suaempresa.com.br
```

O certbot configura o HTTPS no Nginx, redireciona HTTP → HTTPS e agenda a renovação automática.
Teste a renovação: `sudo certbot renew --dry-run`.

Pronto: acesse **https://erp.suaempresa.com.br** e entre com o usuário `ti`.

---

## 7. Backup automático do banco

### Credenciais do backup

Crie `/root/.my.cnf` (lido automaticamente pelo `mysqldump`, assim a senha não aparece em comandos):

```bash
sudo nano /root/.my.cnf
```

```ini
[mysqldump]
user=isadora_app
password=UMA_SENHA_FORTE
```

```bash
sudo chmod 600 /root/.my.cnf
```

### Script de backup

```bash
sudo nano /usr/local/bin/backup-isadora.sh
```

```bash
#!/bin/bash
# Backup diário do Isadora ERP. Mantém os últimos 30 dias.
set -euo pipefail
DESTINO=/var/backups/isadora-erp
mkdir -p "$DESTINO"
chmod 700 "$DESTINO"
ARQUIVO="$DESTINO/isadora_erp_$(date +%F_%H%M).sql.gz"
mysqldump --single-transaction --routines --no-tablespaces isadora_erp | gzip > "$ARQUIVO"
find "$DESTINO" -name 'isadora_erp_*.sql.gz' -mtime +30 -delete
```

```bash
sudo chmod 700 /usr/local/bin/backup-isadora.sh
sudo /usr/local/bin/backup-isadora.sh && ls -lh /var/backups/isadora-erp   # teste
```

Agendar todo dia às 2h da manhã:

```bash
echo '0 2 * * * root /usr/local/bin/backup-isadora.sh' | sudo tee /etc/cron.d/backup-isadora
```

> **Importante:** um backup guardado só no próprio VPS não protege contra perda do servidor.
> Copie os arquivos periodicamente para outro lugar (seu computador, Google Drive, outro servidor).
> Do seu computador, por exemplo:
> `scp usuario@IP_DO_VPS:/var/backups/isadora-erp/*.sql.gz ~/backups-isadora/`

### Restaurar um backup

```bash
sudo systemctl stop isadora-erp
gunzip -c /var/backups/isadora-erp/ARQUIVO.sql.gz | sudo mysql isadora_erp
sudo systemctl start isadora-erp
```

---

## 8. Atualizar o sistema

```bash
cd /opt/isadora-erp/app
sudo /usr/local/bin/backup-isadora.sh       # sempre faça backup antes
sudo -u isadora git pull
sudo -u isadora npm ci --omit=dev
sudo -u isadora npm run db:setup            # cria tabelas novas, se houver
sudo systemctl restart isadora-erp
```

> O `db:setup` **cria** tabelas que ainda não existem, mas **não altera** tabelas existentes.
> Se uma atualização futura mudar colunas de uma tabela, ela virá com um script de migração próprio.

---

## Checklist de segurança

- [ ] Domínio com HTTPS funcionando (cadeado no navegador)
- [ ] `.env` com `NODE_ENV=production`, `HOST=127.0.0.1`, `TRUST_PROXY=1` e permissão `600`
- [ ] `SESSION_SECRET` novo, diferente do usado no desenvolvimento
- [ ] Senhas fortes para o MySQL, o usuário TI e a senha especial
- [ ] Firewall ativo (`sudo ufw status`): apenas OpenSSH e Nginx
- [ ] MySQL escutando apenas em `127.0.0.1`
- [ ] Backup diário testado **e** copiado para fora do VPS
- [ ] Atualizações de segurança do Ubuntu: `sudo apt install unattended-upgrades`
