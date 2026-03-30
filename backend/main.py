import calendar
import gzip
import logging
import os
import subprocess
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import List, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Depends, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import case as sa_case
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, get_db
from auth import (
    get_current_user, get_password_hash, verify_password, create_access_token
)

log = logging.getLogger("uvicorn.error")

# ── Scheduler ────────────────────────────────────────────────────
_scheduler = BackgroundScheduler(timezone="UTC")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicia e para o scheduler junto com a aplicação."""
    backup_hour = int(os.environ.get("BACKUP_HOUR", "2"))
    _scheduler.add_job(
        _run_backup,
        trigger="cron",
        hour=backup_hour,
        minute=0,
        id="nightly_backup",
        replace_existing=True,
    )
    _scheduler.start()
    log.info("Backup agendado para %02d:00 UTC diariamente.", backup_hour)
    yield
    _scheduler.shutdown(wait=False)


models.Base.metadata.create_all(bind=engine)

# Garante que o usuário admin inicial existe
import seed_admin as _seed
_seed.main()

app = FastAPI(title="Meu Caixa API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Backup ────────────────────────────────────────────────────────
BACKUP_DIR = "/backups"


def _parse_db_url():
    """Extrai host, user, password e dbname da DATABASE_URL."""
    from urllib.parse import urlparse
    raw = os.environ.get("DATABASE_URL", "")
    if not raw:
        raise ValueError("DATABASE_URL não configurada")
    u = urlparse(raw)
    return u.hostname, u.username, u.password, u.path.lstrip("/")


def _run_backup() -> dict:
    """Executa pg_dump e salva .sql.gz em /backups. Retorna metadados do arquivo."""
    host, user, password, dbname = _parse_db_url()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    filename  = f"backup_{timestamp}.sql.gz"
    filepath  = os.path.join(BACKUP_DIR, filename)

    env = os.environ.copy()
    env["PGPASSWORD"] = password or ""

    dump = subprocess.run(
        ["pg_dump", "-h", host, "-U", user, "-d", dbname],
        capture_output=True, check=True, env=env,
    )
    with gzip.open(filepath, "wb") as f:
        f.write(dump.stdout)

    # Manter apenas os 7 mais recentes
    arquivos = sorted(
        f for f in os.listdir(BACKUP_DIR)
        if f.startswith("backup_") and f.endswith(".sql.gz")
    )
    for antigo in arquivos[:-7]:
        try:
            os.remove(os.path.join(BACKUP_DIR, antigo))
        except OSError:
            pass

    size_kb = round(os.path.getsize(filepath) / 1024, 1)
    log.info("Backup criado: %s (%s KB)", filename, size_kb)
    return {"arquivo": filename, "tamanho_kb": size_kb}



@app.post("/api/backup/create")
def create_backup(_: models.User = Depends(get_current_user)):
    """Dispara backup manual via endpoint."""
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
    """Lista os arquivos de backup disponíveis."""
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
            "arquivo": f,
            "tamanho_kb": round(stat.st_size / 1024, 1),
            "criado_em": datetime.fromtimestamp(stat.st_mtime).strftime("%d/%m/%Y %H:%M"),
        })
    return {"backups": result}


@app.post("/api/backup/restore/{filename}")
def restore_backup(
    filename: str,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restaura o banco a partir de um backup .sql.gz."""
    from database import engine as _engine

    # Segurança: impede path traversal
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

    # Descomprime o backup em memória
    try:
        with gzip.open(filepath, "rb") as f:
            sql_content = f.read()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao ler backup: {e}")

    # Fecha todas as conexões do pool SQLAlchemy antes do restore
    db.close()
    _engine.dispose()

    # 1. Limpa o schema público (equivale a truncar/dropar tudo)
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

    # 2. Restaura o dump
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

    # Força reconexão limpa nas próximas requests
    _engine.dispose()

    log.info("Banco restaurado com sucesso a partir de: %s", safe_name)
    return {"status": "ok", "mensagem": f"Banco restaurado a partir de {safe_name}"}


# ── Health ────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


# ── Auth ──────────────────────────────────────────────────────────
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
    password: str | None = None
    is_active: bool | None = None


@app.post("/api/auth/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
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
        "access_token": token,
        "token_type": "bearer",
        "must_change_password": user.must_change_password,
    }


@app.get("/api/auth/me")
def me(current_user: models.User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "must_change_password": current_user.must_change_password,
    }


@app.put("/api/auth/change-credentials")
def change_credentials(
    payload: ChangeCredentialsRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Verificar se novo username já existe (exceto o próprio)
    conflict = db.query(models.User).filter(
        models.User.username == payload.new_username,
        models.User.id != current_user.id,
    ).first()
    if conflict:
        raise HTTPException(status_code=400, detail="Nome de usuário já está em uso")

    current_user.username = payload.new_username
    current_user.hashed_password = get_password_hash(payload.new_password)
    current_user.must_change_password = False
    db.commit()
    # Retorna novo token (username mudou)
    token = create_access_token(current_user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "must_change_password": False,
    }


# ── Users ─────────────────────────────────────────────────────────
@app.get("/api/users")
def list_users(
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    users = db.query(models.User).order_by(models.User.id).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "is_active": u.is_active,
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
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Não é possível desativar o próprio usuário")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    user.is_active = False
    db.commit()


# ── Special "anchor" rows for each month ─────────────────────────
SALDO_ANTERIOR = "SALDO MÊS ANTERIOR"
SALDO_PROXIMO  = "SALDO PARA O PRÓXIMO MÊS"

def _ensure_month_anchors(db: Session, mes: str):
    """Guarantee the two fixed book-ends exist for a given month."""
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
    """Returns a SQLAlchemy expression that puts the two anchor rows first/last."""
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


# ── Helper: generate recurring transactions ────────────────────────
def generate_transactions(
    db: Session,
    rec: models.RecurringRecord,
    from_ano_mes: str,
    until_ano_mes: Optional[str] = None,
):
    from_year  = int(from_ano_mes[:4])
    from_month = int(from_ano_mes[5:7])

    # Default ceiling: 24 months ahead (mensal) or 5 years (anual)
    if until_ano_mes:
        until_year  = int(until_ano_mes[:4])
        until_month = int(until_ano_mes[5:7])
    else:
        if rec.periodicidade == "mensal":
            total = (from_month - 1) + 23
            until_year  = from_year + total // 12
            until_month = total % 12 + 1
        else:
            until_year  = from_year + 4
            until_month = rec.mes_anual or 1

    rows = []

    if rec.periodicidade == "mensal":
        cur_year, cur_month = from_year, from_month
        while (cur_year, cur_month) <= (until_year, until_month):
            day = min(rec.dia_vencimento, calendar.monthrange(cur_year, cur_month)[1])
            if rec.vincula_proximo_mes:
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
                ordem          = rec.dia_vencimento,
                recorrente_id  = rec.id,
            ))
            cur_month += 1
            if cur_month > 12:
                cur_month = 1
                cur_year += 1

    elif rec.periodicidade == "anual":
        mes_alvo = rec.mes_anual or 1
        for year in range(from_year, until_year + 1):
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
    t = date.today()
    return f"{t.year:04d}-{t.month:02d}"


# ── Transactions ──────────────────────────────────────────────────
@app.get("/api/default-month")
def get_default_month(
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from datetime import date
    today = date.today()
    current_ano_mes = today.strftime("%Y-%m")
    entrada = db.query(models.Transaction).filter(
        models.Transaction.tipo == 'entrada',
        models.Transaction.vencimento != None,
        models.Transaction.vencimento <= today,
        models.Transaction.ano_mes >= current_ano_mes,
        models.Transaction.is_special == False
    ).order_by(models.Transaction.ano_mes.desc()).first()
    if entrada:
        return {"default_month": entrada.ano_mes}
    return {"default_month": current_ano_mes}


@app.get("/api/transactions", response_model=List[schemas.TransactionOut])
def list_transactions(
    mes: str = Query(..., description="YYYY-MM"),
    sort: str = Query("receitas", description="cronologica or receitas"),
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_month_anchors(db, mes)
    sort_group = _sort_expr()
    
    query = db.query(models.Transaction).filter(models.Transaction.ano_mes == mes)
    
    if sort == "cronologica":
        query = query.order_by(sort_group, models.Transaction.vencimento.nullslast(), models.Transaction.ordem)
    else:
        # 'receitas' first
        tipo_sort = sa_case((models.Transaction.tipo == "entrada", 0), else_=1)
        query = query.order_by(sort_group, tipo_sort, models.Transaction.vencimento.nullslast(), models.Transaction.ordem)

    return query.all()


@app.post("/api/transactions", response_model=schemas.TransactionOut, status_code=201)
def create_transaction(
    payload: schemas.TransactionCreate,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
    obj = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Transaction not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    db.commit()
    db.refresh(obj)
    return obj


@app.delete("/api/transactions/{tx_id}", status_code=204)
def delete_transaction(
    tx_id: int,
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    obj = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(obj)
    db.commit()


# ── Recurring Records ─────────────────────────────────────────────
@app.get("/api/recorrentes", response_model=List[schemas.RecurringOut])
def list_recorrentes(
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from sqlalchemy import func as sqlfunc
    recs = (
        db.query(models.RecurringRecord)
        .order_by(models.RecurringRecord.id)
        .all()
    )
    # Enrich each record with ultimo_mes_gerado
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
    from_ano_mes: Optional[str] = Query(default=None, description="YYYY-MM — start generating from this month"),
    until_ano_mes: Optional[str] = Query(default=None, description="YYYY-MM — generate until this month"),
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rec = models.RecurringRecord(**payload.model_dump())
    db.add(rec)
    db.flush()
    generate_transactions(db, rec, from_ano_mes or current_ano_mes(), until_ano_mes or None)
    db.commit()
    db.refresh(rec)
    return rec


@app.put("/api/recorrentes/{rec_id}", response_model=schemas.RecurringOut)
def update_recorrente(
    rec_id: int,
    payload: schemas.RecurringUpdate,
    apply_from: Optional[str] = Query(default=None, description="YYYY-MM — regenerate from this month"),
    generate_until: Optional[str] = Query(default=None, description="YYYY-MM — extend records up to this month"),
    _: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rec = db.query(models.RecurringRecord).filter(models.RecurringRecord.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring record not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rec, field, value)

    if apply_from:
        # Delete from apply_from onwards and regenerate
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
        # Extend beyond what already exists (don't touch existing transactions)
        from sqlalchemy import func as sqlfunc
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

    from sqlalchemy import func as sqlfunc
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
    rec = db.query(models.RecurringRecord).filter(models.RecurringRecord.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring record not found")
    db.delete(rec)
    db.commit()
