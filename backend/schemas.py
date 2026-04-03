"""
schemas.py — Schemas Pydantic para validação de dados da API.

Cada grupo de schemas segue o padrão:
  - Base: campos comuns compartilhados entre criação e leitura
  - Create: schema de entrada para criação (herda da Base, sem id)
  - Update: schema de entrada para edição (todos os campos opcionais)
  - Out: schema de saída (inclui id e campos calculados, configurado para ler ORM)

O Pydantic valida automaticamente os tipos, rejeita campos inválidos
e serializa/desserializa os dados entre JSON e Python.
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


# ══════════════════════════════════════════════════════════════════
# Transações financeiras mensais
# ══════════════════════════════════════════════════════════════════

class TransactionBase(BaseModel):
    """Campos base de uma transação, compartilhados por Create e Out."""
    ano_mes:        str                  # Mês do lançamento no formato 'AAAA-MM'
    tipo:           str = "saida"        # 'entrada' (receita) ou 'saida' (despesa)
    previsto:       Optional[Decimal] = None  # Valor planejado
    efetivo:        Optional[Decimal] = None  # Valor real pago/recebido
    confirmado:     bool = False         # True quando efetivado
    vencimento:     Optional[date] = None
    discriminacao:  str                  # Descrição do lançamento
    data_pagamento: Optional[date] = None
    status:         str = "PEN"          # 'PEN' (pendente) ou 'OK' (confirmado)
    ordem:          int = 0              # Posição na lista do mês
    recorrente_id:  Optional[int] = None # FK para RecurringRecord (null = manual)
    is_special:     bool = False         # True apenas para as linhas âncora do mês


class TransactionCreate(TransactionBase):
    """Schema de entrada para criação de uma nova transação. Sem campos extras."""
    pass


class TransactionUpdate(BaseModel):
    """
    Schema de entrada para atualização parcial (PATCH-style via PUT).

    Todos os campos são opcionais — apenas os campos enviados serão atualizados.
    O campo 'recorrente_id' não é editável depois de criada a transação.
    """
    ano_mes:        Optional[str]     = None
    tipo:           Optional[str]     = None
    previsto:       Optional[Decimal] = None
    efetivo:        Optional[Decimal] = None
    confirmado:     Optional[bool]    = None
    vencimento:     Optional[date]    = None
    discriminacao:  Optional[str]     = None
    data_pagamento: Optional[date]    = None
    status:         Optional[str]     = None
    ordem:          Optional[int]     = None


class TransactionOut(TransactionBase):
    """
    Schema de saída: retornado pela API ao listar ou criar transações.

    'from_attributes = True' permite que o Pydantic leia diretamente
    os atributos de um objeto ORM SQLAlchemy (ao invés de um dict).
    """
    id: int
    recorrente_id: Optional[int] = None

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════
# Registros recorrentes (templates de lançamentos repetidos)
# ══════════════════════════════════════════════════════════════════

class RecurringBase(BaseModel):
    """Campos base de um registro recorrente."""
    tipo:               str = "saida"    # 'entrada' ou 'saida'
    dia_vencimento:     int = 1          # Dia do mês (1–28)
    periodicidade:      str = "mensal"   # 'mensal' ou 'anual'
    mes_anual:          Optional[int] = None   # Mês do vencimento anual (1–12)
    discriminacao:      str              # Nome/descrição do lançamento
    valor_previsto:     Decimal          # Valor esperado
    vincula_proximo_mes: bool = False    # Se True, aparece no mês seguinte ao vencimento
    ativo:              bool = True      # Registros inativos não geram novos lançamentos


class RecurringCreate(RecurringBase):
    """Schema de entrada para criação de um novo registro recorrente."""
    pass


class RecurringUpdate(BaseModel):
    """
    Schema de entrada para atualização parcial de um registro recorrente.

    Ao editar, o endpoint aceita parâmetros de query opcionais para
    controlar quais lançamentos futuros devem ser regenerados.
    """
    tipo:                Optional[str]     = None
    dia_vencimento:      Optional[int]     = None
    periodicidade:       Optional[str]     = None
    mes_anual:           Optional[int]     = None
    discriminacao:       Optional[str]     = None
    valor_previsto:      Optional[Decimal] = None
    vincula_proximo_mes: Optional[bool]    = None
    ativo:               Optional[bool]    = None


class RecurringOut(RecurringBase):
    """
    Schema de saída para registros recorrentes.

    'ultimo_mes_gerado' é um campo calculado (não existe no banco):
    contém o maior ano_mes encontrado nas transações vinculadas a este recorrente.
    Indica até onde os lançamentos já foram gerados.
    """
    id:                 int
    criado_em:          Optional[date] = None
    ultimo_mes_gerado:  Optional[str]  = None  # Calculado em tempo de execução

    model_config = {"from_attributes": True}
