import calendar
from datetime import date
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import case as sa_case
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="App Contas API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


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
def generate_transactions(db: Session, rec: models.RecurringRecord, from_ano_mes: str):
    from_year  = int(from_ano_mes[:4])
    from_month = int(from_ano_mes[5:7])
    rows = []

    if rec.periodicidade == "mensal":
        for i in range(24):
            total_months = (from_month - 1) + i
            year  = from_year + total_months // 12
            month = total_months % 12 + 1
            day   = min(rec.dia_vencimento, calendar.monthrange(year, month)[1])
            
            ano_mes_str = f"{year:04d}-{month:02d}"
            if rec.vincula_proximo_mes:
                target_months = total_months + 1
                t_year = from_year + target_months // 12
                t_month = target_months % 12 + 1
                ano_mes_str = f"{t_year:04d}-{t_month:02d}"

            rows.append(models.Transaction(
                ano_mes        = ano_mes_str,
                tipo           = rec.tipo,
                previsto       = rec.valor_previsto,
                efetivo        = None,
                confirmado     = False,
                vencimento     = date(year, month, day),
                discriminacao  = rec.discriminacao,
                data_pagamento = None,
                status         = "PEN",
                ordem          = rec.dia_vencimento,
                recorrente_id  = rec.id,
            ))

    elif rec.periodicidade == "anual":
        mes_alvo = rec.mes_anual or 1
        for i in range(5):
            year  = from_year + i
            month = mes_alvo
            if (year, month) < (from_year, from_month):
                continue
            day = min(rec.dia_vencimento, calendar.monthrange(year, month)[1])
            
            ano_mes_str = f"{year:04d}-{month:02d}"
            if rec.vincula_proximo_mes:
                t_month = month + 1
                t_year = year
                if t_month > 12:
                    t_month = 1
                    t_year += 1
                ano_mes_str = f"{t_year:04d}-{t_month:02d}"

            rows.append(models.Transaction(
                ano_mes        = ano_mes_str,
                tipo           = rec.tipo,
                previsto       = rec.valor_previsto,
                efetivo        = None,
                confirmado     = False,
                vencimento     = date(year, month, day),
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
def get_default_month(db: Session = Depends(get_db)):
    from datetime import date
    today = date.today()
    current_ano_mes = today.strftime("%Y-%m")
    
    # Procurar a entrada mais distante (em ano_mes)
    # cujo vencimento original já passou (<= hoje)
    # e que seja do mês atual ou de um mês futuro.
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
    db: Session = Depends(get_db)
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
def create_transaction(payload: schemas.TransactionCreate, db: Session = Depends(get_db)):
    obj = models.Transaction(**payload.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@app.put("/api/transactions/{tx_id}", response_model=schemas.TransactionOut)
def update_transaction(tx_id: int, payload: schemas.TransactionUpdate, db: Session = Depends(get_db)):
    obj = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Transaction not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    db.commit()
    db.refresh(obj)
    return obj


@app.delete("/api/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    obj = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(obj)
    db.commit()


# ── Recurring Records ─────────────────────────────────────────────
@app.get("/api/recorrentes", response_model=List[schemas.RecurringOut])
def list_recorrentes(db: Session = Depends(get_db)):
    return (
        db.query(models.RecurringRecord)
        .order_by(models.RecurringRecord.id)
        .all()
    )


@app.post("/api/recorrentes", response_model=schemas.RecurringOut, status_code=201)
def create_recorrente(payload: schemas.RecurringCreate, db: Session = Depends(get_db)):
    rec = models.RecurringRecord(**payload.model_dump())
    db.add(rec)
    db.flush()   # get rec.id before generating children
    generate_transactions(db, rec, current_ano_mes())
    db.commit()
    db.refresh(rec)
    return rec


@app.put("/api/recorrentes/{rec_id}", response_model=schemas.RecurringOut)
def update_recorrente(
    rec_id: int,
    payload: schemas.RecurringUpdate,
    apply_from: Optional[str] = Query(default=None, description="YYYY-MM — regenerate from this month"),
    db: Session = Depends(get_db),
):
    rec = db.query(models.RecurringRecord).filter(models.RecurringRecord.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring record not found")

    # Apply field updates
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rec, field, value)

    if apply_from:
        # Delete linked future transactions from apply_from onwards
        (
            db.query(models.Transaction)
            .filter(
                models.Transaction.recorrente_id == rec_id,
                models.Transaction.ano_mes >= apply_from,
            )
            .delete(synchronize_session=False)
        )
        # Regenerate from apply_from
        db.flush()
        generate_transactions(db, rec, apply_from)

    db.commit()
    db.refresh(rec)
    return rec


@app.delete("/api/recorrentes/{rec_id}", status_code=204)
def delete_recorrente(rec_id: int, db: Session = Depends(get_db)):
    rec = db.query(models.RecurringRecord).filter(models.RecurringRecord.id == rec_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recurring record not found")
    # Individual transactions keep their data; FK becomes NULL (ON DELETE SET NULL)
    db.delete(rec)
    db.commit()
