# 💰 Meu Caixa

Self-hosted personal finance manager for monthly budget tracking. Built to run on a home server or NAS via Docker.

[![GitHub](https://img.shields.io/badge/GitHub-fpgodoy%2Fmeu--caixa-blue?logo=github)](https://github.com/fpgodoy/meu-caixa)
![Status](https://img.shields.io/badge/Status-Ativo-success)

---

## ✨ Funcionalidades

- 📅 **Orçamento mensal** — controle entradas, saídas previstas e efetivadas por mês
- 🔁 **Registros recorrentes** — gerencie contas fixas mensais e anuais; edite com retroatividade controlada por período
- 🔗 **Vínculo de mês seguinte** — lance contas no mês atual mas vincule ao orçamento do mês seguinte
- ⚡ **Lançamentos em lote** — crie múltiplos registros de uma vez via calendário visual
- 📊 **Ordenação inteligente** — visualize por data ou com receitas primeiro para ver se o mês fecha
- 🎨 **Dark mode nativo** — design moderno com tema escuro embutido
- 💾 **Backup automático** — dump diário do banco às 02:00 UTC, com botão de backup manual e restauração pela interface
- 🔐 **Autenticação JWT** — múltiplos usuários com controle de acesso; troca de credenciais no primeiro acesso

---

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS3 |
| Backend | Python 3.12 + FastAPI |
| Banco | PostgreSQL 16 + SQLAlchemy |
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

JWT_EXPIRE_HOURS=24   # Duração do token de sessão
BACKUP_HOUR=2         # Hora UTC para backup automático (padrão: 02:00)
```

### 3. Suba os containers
```bash
docker compose up -d
```

### 4. Acesse
**http://localhost:3000** ou `http://IP-DO-SERVIDOR:3000`

No primeiro acesso, faça login com `admin` / `admin123` — o sistema solicitará a criação de novas credenciais.

---

## 🏭 Deploy em produção via Portainer

### Stack via Repositório Git

1. No Portainer: **Stacks → Add Stack → Repository**
2. Preencha:
   - **Repository URL:** `https://github.com/fpgodoy/meu-caixa`
   - **Branch:** `main`
   - **Compose path:** `docker-compose.yml`
3. Na seção **Environment variables**, adicione as mesmas variáveis do `.env`
4. Clique em **Deploy the stack**

Para atualizar após mudanças no código:
**Stacks → meu-caixa → Pull and redeploy**

---

## 📁 Estrutura do Projeto

```
meu-caixa/
├── backend/          # API FastAPI (Python)
│   ├── main.py       # Endpoints e lógica principal
│   ├── models.py     # Modelos SQLAlchemy
│   ├── schemas.py    # Schemas Pydantic
│   ├── auth.py       # JWT e autenticação
│   └── seed_admin.py # Criação do usuário inicial
├── frontend/         # Interface web (Vanilla JS)
│   ├── index.html    # Dashboard principal
│   ├── recorrentes.html
│   ├── configuracoes.html
│   └── *.js / *.css
├── db/
│   └── init.sql      # Inicialização do PostgreSQL
├── .env.example      # Template de variáveis de ambiente
└── docker-compose.yml
```

> **Volumes gerados em runtime** (ignorados pelo Git):
> - `./data/` — dados do PostgreSQL
> - `./backups/` — dumps de backup

---

## 🗺️ Roadmap

Veja o arquivo [`TODO.md`](TODO.md) para funcionalidades planejadas.

---

Feito com dedicação para uma vida financeira mais tranquila! 📈
