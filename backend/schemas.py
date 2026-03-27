from datetime import date
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel


# ── Transactions ──────────────────────────────────────────────────
class TransactionBase(BaseModel):
    ano_mes: str
    tipo: str = "saida"
    previsto: Optional[Decimal] = None
    efetivo: Optional[Decimal] = None
    confirmado: bool = False
    vencimento: Optional[date] = None
    discriminacao: str
    data_pagamento: Optional[date] = None
    status: str = "PEN"
    ordem: int = 0
    recorrente_id: Optional[int] = None
    is_special: bool = False


class TransactionCreate(TransactionBase):
    pass


class TransactionUpdate(BaseModel):
    ano_mes: Optional[str] = None
    tipo: Optional[str] = None
    previsto: Optional[Decimal] = None
    efetivo: Optional[Decimal] = None
    confirmado: Optional[bool] = None
    vencimento: Optional[date] = None
    discriminacao: Optional[str] = None
    data_pagamento: Optional[date] = None
    status: Optional[str] = None
    ordem: Optional[int] = None


class TransactionOut(TransactionBase):
    id: int
    recorrente_id: Optional[int] = None

    model_config = {"from_attributes": True}


# ── Recurring Records ─────────────────────────────────────────────
class RecurringBase(BaseModel):
    tipo: str = "saida"
    dia_vencimento: int = 1
    periodicidade: str = "mensal"      # 'mensal' | 'anual'
    mes_anual: Optional[int] = None    # 1–12, only for anual
    discriminacao: str
    valor_previsto: Decimal
    vincula_proximo_mes: bool = False
    ativo: bool = True


class RecurringCreate(RecurringBase):
    pass


class RecurringUpdate(BaseModel):
    tipo: Optional[str] = None
    dia_vencimento: Optional[int] = None
    periodicidade: Optional[str] = None
    mes_anual: Optional[int] = None
    discriminacao: Optional[str] = None
    valor_previsto: Optional[Decimal] = None
    vincula_proximo_mes: Optional[bool] = None
    ativo: Optional[bool] = None


class RecurringOut(RecurringBase):
    id: int
    criado_em: Optional[date] = None

    model_config = {"from_attributes": True}
