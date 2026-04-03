"""
main.py — Ponto de entrada da API FastAPI (Meu Caixa).

Organização:
  1. Imports e configurações globais
  2. Scheduler de backup automático (APScheduler)
  3. Lógica de backup e restore do banco de dados
  4. Rotas de saúde (/health)
  5. Rotas de autenticação (/api/auth/*)
  6. Rotas de usuários (/api/users/*)
  7. Helpers internos para transações mensais
  8. Rotas de transações (/api/transactions/*)
  9. Rotas de registros recorrentes (/api/recorrentes/*)
"""
import calendar
import gzip
import logging
import os
import subprocess
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import List, Optional
from urllib.parse import urlparse

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Depends, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import case as sa_case
from sqlalchemy import func as sqlfunc  # movido para o nível de módulo
from sqlalchemy.orm import Session

import models
import schemas
from auth import (
    get_current_user, get_password_hash, verify_password, create_access_token
)
from database import engine, get_db

log = logging.getLogger("uvicorn.error")


# ══════════════════════════════════════════════════════════════════
# 1. Scheduler de backup automático
# ══════════════════════════════════════════════════════════════════

# O APScheduler roda em uma thread em segundo plano.
# O lifespan do FastAPI garante que ele seja iniciado e parado
# corretamente junto com a aplicação.
_scheduler = BackgroundScheduler(timezone="UTC")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gerencia o ciclo de vida da aplicação FastAPI.

    Ao iniciar: programa o backup automático diário no horário configurado.
    Ao encerrar: para o scheduler de forma não-bloqueante (wait=False)
                 para não atrasar o shutdown do container Docker.
    """
    backup_hour = int(os.environ.get("BACKUP_HOUR", "2"))
    _scheduler.add_job(
        _run_backup,
        trigger="cron",
        hour=backup_hour,
        minute=0,
        id="nightly_backup",
        replace_existing=True,  # evita duplicar o job em reloads
    )
    _scheduler.start()
    log.info("Backup agendado para %02d:00 UTC diariamente.", backup_hour)
    yield  # a aplicação roda aqui
    _scheduler.shutdown(wait=False)


# Criação de tabelas e seed do admin são feitos pelo prestart.py antes do uvicorn iniciar.

app = FastAPI(title="Meu Caixa API", version="1.0.0", lifespan=lifespan)

# Origens permitidas para requisições CORS.
#
# Na arquitetura atual, o nginx faz proxy reverso e o browser nunca acessa
# a porta 8000 diretamente — portanto CORS não é estritamente necessário.
# Ainda assim, mantemos configurado como boa prática e para eventuais
# acessos externos (ex: ferramentas de desenvolvimento local).
#
# Configure via variável de ambiente ALLOWED_ORIGINS no .env:
#   ALLOWED_ORIGINS=http://192.168.1.100:3333,https://meudominio.com
# Se não definida, permite apenas localhost (desenvolvimento).
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins: list[str] = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else ["*"]  # padrão aberto — defina ALLOWED_ORIGINS em produção
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════
# 2. Backup e restore do banco de dados
# ══════════════════════════════════════════════════════════════════

BACKUP_DIR = "/backups"  # Volume mapeado no docker-compose.yml


def _parse_db_url() -> tuple[str, str, str, str]:
    """
    Extrai host, usuário, senha e nome do banco a partir da DATABASE_URL.

    Retorna uma tupla (host, user, password, dbname).
    Lança ValueError se a variável DATABASE_URL não estiver definida.
    """
    raw = os.environ.get("DATABASE_URL", "")
    if not raw:
        raise ValueError("DATABASE_URL não configurada")
    u = urlparse(raw)
    return u.hostname, u.username, u.password, u.path.lstrip("/")


def _run_backup() -> dict:
    """
    Executa pg_dump, comprime o resultado em gzip e salva em BACKUP_DIR.

    - O pg_dump conecta diretamente ao PostgreSQL via TCP.
    - A senha é passada pela variável de ambiente PGPASSWORD (padrão do psql).
    - O dump inteiro é retido em memória antes de ser comprimido e salvo em disco.
      Para bancos muito grandes, considere usar um arquivo temporário intermediário.
    - Mantém apenas os 7 backups mais recentes, apagando os mais antigos.

    Retorna um dict com nome do arquivo e tamanho em KB.
    """
    host, user, password, dbname = _parse_db_url()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    filename  = f"backup_{timestamp}.sql.gz"
    filepath  = os.path.join(BACKUP_DIR, filename)

    # PGPASSWORD evita prompt interativo — é lida automaticamente pelo pg_dump
    env = os.environ.copy()
    env["PGPASSWORD"] = password or ""

    dump = subprocess.run(
        ["pg_dump", "-h", host, "-U", user, "-d", dbname],
        capture_output=True,
        check=True,
        env=env,
    )

    # Comprime e salva em disco
    with gzip.open(filepath, "wb") as f:
        f.write(dump.stdout)

    # Remove backups antigos, mantendo os 7 mais recentes
    arquivos = sorted(
        f for f in os.listdir(BACKUP_DIR)
        if f.startswith("backup_") and f.endswith(".sql.gz")
    )
    for antigo in arquivos[:-7]:
        try:
            os.remove(os.path.join(BACKUP_DIR, antigo))
        except OSError:
            pass  # ignora falhas ao limpar (permissão, arquivo em uso etc.)

    size_kb = round(os.path.getsize(filepath) / 1024, 1)
    log.info("Backup criado: %s (%s KB)", filename, size_kb)
    return {"arquivo": filename, "tamanho_kb": size_kb}


@app.post("/api/backup/create")
def create_backup(_: models.User = Depends(get_current_user)):
    """Dispara um backup manual imediato. Requer autenticação."""
    try:
        result = _run_backup()
        return {"status": "ok", **result}
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"pg_dump falhou: {e.stderr.decode()}")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="pg_dump não encontrado — verifique o Dockerfile")
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/backup/list")
def list_backups(_: models.User = Depends(get_current_user)):
    """Lista os arquivos de backup disponíveis em disco, do mais recente ao mais antigo."""
    if not os.path.isdir(BACKUP_DIR):
        return {"backups": []}

    arquivos = sorted(
        (f for f in os.listdir(BACKUP_DIR) if f.startswith("backup_") and f.endswith(".sql.gz")),
        reverse=True,
    )
    result = []
    for f in arquivos:
        path = os.path.join(BACKUP_DIR, f)
        stat = os.stat(path)
        result.append({
            "arquivo":    f,
            "tamanho_kb": round(stat.st_size / 1024, 1),
            "criado_em":  datetime.fromtimestamp(stat.st_mtime).strftime("%d/%m/%Y %H:%M"),
        })
    return {"backups": result}


@app.post("/api/backup/restore/{filename}")
def restore_backup(
    filename: str,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Restaura o banco de dados a partir de um arquivo de backup .sql.gz.

    ATENÇÃO: esta operação é DESTRUTIVA — apaga todos os dados atuais
    antes de restaurar. Use com cuidado.

    Fluxo:
      1. Valida o nome do arquivo (prevenção de path traversal)
      2. Fecha as conexões do pool SQLAlchemy
      3. Dropa e recria o schema público (apaga tudo)
      4. Restaura o dump descomprimido via psql
      5. Recria o pool de conexões para novas requisições
    """
    from database import engine as _engine

    # Previne path traversal (ex: '../../etc/passwd')
    safe_name = os.path.basename(filename)
    if not safe_name.endswith(".sql.gz") or not safe_name.startswith("backup_"):
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido")

    filepath = os.path.join(BACKUP_DIR, safe_name)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Backup não encontrado")

    try:
        host, user, password, dbname = _parse_db_url()
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    env = os.environ.copy()
    env["PGPASSWORD"] = password or ""

    # Lê e descomprime o backup inteiro em memória
    try:
        with gzip.open(filepath, "rb") as f:
            sql_content = f.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao ler backup: {e}")

    # Fecha conexões ativas do pool para não conflitar com o DROP SCHEMA
    db.close()
    _engine.dispose()

    # Apaga todo o conteúdo do banco recriando o schema público
    drop_sql = (
        "DROP SCHEMA public CASCADE;\n"
        "CREATE SCHEMA public;\n"
        "GRANT ALL ON SCHEMA public TO PUBLIC;\n"
    ).encode()

    drop_res = subprocess.run(
        ["psql", "-h", host, "-U", user, "-d", dbname, "-v", "ON_ERROR_STOP=1"],
        input=drop_sql,
        capture_output=True,
        env=env,
    )
    if drop_res.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao limpar banco: {drop_res.stderr.decode()[:500]}",
        )

    # Restaura o dump no banco limpo
    restore_res = subprocess.run(
        ["psql", "-h", host, "-U", user, "-d", dbname],
        input=sql_content,
        capture_output=True,
        env=env,
    )
    if restore_res.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao restaurar: {restore_res.stderr.decode()[:500]}",
        )

    # Recria o pool para que as próximas requisições consigam conectar
    _engine.dispose()

    log.info("Banco restaurado com sucesso a partir de: %s", safe_name)
    return {"status": "ok", "mensagem": f"Banco restaurado a partir de {safe_name}"}


# ══════════════════════════════════════════════════════════════════
# 3. Health check
# ══════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """Endpoint de saúde. Usado pelo Docker/Portainer para verificar se a API está no ar."""
    return {"status": "ok"}


# ══════════════════════════════════════════════════════════════════
# 4. Autenticação e gerenciamento de credenciais
# ══════════════════════════════════════════════════════════════════

class LoginRequest(BaseModel):
    username: str
    password: str


class ChangeCredentialsRequest(BaseModel):
    new_username: str
    new_password: str


class UserCreateRequest(BaseModel):
    username: str
    password: str


class UserUpdateRequest(BaseModel):
    password:  str | None  = None   # Nova senha (opcional)
    is_active: bool | None = None   # Ativa ou desativa o usuário


@app.post("/api/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """
    Autentica um usuário e retorna um token JWT.

    Verifica:
      - Se o usuário existe e está ativo
      - Se a senha está correta (comparação bcrypt)

    Retorna o token e um flag indicando se a troca de senha é obrigatória.
    """
    user = db.query(models.User).filter(
        models.User.username == payload.username,
        models.User.is_active == True,
    ).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos",
        )
    token = create_access_token(user.id)
    return {
        "access_token":        token,
        "token_type":          "bearer",
        "must_change_password": user.must_change_password,
    }


@app.get("/api/auth/me")
def me(current_user: models.User = Depends(get_current_user)):
    """Retorna os dados básicos do usuário autenticado pelo token JWT."""
    return {
        "id":                   current_user.id,
        "username":             current_user.username,
        "must_change_password": current_user.must_change_password,
    }


@app.put("/api/auth/change-credentials")
def change_credentials(
    payload: ChangeCredentialsRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Altera o nome de usuário e a senha do usuário autenticado.

    Retorna um novo token JWT — o token anterior se torna inválido
    pois o username mudou e o frontend deve atualizar o armazenado.
    """
    # Verifica se o novo username já está em uso por outro usuário
    conflict = db.query(models.User).filter(
        models.User.username == payload.new_username,
        models.User.id != current_user.id,
    ).first()
    if conflict:
        raise HTTPException(status_code=400, detail="Nome de usuário já está em uso")

    current_user.username             = payload.new_username
    current_user.hashed_password      = get_password_hash(payload.new_password)
    current_user.must_change_password = False
    db.commit()

    # Gera novo token com as credenciais atualizadas
    token = create_access_token(current_user.id)
    return {
        "access_token":        token,
        "token_type":          "bearer",
        "must_change_password": False,
    }


# ══════════════════════════════════════════════════════════════════
# 5. Gerenciamento de usuários (admin)
# ══════════════════════════════════════════════════════════════════

@app.get("/api/users")
def list_users(
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lista todos os usuários cadastrados (ativos e inativos)."""
    users = db.query(models.User).order_by(models.User.id).all()
    return [
        {
            "id":         u.id,
            "username":   u.username,
            "is_active":  u.is_active,
            "created_at": u.created_at.strftime("%d/%m/%Y") if u.created_at else None,
        }
        for u in users
    ]


@app.post("/api/users", status_code=201)
def create_user(
    payload: UserCreateRequest,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Cria um novo usuário.

    O novo usuário começa com must_change_password=False pois
    a senha já é definida pelo administrador no momento da criação.
    """
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Nome de usuário já está em uso")
    user = models.User(
        username=payload.username,
        hashed_password=get_password_hash(payload.password),
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username}


@app.put("/api/users/{user_id}")
def update_user(
    user_id: int,
    payload: UserUpdateRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Atualiza a senha e/ou o status de ativo de um usuário.

    O administrador pode desativar qualquer usuário exceto a si mesmo
    (prevenção feita no endpoint DELETE; aqui is_active pode ser alterado).
    """
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if payload.password is not None:
        user.hashed_password = get_password_hash(payload.password)
    if payload.is_active is not None:
        user.is_active = payload.is_active
    db.commit()
    return {"id": user.id, "username": user.username, "is_active": user.is_active}


@app.delete("/api/users/{user_id}", status_code=204)
def deactivate_user(
    user_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Desativa um usuário (soft delete — não remove do banco).

    Impede que o próprio usuário autenticado se desative,
    evitando que o sistema fique sem nenhum administrador ativo.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Não é possível desativar o próprio usuário")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    user.is_active = False
    db.commit()


# ══════════════════════════════════════════════════════════════════
# 6. Helpers internos para lançamentos mensais
# ══════════════════════════════════════════════════════════════════

# Nomes fixos das linhas âncora de cada mês.
# Estas strings são usadas como chave na lógica de ordenação e não devem ser alteradas.
SALDO_ANTERIOR = "SALDO MÊS ANTERIOR"
SALDO_PROXIMO  = "SALDO PARA O PRÓXIMO MÊS"


def _ensure_month_anchors(db: Session, mes: str):
    """
    Garante que as duas linhas âncora do mês existam na tabela de transações.

    Toda visualização de mês tem dois registros especiais (is_special=True):
      - ordem=0    → 'SALDO MÊS ANTERIOR' (sempre na primeira linha)
      - ordem=9999 → 'SALDO PARA O PRÓXIMO MÊS' (sempre na última linha)

    Elas são criadas automaticamente na primeira vez que o mês é acessado.
    Os valores são editáveis pelo usuário via interface, como qualquer lançamento.
    """
    existing = (
        db.query(models.Transaction.ordem)
        .filter(models.Transaction.ano_mes == mes, models.Transaction.is_special == True)
        .all()
    )
    existing_ordens = {r[0] for r in existing}
    changed = False

    if 0 not in existing_ordens:
        db.add(models.Transaction(
            ano_mes=mes, tipo="saida", discriminacao=SALDO_ANTERIOR,
            is_special=True, ordem=0, status="PEN", confirmado=False,
        ))
        changed = True
    if 9999 not in existing_ordens:
        db.add(models.Transaction(
            ano_mes=mes, tipo="saida", discriminacao=SALDO_PROXIMO,
            is_special=True, ordem=9999, status="PEN", confirmado=False,
        ))
        changed = True
    if changed:
        db.commit()


def _sort_expr():
    """
    Retorna uma expressão SQLAlchemy para ordenação das linhas âncora.

    Garante que 'SALDO MÊS ANTERIOR' apareça sempre primeiro (grupo 0)
    e 'SALDO PARA O PRÓXIMO MÊS' sempre por último (grupo 2),
    independentemente dos demais critérios de ordenação aplicados.
    Lançamentos comuns ficam no grupo 1 (meio).
    """
    return sa_case(
        (
            (models.Transaction.is_special == True) & (models.Transaction.ordem == 0),
            0,
        ),
        (
            (models.Transaction.is_special == True) & (models.Transaction.ordem == 9999),
            2,
        ),
        else_=1,
    )


# ══════════════════════════════════════════════════════════════════
# 7. Geração de transações a partir de registros recorrentes
# ══════════════════════════════════════════════════════════════════

def generate_transactions(
    db: Session,
    rec: models.RecurringRecord,
    from_ano_mes: str,
    until_ano_mes: Optional[str] = None,
):
    """
    Gera lançamentos futuros na tabela Transaction a partir de um RecurringRecord.

    Parâmetros:
      - from_ano_mes:  mês inicial da geração (inclusivo), formato 'AAAA-MM'
      - until_ano_mes: mês final da geração (inclusivo). Se None, usa o padrão:
                         mensal  → 24 meses à frente do from_ano_mes
                         anual   → 5 anos à frente do from_ano_mes

    Lógica de vincula_proximo_mes:
      Quando True, o vencimento é no mês corrente (cur_month) mas o lançamento
      é registrado no mês seguinte (ano_mes = cur_month + 1).
      Exemplo: conta de luz vence dia 10/04, mas aparece na tela de maio
               para refletir a competência correta.

    Os lançamentos são adicionados em lote com db.add_all() mas não são
    commitados aqui — o commit fica a cargo do endpoint que chamou esta função.
    """
    from_year  = int(from_ano_mes[:4])
    from_month = int(from_ano_mes[5:7])

    # Define o horizonte de geração padrão se until_ano_mes não for fornecido
    if until_ano_mes:
        until_year  = int(until_ano_mes[:4])
        until_month = int(until_ano_mes[5:7])
    else:
        if rec.periodicidade == "mensal":
            # 24 meses à frente
            total       = (from_month - 1) + 23
            until_year  = from_year + total // 12
            until_month = total % 12 + 1
        else:
            # 5 anos à frente para recorrentes anuais
            until_year  = from_year + 4
            until_month = rec.mes_anual or 1

    rows = []

    if rec.periodicidade == "mensal":
        cur_year, cur_month = from_year, from_month
        while (cur_year, cur_month) <= (until_year, until_month):
            # Ajusta o dia para o último dia do mês se dia_vencimento > dias do mês
            # (ex: dia 31 em fevereiro vira dia 28/29)
            day = min(rec.dia_vencimento, calendar.monthrange(cur_year, cur_month)[1])

            if rec.vincula_proximo_mes:
                # Lançamento aparece no mês seguinte ao vencimento
                t_month = cur_month + 1
                t_year  = cur_year + (1 if t_month > 12 else 0)
                t_month = t_month if t_month <= 12 else 1
                ano_mes_str = f"{t_year:04d}-{t_month:02d}"
            else:
                ano_mes_str = f"{cur_year:04d}-{cur_month:02d}"

            rows.append(models.Transaction(
                ano_mes        = ano_mes_str,
                tipo           = rec.tipo,
                previsto       = rec.valor_previsto,
                efetivo        = None,
                confirmado     = False,
                vencimento     = date(cur_year, cur_month, day),
                discriminacao  = rec.discriminacao,
                data_pagamento = None,
                status         = "PEN",
                ordem          = rec.dia_vencimento,  # ordena pelo dia dentro do mês
                recorrente_id  = rec.id,
            ))
            cur_month += 1
            if cur_month > 12:
                cur_month = 1
                cur_year += 1

    elif rec.periodicidade == "anual":
        mes_alvo = rec.mes_anual or 1
        for year in range(from_year, until_year + 1):
            # Pula anos fora do intervalo solicitado
            if (year, mes_alvo) < (from_year, from_month):
                continue
            if (year, mes_alvo) > (until_year, until_month):
                break
            day = min(rec.dia_vencimento, calendar.monthrange(year, mes_alvo)[1])
            if rec.vincula_proximo_mes:
                t_month = mes_alvo + 1
                t_year  = year + (1 if t_month > 12 else 0)
                t_month = t_month if t_month <= 12 else 1
                ano_mes_str = f"{t_year:04d}-{t_month:02d}"
            else:
                ano_mes_str = f"{year:04d}-{mes_alvo:02d}"
            rows.append(models.Transaction(
                ano_mes        = ano_mes_str,
                tipo           = rec.tipo,
                previsto       = rec.valor_previsto,
                efetivo        = None,
                confirmado     = False,
                vencimento     = date(year, mes_alvo, day),
                discriminacao  = rec.discriminacao,
                data_pagamento = None,
                status         = "PEN",
                ordem          = rec.dia_vencimento,
                recorrente_id  = rec.id,
            ))

    if rows:
        db.add_all(rows)


def current_ano_mes() -> str:
    """Retorna o mês atual no formato 'AAAA-MM'."""
    t = date.today()
    return f"{t.year:04d}-{t.month:02d}"


# ══════════════════════════════════════════════════════════════════
# 8. Rotas de transações mensais
# ══════════════════════════════════════════════════════════════════

@app.get("/api/default-month")
def get_default_month(
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retorna o mês padrão a ser exibido ao abrir a aplicação.

    Lógica:
      - Busca a entrada (receita) confirmada com vencimento mais recente
        que seja menor ou igual a hoje e maior ou igual ao mês atual.
      - Se encontrar, retorna o ano_mes desse lançamento (pode ser futuro
        se houver recebimentos pre-agendados para o mês corrente).
      - Se não encontrar, retorna o mês atual.

    O objetivo é abrir automaticamente no mês de trabalho mais relevante.
    """
    today = date.today()
    current = today.strftime("%Y-%m")
    entrada = db.query(models.Transaction).filter(
        models.Transaction.tipo       == "entrada",
        models.Transaction.vencimento != None,
        models.Transaction.vencimento <= today,
        models.Transaction.ano_mes    >= current,
        models.Transaction.is_special == False,
    ).order_by(models.Transaction.ano_mes.desc()).first()

    if entrada:
        return {"default_month": entrada.ano_mes}
    return {"default_month": current}


@app.get("/api/transactions", response_model=List[schemas.TransactionOut])
def list_transactions(
    mes:  str = Query(..., description="YYYY-MM"),
    sort: str = Query("receitas", description="'cronologica' ou 'receitas'"),
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Lista todos os lançamentos de um mês, incluindo as linhas âncora.

    Modos de ordenação:
      - 'receitas'   (padrão): entradas primeiro, depois saídas. Dentro de
                               cada grupo, ordena por vencimento e depois por ordem.
      - 'cronologica': ordena apenas por data de vencimento e ordem,
                       misturando entradas e saídas.

    Em ambos os modos, as linhas âncora (is_special=True) ficam fixas
    na primeira e última posição via _sort_expr().
    """
    _ensure_month_anchors(db, mes)
    sort_group = _sort_expr()

    query = db.query(models.Transaction).filter(models.Transaction.ano_mes == mes)

    if sort == "cronologica":
        query = query.order_by(
            sort_group,
            models.Transaction.vencimento.nullslast(),
            models.Transaction.ordem,
        )
    else:
        # Modo 'receitas': agrupa entradas (tipo=0) antes das saídas (tipo=1)
        tipo_sort = sa_case((models.Transaction.tipo == "entrada", 0), else_=1)
        query = query.order_by(
            sort_group,
            tipo_sort,
            models.Transaction.vencimento.nullslast(),
            models.Transaction.ordem,
        )

    return query.all()


@app.post("/api/transactions", response_model=schemas.TransactionOut, status_code=201)
def create_transaction(
    payload: schemas.TransactionCreate,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cria um novo lançamento manual. Lançamentos gerados por recorrentes usam generate_transactions."""
    obj = models.Transaction(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@app.put("/api/transactions/{tx_id}", response_model=schemas.TransactionOut)
def update_transaction(
    tx_id: int,
    payload: schemas.TransactionUpdate,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Atualiza campos de um lançamento existente.

    Usa exclude_unset=True para atualizar apenas os campos enviados
    no corpo da requisição, preservando os demais valores.

    Propagação automática de saldo:
      Quando o lançamento editado é o 'SALDO PARA O PRÓXIMO MÊS' (is_special=True,
      ordem=9999), os campos financeiros são copiados automaticamente para o
      'SALDO MÊS ANTERIOR' (is_special=True, ordem=0) do mês seguinte.

      A direção inversa NÃO propaga: editar o 'SALDO MÊS ANTERIOR' não afeta
      o mês anterior, pois pode ter sido ajustado manualmente de forma intencional.
    """
    obj = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Aplica as alterações no lançamento atual
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(obj, field, value)

    # ── Propagação: SALDO PARA O PRÓXIMO MÊS → SALDO MÊS ANTERIOR do mês seguinte
    if obj.is_special and obj.ordem == 9999 and updates:
        # Calcula o mês seguinte a partir do ano_mes do lançamento editado
        ano, mes = int(obj.ano_mes[:4]), int(obj.ano_mes[5:7])
        if mes == 12:
            proximo_ano_mes = f"{ano + 1:04d}-01"
        else:
            proximo_ano_mes = f"{ano:04d}-{mes + 1:02d}"

        # Busca o SALDO MÊS ANTERIOR do mês seguinte (pode não existir ainda)
        saldo_anterior = db.query(models.Transaction).filter(
            models.Transaction.ano_mes  == proximo_ano_mes,
            models.Transaction.is_special == True,
            models.Transaction.ordem    == 0,
        ).first()

        # Propaga apenas o valor efetivo — os demais campos são inativos na interface
        if "efetivo" in updates:
            novo_efetivo = updates["efetivo"]
            if saldo_anterior:
                # Atualiza o SALDO MÊS ANTERIOR existente
                saldo_anterior.efetivo = novo_efetivo
            else:
                # O mês seguinte ainda não foi acessado: cria a linha âncora já com o valor
                db.add(models.Transaction(
                    ano_mes       = proximo_ano_mes,
                    tipo          = "saida",
                    discriminacao = SALDO_ANTERIOR,
                    is_special    = True,
                    ordem         = 0,
                    status        = "PEN",
                    confirmado    = False,
                    efetivo       = novo_efetivo,
                ))

    db.commit()
    db.refresh(obj)
    return obj



@app.delete("/api/transactions/{tx_id}", status_code=204)
def delete_transaction(
    tx_id: int,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove permanentemente um lançamento. Não há soft delete para transações."""
    obj = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(obj)
    db.commit()


# ══════════════════════════════════════════════════════════════════
# 9. Rotas de registros recorrentes
# ══════════════════════════════════════════════════════════════════

@app.get("/api/recorrentes", response_model=List[schemas.RecurringOut])
def list_recorrentes(
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Lista todos os registros recorrentes enriquecidos com 'ultimo_mes_gerado'.

    'ultimo_mes_gerado' é calculado em tempo de execução com uma query agregada:
    busca o maior ano_mes nas transações vinculadas a cada recorrente.
    Indica até onde os lançamentos futuros já foram gerados para aquele template.
    """
    recs = (
        db.query(models.RecurringRecord)
        .order_by(models.RecurringRecord.id)
        .all()
    )

    # Uma única query agrupada para calcular ultimo_mes_gerado de todos os recorrentes
    # de uma vez, evitando o problema N+1 (uma query por recorrente)
    ids = [r.id for r in recs]
    max_mes_by_rec = {}
    if ids:
        rows = (
            db.query(
                models.Transaction.recorrente_id,
                sqlfunc.max(models.Transaction.ano_mes).label("ultimo"),
            )
            .filter(models.Transaction.recorrente_id.in_(ids))
            .group_by(models.Transaction.recorrente_id)
            .all()
        )
        max_mes_by_rec = {r.recorrente_id: r.ultimo for r in rows}

    result = []
    for rec in recs:
        out = schemas.RecurringOut.model_validate(rec)
        out.ultimo_mes_gerado = max_mes_by_rec.get(rec.id)
        result.append(out)
    return result


@app.post("/api/recorrentes", response_model=schemas.RecurringOut, status_code=201)
def create_recorrente(
    payload: schemas.RecurringCreate,
    from_ano_mes:  Optional[str] = Query(default=None, description="AAAA-MM — mês inicial para geração de lançamentos"),
    until_ano_mes: Optional[str] = Query(default=None, description="AAAA-MM — gerar até este mês"),
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Cria um novo registro recorrente e já gera os lançamentos futuros.

    Parâmetros de query opcionais:
      - from_ano_mes:  mês a partir do qual gerar (padrão: mês atual)
      - until_ano_mes: mês até o qual gerar (padrão: 24 meses à frente para mensal)

    O db.flush() entre add e generate_transactions garante que o rec.id
    seja gerado pelo banco antes de ser referenciado nos lançamentos.
    """
    rec = models.RecurringRecord(**payload.model_dump())
    db.add(rec)
    db.flush()  # obtém o rec.id sem commitar ainda
    generate_transactions(db, rec, from_ano_mes or current_ano_mes(), until_ano_mes or None)
    db.commit()
    db.refresh(rec)
    return rec


@app.put("/api/recorrentes/{rec_id}", response_model=schemas.RecurringOut)
def update_recorrente(
    rec_id: int,
    payload: schemas.RecurringUpdate,
    apply_from:     Optional[str] = Query(default=None, description="AAAA-MM — regenerar a partir deste mês"),
    generate_until: Optional[str] = Query(default=None, description="AAAA-MM — estender lançamentos até este mês"),
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Atualiza um registro recorrente com controle fino sobre os lançamentos existentes.

    Comportamento por combinação de parâmetros de query:

    Caso A — apply_from fornecido:
      Apaga todos os lançamentos a partir de apply_from e regenera desde lá.
      Útil quando há mudança de valor, periodicidade ou dia de vencimento.

    Caso B — apenas generate_until fornecido:
      NÃO toca nos lançamentos já existentes.
      Apenas estende a geração além do último mês já gerado.
      Útil para adiantar lançamentos de anos futuros.

    Caso C — nenhum parâmetro de query:
      Atualiza apenas os metadados do registro recorrente (ex: nome),
      sem alterar nenhum lançamento já gerado.
    """
    rec = db.query(models.RecurringRecord).filter(models.RecurringRecord.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring record not found")

    # Aplica as atualizações de campos do registro recorrente
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rec, field, value)

    if apply_from:
        # Caso A: apaga lançamentos a partir de apply_from e regenera
        (
            db.query(models.Transaction)
            .filter(
                models.Transaction.recorrente_id == rec_id,
                models.Transaction.ano_mes >= apply_from,
            )
            .delete(synchronize_session=False)
        )
        db.flush()
        generate_transactions(db, rec, apply_from, generate_until or None)

    elif generate_until:
        # Caso B: estende a geração a partir do mês seguinte ao último já gerado
        last = (
            db.query(sqlfunc.max(models.Transaction.ano_mes))
            .filter(models.Transaction.recorrente_id == rec_id)
            .scalar()
        )
        if last:
            last_year  = int(last[:4])
            last_month = int(last[5:7]) + 1
            if last_month > 12:
                last_month = 1
                last_year += 1
            extend_from = f"{last_year:04d}-{last_month:02d}"
        else:
            extend_from = current_ano_mes()
        generate_transactions(db, rec, extend_from, generate_until)

    db.commit()
    db.refresh(rec)

    # Calcula ultimo_mes_gerado para retornar na resposta
    ultimo = (
        db.query(sqlfunc.max(models.Transaction.ano_mes))
        .filter(models.Transaction.recorrente_id == rec_id)
        .scalar()
    )
    out = schemas.RecurringOut.model_validate(rec)
    out.ultimo_mes_gerado = ultimo
    return out


@app.delete("/api/recorrentes/{rec_id}", status_code=204)
def delete_recorrente(
    rec_id: int,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Remove um registro recorrente.

    Os lançamentos vinculados NÃO são apagados automaticamente —
    o ondelete='SET NULL' na FK faz com que recorrente_id seja
    setado para NULL nos lançamentos existentes, preservando o histórico.
    """
    rec = db.query(models.RecurringRecord).filter(models.RecurringRecord.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring record not found")
    db.delete(rec)
    db.commit()
