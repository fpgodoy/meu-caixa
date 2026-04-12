-- App Contas - PostgreSQL Schema

-- ── Transactions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recorrentes (
    id              SERIAL PRIMARY KEY,
    tipo            VARCHAR(10)    NOT NULL DEFAULT 'saida',   -- 'entrada' | 'saida'
    dia_vencimento  INT            NOT NULL DEFAULT 1,          -- 1–31
    periodicidade   VARCHAR(10)    NOT NULL DEFAULT 'mensal',   -- 'mensal' | 'anual'
    mes_anual       INT,                                        -- 1–12, only for anual
    discriminacao   TEXT           NOT NULL,
    valor_previsto  NUMERIC(12,2)  NOT NULL,
    vincula_proximo_mes BOOLEAN    NOT NULL DEFAULT FALSE,
    ativo           BOOLEAN        NOT NULL DEFAULT TRUE,
    criado_em       DATE           NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS transactions (
    id             SERIAL PRIMARY KEY,
    ano_mes        CHAR(7)        NOT NULL,            -- e.g. '2026-03'
    tipo           VARCHAR(10)    NOT NULL DEFAULT 'saida', -- 'entrada' or 'saida'
    previsto       NUMERIC(12,2),
    efetivo        NUMERIC(12,2),
    confirmado     BOOLEAN        NOT NULL DEFAULT FALSE,
    vencimento     DATE,
    discriminacao  TEXT           NOT NULL,
    data_pagamento DATE,
    status         VARCHAR(3)     NOT NULL DEFAULT 'PEN', -- 'OK' or 'PEN'
    ordem          INT            NOT NULL DEFAULT 0,
    recorrente_id  INT            REFERENCES recorrentes(id) ON DELETE SET NULL,
    is_special     BOOLEAN        NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_ano_mes ON transactions (ano_mes, ordem);
CREATE INDEX IF NOT EXISTS idx_transactions_recorrente ON transactions (recorrente_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Nota: o init.sql cria apenas o schema.
-- O usuário administrador inicial é criado pelo prestart.py na inicialização do container.
