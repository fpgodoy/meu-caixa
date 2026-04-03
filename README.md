# 💰 Meu Caixa

Gerenciador de finanças pessoais self-hosted para controle de orçamento mensal. Desenvolvido para rodar em servidor doméstico ou NAS via Docker.

[![GitHub](https://img.shields.io/badge/GitHub-fpgodoy%2Fmeu--caixa-blue?logo=github)](https://github.com/fpgodoy/meu-caixa)
![Status](https://img.shields.io/badge/Status-Ativo-success)

---

## ✨ Funcionalidades

- 📅 **Orçamento mensal** — controle entradas e saídas previstas e efetivadas por mês
- 🔁 **Registros recorrentes** — gerencie contas fixas mensais e anuais com retroatividade controlada por período
- 🔗 **Vínculo ao mês seguinte** — lance contas no mês atual mas vincule ao orçamento do mês seguinte
- 📊 **Ordenação inteligente** — visualize por data ou com receitas primeiro para ver se o mês fecha
- 🔄 **Propagação de saldo** — o valor em "Saldo para o próximo mês" é replicado automaticamente em "Saldo mês anterior" do mês seguinte
- 🎨 **Dark mode nativo** — design moderno com tema escuro embutido
- 💾 **Backup automático** — dump diário do banco em horário configurável, com backup manual e restauração pela interface
- 🔐 **Autenticação JWT** — múltiplos usuários com controle de acesso; troca de credenciais obrigatória no primeiro acesso
- 🗃️ **Migrations automáticas** — estrutura do banco versionada com Alembic; atualizações de código não causam perda de dados

---

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS3 |
| Backend | Python 3.12 + FastAPI |
| Banco | PostgreSQL 16 + SQLAlchemy + Alembic |
| Infra | Docker, Docker Compose, Nginx |

---

## 🚀 Instalação (Self-hosted)

### Pré-requisitos
- [Docker](https://docs.docker.com/get-docker/) e [Docker Compose](https://docs.docker.com/compose/install/)

### 1. Clone o repositório
```bash
git clone https://github.com/fpgodoy/meu-caixa.git
cd meu-caixa
```

### 2. Configure as variáveis de ambiente
```bash
cp .env.example .env
```
Edite o `.env` com suas credenciais:
```env
POSTGRES_DB=appcontas
POSTGRES_USER=contas
POSTGRES_PASSWORD=sua_senha_forte_aqui

# Gere com: python -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET=sua_chave_secreta_jwt_aqui

JWT_EXPIRE_HOURS=24   # Duração do token de sessão em horas
BACKUP_HOUR=2         # Hora UTC para backup automático (padrão: 02:00)

# Restringe as origens CORS aceitas pela API (recomendado em produção)
ALLOWED_ORIGINS=http://SEU-IP:3333
```

### 3. Suba os containers
```bash
docker compose up -d
```

### 4. Acesse
**http://localhost:3333** ou `http://IP-DO-SERVIDOR:3333`

No primeiro acesso, faça login com `admin` / `admin123` — o sistema solicitará a criação de novas credenciais.

---

## 🏭 Deploy em produção via Portainer

### Stack via Repositório Git

1. No Portainer: **Stacks → Add Stack → Repository**
2. Preencha:
   - **Repository URL:** `https://github.com/fpgodoy/meu-caixa`
   - **Branch:** `main`
   - **Compose path:** `docker-compose.yml`
3. Na seção **Environment variables**, adicione as variáveis do `.env` e defina os caminhos no servidor para persistência:
   - `DB_DATA_PATH`: ex. `/var/lib/meu-caixa/data` — **obrigatório** para não perder os dados do banco
   - `BACKUP_DATA_PATH`: ex. `/var/lib/meu-caixa/backups` — **obrigatório** para salvar os backups
   - `APP_PORT`: porta de acesso ao frontend (padrão: `3333`)
   - `ALLOWED_ORIGINS`: ex. `http://192.168.1.100:3333` — restringe o CORS ao seu endereço de acesso
4. Clique em **Deploy the stack**
5. Acesse em **http://IP-DO-SERVIDOR:3333** (ou na porta definida)

### Atualizando após mudanças no código

No Portainer: **Stacks → meu-caixa → Pull and redeploy**

O sistema detecta automaticamente o estado do banco de dados a cada inicialização e aplica as migrations pendentes sem intervenção manual e sem perda de dados.

---

## 🗃️ Migrations de banco de dados (Alembic)

O projeto usa [Alembic](https://alembic.sqlalchemy.org/) para gerenciar mudanças na estrutura do banco de dados de forma segura e versionada.

### Como funciona na inicialização

A cada vez que o container sobe, o script `prestart.py` executa automaticamente:

| Situação detectada | Ação |
|---|---|
| Banco zerado (nova instalação) | Cria toda a estrutura via `alembic upgrade head` |
| Banco existente sem controle Alembic | Registra como baseline (`stamp`) e verifica migrations |
| Banco já gerenciado pelo Alembic | Aplica apenas as migrations pendentes |

Em todos os casos, o usuário `admin` inicial é criado automaticamente se ainda não houver nenhum usuário.

### Como criar uma nova migration (ao alterar `models.py`)

```bash
cd backend
alembic revision --autogenerate -m "descricao da mudanca"
```

Adicione o arquivo gerado ao Git, faça o push e o próximo redeploy aplicará a alteração automaticamente.

---

## 📁 Estrutura do Projeto

```
meu-caixa/
├── backend/
│   ├── main.py                    # Endpoints e lógica principal da API
│   ├── models.py                  # Modelos ORM (tabelas do banco)
│   ├── schemas.py                 # Schemas Pydantic (validação de dados)
│   ├── auth.py                    # Autenticação JWT
│   ├── database.py                # Configuração da conexão com o banco
│   ├── seed_admin.py              # Criação do usuário admin inicial
│   ├── prestart.py                # Inicialização inteligente (migrations + seed)
│   ├── start.sh                   # Entrypoint do container
│   ├── alembic.ini                # Configuração do Alembic
│   ├── alembic/
│   │   ├── env.py                 # Configuração do ambiente de migration
│   │   └── versions/              # Histórico de migrations
│   └── requirements.txt
├── frontend/
│   ├── index.html                 # Dashboard principal
│   ├── recorrentes.html
│   ├── configuracoes.html
│   └── *.js / *.css
├── db/
│   └── init.sql                   # Inicialização do PostgreSQL
├── .env.example                   # Template de variáveis de ambiente
└── docker-compose.yml
```

> **Volumes gerados em runtime** (ignorados pelo Git):
> - `./data/` — dados do PostgreSQL
> - `./backups/` — dumps de backup

---

## 🗺️ Roadmap

Veja o arquivo [`TODO.md`](TODO.md) para funcionalidades planejadas.

---