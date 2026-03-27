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

-- Sample data mirroring the spreadsheet (March/April 2026)
INSERT INTO transactions (ano_mes, tipo, previsto, efetivo, confirmado, vencimento, discriminacao, data_pagamento, status, ordem) VALUES
('2026-03', 'entrada', 29000.00, 29000.00,  TRUE,  '2026-03-25', 'SALÁRIO MARA',        '2026-03-25', 'OK',  1),
('2026-03', 'entrada', 12000.00, 14577.19,  TRUE,  '2026-03-25', 'SALÁRIO FELLIPE',     '2026-03-23', 'OK',  2),
('2026-03', 'saida',  NULL,      19557.20,  TRUE,  '2026-03-25', 'REPASSE MES ANTERIOR','2026-03-23', 'OK',  3),
('2026-03', 'saida',  NULL,       170.00,   FALSE, '2026-03-23', 'DIARISTA',             NULL,        'OK',  4),
('2026-03', 'saida',   50.00,    NULL,      FALSE, '2026-03-25', 'MOTO VIGIA',           NULL,        'OK',  5),
('2026-03', 'saida',  1400.00,   NULL,      FALSE, '2026-03-25', 'ACADEMIA',             NULL,        'OK',  6),
('2026-03', 'saida',  3000.00,  3000.00,   FALSE, '2026-03-25', 'EMPRESTIMO BETO',     '2026-03-25', 'OK',  7),
('2026-03', 'saida',  NULL,       170.00,   FALSE, '2026-03-26', 'DIARISTA',             NULL,        'OK',  8),
('2026-03', 'saida',   550.00,    541.41,   FALSE, '2026-03-30', 'ENERGIA',             '2026-03-26', 'OK',  9),
('2026-03', 'saida',  NULL,       170.00,   FALSE, '2026-03-30', 'DIARISTA',             NULL,        'PEN', 10),
('2026-03', 'saida',   149.90,   NULL,      FALSE, '2026-04-01', 'INTERNET YUNE',       '2026-03-26', 'OK',  11),
('2026-03', 'saida',   262.20,    272.32,   FALSE, '2026-04-01', 'VIVO',                 NULL,        'OK',  12),
('2026-03', 'saida',  NULL,       170.00,   FALSE, '2026-04-02', 'DIARISTA',             NULL,        'PEN', 13),
('2026-03', 'saida',   149.90,   NULL,      FALSE, '2026-04-05', 'INTERNET INTERFACE',  '2026-03-26', 'OK',  14),
('2026-03', 'saida',  NULL,      NULL,      FALSE, '2026-04-05', 'INVESTIMENTO',         NULL,        'PEN', 15),
('2026-03', 'saida',  12000.00, 14018.72,  FALSE, '2026-04-05', 'CARTÃO BRADESCO',      NULL,        'PEN', 16),
('2026-03', 'saida',  NULL,       170.00,   FALSE, '2026-04-06', 'DIARISTA',             NULL,        'PEN', 17),
('2026-03', 'saida',  NULL,      NULL,      FALSE, '2026-04-07', 'CARTÃO SICOOB',        NULL,        'PEN', 18),
('2026-03', 'saida',  NULL,      NULL,      FALSE, '2026-04-07', 'CARTÃO AZUL',          NULL,        'PEN', 19),
('2026-03', 'saida',   160.25,   NULL,      FALSE, '2026-04-07', 'CARTÃO AMEX',          NULL,        'PEN', 20),
('2026-03', 'saida',  NULL,       170.00,   FALSE, '2026-04-09', 'DIARISTA',             NULL,        'PEN', 21),
('2026-03', 'saida',   366.00,   NULL,      FALSE, '2026-04-10', 'INVIOLAVEL',          '2026-03-26', 'OK',  22),
('2026-03', 'saida',    70.00,    119.24,   FALSE, '2026-04-10', 'ÁGUA',                '2026-03-26', 'OK',  23),
('2026-03', 'saida',  NULL,       170.00,   FALSE, '2026-04-13', 'DIARISTA',             NULL,        'PEN', 24),
('2026-03', 'saida',  NULL,       845.24,   FALSE, '2026-04-15', 'IPTU',                 NULL,        'PEN', 25),
('2026-03', 'saida',   180.00,   NULL,      FALSE, '2026-04-16', 'LIMPADOR PISCINA',     NULL,        'PEN', 26),
('2026-03', 'saida',  1530.00,    170.00,   FALSE, '2026-04-20', 'DIARISTA',             NULL,        'PEN', 27),
('2026-03', 'saida',  NULL,      3932.11,   FALSE, '2026-04-30', 'IPVA HRV',             NULL,        'PEN', 28),
('2026-03', 'saida',  NULL,       267.59,   FALSE, '2026-04-30', 'TAXAS HRV',            NULL,        'PEN', 29);
