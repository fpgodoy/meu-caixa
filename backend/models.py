"""
models.py — Definição das tabelas do banco de dados via SQLAlchemy ORM.

Cada classe representa uma tabela. O SQLAlchemy mapeia automaticamente
os atributos de classe para colunas no PostgreSQL.

Tabelas:
  - User: usuários da aplicação (autenticação)
  - RecurringRecord: registros financeiros recorrentes (configuração)
  - Transaction: lançamentos financeiros mensais (dados transacionais)
"""
from sqlalchemy import Column, Integer, String, Numeric, Boolean, Date, DateTime, ForeignKey
from sqlalchemy.sql import func

from database import Base


class User(Base):
    """
    Tabela de usuários da aplicação.

    Campos:
      - username: nome de login, único por usuário
      - hashed_password: senha armazenada com hash bcrypt (nunca em texto puro)
      - is_active: controla acesso — usuários inativos não conseguem logar
      - must_change_password: flag para forçar troca de senha no primeiro acesso
      - created_at: preenchido automaticamente pelo banco na criação
    """
    __tablename__ = "users"

    id                   = Column(Integer, primary_key=True, index=True)
    username             = Column(String(50), unique=True, nullable=False, index=True)
    hashed_password      = Column(String, nullable=False)
    is_active            = Column(Boolean, nullable=False, default=True)
    must_change_password = Column(Boolean, nullable=False, default=False)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())


class RecurringRecord(Base):
    """
    Tabela de registros recorrentes — o "template" de lançamentos que
    se repetem todo mês ou todo ano.

    Quando um registro recorrente é criado ou editado, a aplicação
    gera automaticamente os lançamentos futuros na tabela Transaction.

    Campos:
      - tipo: 'entrada' (receita) ou 'saida' (despesa)
      - dia_vencimento: dia do mês em que vence (1–28)
      - periodicidade: 'mensal' ou 'anual'
      - mes_anual: mês de vencimento para periodicidade anual (1–12)
      - discriminacao: descrição/nome do lançamento
      - valor_previsto: valor esperado do lançamento
      - vincula_proximo_mes: se True, o lançamento aparece no próximo mês
                             (útil para contas pagas em um mês mas que
                              competem ao mês seguinte)
      - ativo: registros inativos não geram novos lançamentos
      - criado_em: data de criação, preenchida automaticamente
    """
    __tablename__ = "recorrentes"

    id                  = Column(Integer, primary_key=True, index=True)
    tipo                = Column(String(10), nullable=False, default="saida")
    dia_vencimento      = Column(Integer, nullable=False, default=1)
    periodicidade       = Column(String(10), nullable=False, default="mensal")
    mes_anual           = Column(Integer, nullable=True)
    discriminacao       = Column(String, nullable=False)
    valor_previsto      = Column(Numeric(12, 2), nullable=False)
    vincula_proximo_mes = Column(Boolean, nullable=False, default=False)
    ativo               = Column(Boolean, nullable=False, default=True)
    criado_em           = Column(Date, nullable=False, server_default=func.current_date())


class Transaction(Base):
    """
    Tabela de lançamentos financeiros mensais.

    Cada linha é um lançamento em um determinado mês (ano_mes).
    Lançamentos podem ser:
      - Comuns: criados manualmente pelo usuário
      - Gerados: criados automaticamente a partir de um RecurringRecord
      - Especiais (is_special=True): linhas de controle fixas de cada mês
                                     ('SALDO MÊS ANTERIOR' e 'SALDO PARA O PRÓXIMO MÊS')

    Campos:
      - ano_mes: chave do mês no formato 'AAAA-MM' (ex: '2026-04')
      - tipo: 'entrada' ou 'saida'
      - previsto: valor esperado/planejado
      - efetivo: valor real pago/recebido (preenchido ao confirmar)
      - confirmado: True quando o lançamento foi pago/recebido de fato
      - vencimento: data limite para pagamento/recebimento
      - discriminacao: descrição do lançamento
      - data_pagamento: data em que foi efetivado
      - status: 'OK' (confirmado) ou 'PEN' (pendente)
      - ordem: controla a ordem de exibição dentro do mês
      - recorrente_id: FK para RecurringRecord (NULL se lançamento manual)
                       ondelete='SET NULL' preserva o lançamento se o recorrente
                       for excluído
      - is_special: True apenas para as linhas âncora do mês (ordem 0 e 9999)
      - created_at / updated_at: auditoria automática
    """
    __tablename__ = "transactions"

    id             = Column(Integer, primary_key=True, index=True)
    ano_mes        = Column(String(7), nullable=False, index=True)
    tipo           = Column(String(10), nullable=False, default="saida")
    previsto       = Column(Numeric(12, 2), nullable=True)
    efetivo        = Column(Numeric(12, 2), nullable=True)
    confirmado     = Column(Boolean, nullable=False, default=False)
    vencimento     = Column(Date, nullable=True)
    discriminacao  = Column(String, nullable=False)
    data_pagamento = Column(Date, nullable=True)
    status         = Column(String(3), nullable=False, default="PEN")
    ordem          = Column(Integer, nullable=False, default=0)
    recorrente_id  = Column(Integer, ForeignKey("recorrentes.id", ondelete="SET NULL"), nullable=True)
    is_special     = Column(Boolean, nullable=False, default=False)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
