from sqlalchemy import Column, Integer, String, Numeric, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base


class User(Base):
    __tablename__ = "users"

    id                   = Column(Integer, primary_key=True, index=True)
    username             = Column(String(50), unique=True, nullable=False, index=True)
    display_name         = Column(String(100), nullable=True)
    hashed_password      = Column(String, nullable=False)
    is_active            = Column(Boolean, nullable=False, default=True)
    must_change_password = Column(Boolean, nullable=False, default=False)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())


class RecurringRecord(Base):
    __tablename__ = "recorrentes"

    id             = Column(Integer, primary_key=True, index=True)
    tipo           = Column(String(10), nullable=False, default="saida")
    dia_vencimento = Column(Integer, nullable=False, default=1)    # 1–28
    periodicidade  = Column(String(10), nullable=False, default="mensal")  # 'mensal' | 'anual'
    mes_anual      = Column(Integer, nullable=True)                # 1–12, only for anual
    discriminacao  = Column(String, nullable=False)
    valor_previsto = Column(Numeric(12, 2), nullable=False)
    vincula_proximo_mes = Column(Boolean, nullable=False, default=False)
    ativo          = Column(Boolean, nullable=False, default=True)
    criado_em      = Column(Date, nullable=False, server_default=func.current_date())


class Transaction(Base):
    __tablename__ = "transactions"

    id             = Column(Integer, primary_key=True, index=True)
    ano_mes        = Column(String(7), nullable=False, index=True)   # '2026-03'
    tipo           = Column(String(10), nullable=False, default="saida")  # 'entrada' | 'saida'
    previsto       = Column(Numeric(12, 2), nullable=True)
    efetivo        = Column(Numeric(12, 2), nullable=True)
    confirmado     = Column(Boolean, nullable=False, default=False)
    vencimento     = Column(Date, nullable=True)
    discriminacao  = Column(String, nullable=False)
    data_pagamento = Column(Date, nullable=True)
    status         = Column(String(3), nullable=False, default="PEN")  # 'OK' | 'PEN'
    ordem          = Column(Integer, nullable=False, default=0)
    recorrente_id  = Column(Integer, ForeignKey("recorrentes.id", ondelete="SET NULL"), nullable=True)
    is_special     = Column(Boolean, nullable=False, default=False)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
