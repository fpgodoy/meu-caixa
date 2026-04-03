"""baseline: estado inicial do banco de dados

Revision ID: 0001
Revises:
Create Date: 2026-04-02 00:00:00.000000

Esta migration representa o estado inicial das tabelas já existentes em produção.
Em bancos novos (zerados), ela criará toda a estrutura.
Em bancos já existentes, ela não será executada pois o 'stamp' já a marca como aplicada.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tabela de usuários
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("must_change_password", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    # Tabela de registros recorrentes
    op.create_table(
        "recorrentes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tipo", sa.String(length=10), nullable=False),
        sa.Column("dia_vencimento", sa.Integer(), nullable=False),
        sa.Column("periodicidade", sa.String(length=10), nullable=False),
        sa.Column("mes_anual", sa.Integer(), nullable=True),
        sa.Column("discriminacao", sa.String(), nullable=False),
        sa.Column("valor_previsto", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("vincula_proximo_mes", sa.Boolean(), nullable=False),
        sa.Column("ativo", sa.Boolean(), nullable=False),
        sa.Column(
            "criado_em",
            sa.Date(),
            server_default=sa.text("current_date"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_recorrentes_id"), "recorrentes", ["id"], unique=False)

    # Tabela de transações
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("ano_mes", sa.String(length=7), nullable=False),
        sa.Column("tipo", sa.String(length=10), nullable=False),
        sa.Column("previsto", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("efetivo", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("confirmado", sa.Boolean(), nullable=False),
        sa.Column("vencimento", sa.Date(), nullable=True),
        sa.Column("discriminacao", sa.String(), nullable=False),
        sa.Column("data_pagamento", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=3), nullable=False),
        sa.Column("ordem", sa.Integer(), nullable=False),
        sa.Column("recorrente_id", sa.Integer(), nullable=True),
        sa.Column("is_special", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["recorrente_id"],
            ["recorrentes.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_transactions_ano_mes"), "transactions", ["ano_mes"], unique=False)
    op.create_index(op.f("ix_transactions_id"), "transactions", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_transactions_id"), table_name="transactions")
    op.drop_index(op.f("ix_transactions_ano_mes"), table_name="transactions")
    op.drop_table("transactions")
    op.drop_index(op.f("ix_recorrentes_id"), table_name="recorrentes")
    op.drop_table("recorrentes")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_table("users")
