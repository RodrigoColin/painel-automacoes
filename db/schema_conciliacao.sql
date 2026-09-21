-- Conciliacao bancaria — Proos
-- Complementa o db/schema.sql existente do proos-omie-mcp.
--
-- Desenho: a fonte da linha (OFX, Open Finance, maquininha) nao aparece no
-- modelo alem de uma coluna `fonte` — o motor so conhece "linha normalizada",
-- e e isso que permite plugar a captura depois sem mexer em nada aqui.

-- ---------------------------------------------------------------------------
-- cadastro
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conta_bancaria (
    id                  BIGSERIAL PRIMARY KEY,
    cliente_slug        TEXT        NOT NULL,   -- slug em clientes_omie.json
    apelido             TEXT        NOT NULL,
    banco               TEXT,                   -- itau, inter, santander...
    agencia             TEXT,
    numero              TEXT,
    cod_conta_erp       TEXT        NOT NULL,   -- nCodCC no Omie
    erp                 TEXT        NOT NULL DEFAULT 'omie',  -- omie | nibo
    tipo                TEXT        NOT NULL DEFAULT 'corrente',
                                    -- corrente | investimento | cartao | adquirente
    conta_investimento_id BIGINT    REFERENCES conta_bancaria(id),
    ativa               BOOLEAN     NOT NULL DEFAULT TRUE,
    incluir_conciliacao BOOLEAN     NOT NULL DEFAULT TRUE,
                                    -- FALSE para PERDA/PREJUIZO, negociacao etc.
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cliente_slug, erp, cod_conta_erp)
);

-- ---------------------------------------------------------------------------
-- lote e linhas do extrato
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lote_extrato (
    id              BIGSERIAL PRIMARY KEY,
    conta_id        BIGINT      NOT NULL REFERENCES conta_bancaria(id),
    fonte           TEXT        NOT NULL DEFAULT 'ofx',  -- ofx | openfinance | api
    arquivo         TEXT,
    periodo_de      DATE        NOT NULL,
    periodo_ate     DATE        NOT NULL,
    saldo_final     NUMERIC(16,2),   -- <LEDGERBAL> do OFX
    saldo_data      DATE,
    subido_por      TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS linha_extrato (
    id              BIGSERIAL PRIMARY KEY,
    lote_id         BIGINT      NOT NULL REFERENCES lote_extrato(id) ON DELETE CASCADE,
    conta_id        BIGINT      NOT NULL REFERENCES conta_bancaria(id),
    id_origem       TEXT        NOT NULL,   -- FITID do OFX / id do provedor
    data_mov        DATE        NOT NULL,
    valor           NUMERIC(16,2) NOT NULL, -- sempre positivo
    natureza        CHAR(1)     NOT NULL CHECK (natureza IN ('C','D')),
    descricao       TEXT        NOT NULL DEFAULT '',
    contraparte_nome TEXT,
    contraparte_doc TEXT,
    status          TEXT        NOT NULL DEFAULT 'capturada',
                    -- capturada | conciliada | em_revisao | em_excecao
                    -- | resolvida | pendente_documento | fechada
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- chave de deduplicacao: a mesma transacao do banco nunca entra duas vezes,
    -- mesmo que o operador suba o OFX de novo ou o Open Finance repita
    UNIQUE (conta_id, id_origem)
);

CREATE INDEX IF NOT EXISTS ix_linha_conta_data ON linha_extrato (conta_id, data_mov);
CREATE INDEX IF NOT EXISTS ix_linha_status     ON linha_extrato (status)
    WHERE status NOT IN ('fechada', 'conciliada');

-- ---------------------------------------------------------------------------
-- decisao do motor / do operador
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS match_conciliacao (
    id              BIGSERIAL PRIMARY KEY,
    linha_id        BIGINT      NOT NULL REFERENCES linha_extrato(id) ON DELETE CASCADE,
    desfecho        TEXT        NOT NULL
                    CHECK (desfecho IN ('titulo','lanc_direto','transferencia','fila')),
    faixa           TEXT        NOT NULL
                    CHECK (faixa IN ('automatico','revisao','excecao')),
    score           INT         NOT NULL DEFAULT 0,
    titulo_erp_id   TEXT,       -- codigo_lancamento_omie do CP/CR
    titulo_tipo     CHAR(2),    -- CP | CR
    categoria       TEXT,
    linha_par_id    BIGINT      REFERENCES linha_extrato(id),  -- transferencia
    diferenca       NUMERIC(16,2) DEFAULT 0,
    explicacao      TEXT,       -- juros, desconto, retencao...
    evidencias      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- auditoria: o que o motor sugeriu vs. o que ficou valendo
    sugerido_por    TEXT        NOT NULL DEFAULT 'motor',   -- motor | operador
    confirmado_por  TEXT,
    confirmado_em   TIMESTAMPTZ,
    desfeito_em     TIMESTAMPTZ,   -- retrabalho: a metrica que governa o motor
    -- gravacao no ERP
    gravado_em      TIMESTAMPTZ,
    id_erp          TEXT,
    operacao_erp    TEXT,       -- LancarPagamento, IncluirLancCC...
    erro_erp        TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- idempotencia: uma linha so pode ter UMA gravacao valendo no ERP
CREATE UNIQUE INDEX IF NOT EXISTS ux_match_linha_gravada
    ON match_conciliacao (linha_id)
    WHERE gravado_em IS NOT NULL AND desfeito_em IS NULL;

CREATE INDEX IF NOT EXISTS ix_match_titulo ON match_conciliacao (titulo_erp_id)
    WHERE titulo_erp_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- fila de excecoes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS excecao (
    id              BIGSERIAL PRIMARY KEY,
    linha_id        BIGINT      NOT NULL REFERENCES linha_extrato(id) ON DELETE CASCADE,
    tipo            TEXT        NOT NULL
                    CHECK (tipo IN ('sem_titulo_saida','sem_titulo_entrada',
                                    'divergencia_valor','ambiguidade',
                                    'transferencia_sem_par','cadastro',
                                    'duplicidade','sem_documento')),
    status          TEXT        NOT NULL DEFAULT 'aberta',
                    -- aberta | com_cliente | resolvida | descartada
    motivo          TEXT,
    candidatos      JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- descartados
    responsavel     TEXT,
    -- quando a bola esta com o cliente (documento, identificacao, aprovacao)
    enviado_cliente_em TIMESTAMPTZ,
    canal           TEXT,       -- whatsapp | email | portal
    resposta_cliente   TEXT,
    resolvida_em    TIMESTAMPTZ,
    resolvida_por   TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_excecao_abertas ON excecao (tipo, criado_em)
    WHERE status = 'aberta';

-- ---------------------------------------------------------------------------
-- regras aprendidas (o que faz a fila encolher)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS regra_cliente (
    id                BIGSERIAL PRIMARY KEY,
    cliente_slug      TEXT      NOT NULL,
    padrao            TEXT      NOT NULL,   -- trecho estavel da descricao
    desfecho          TEXT      NOT NULL,
    categoria         TEXT,
    parceiro_erp_id   TEXT,
    conta_destino_id  BIGINT    REFERENCES conta_bancaria(id),
    confirmacoes      INT       NOT NULL DEFAULT 1,
    ativa             BOOLEAN   NOT NULL DEFAULT TRUE,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cliente_slug, padrao, desfecho)
);

-- cortes de confianca por cliente — sobem/descem conforme o retrabalho
CREATE TABLE IF NOT EXISTS config_conciliacao (
    cliente_slug      TEXT      PRIMARY KEY,
    corte_automatico  INT       NOT NULL DEFAULT 90,
    corte_revisao     INT       NOT NULL DEFAULT 60,
    dias_antes        INT       NOT NULL DEFAULT 3,
    dias_depois       INT       NOT NULL DEFAULT 7,
    escrita_liberada  BOOLEAN   NOT NULL DEFAULT FALSE,  -- so apos o modo sombra
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- fechamento: o unico criterio que importa e o saldo batido
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fechamento_conta (
    id              BIGSERIAL PRIMARY KEY,
    conta_id        BIGINT      NOT NULL REFERENCES conta_bancaria(id),
    competencia     DATE        NOT NULL,   -- primeiro dia do mes
    saldo_banco     NUMERIC(16,2),
    saldo_erp       NUMERIC(16,2),
    diferenca       NUMERIC(16,2) GENERATED ALWAYS AS (saldo_banco - saldo_erp) STORED,
    linhas_total    INT         NOT NULL DEFAULT 0,
    linhas_pendentes INT        NOT NULL DEFAULT 0,
    fechado_em      TIMESTAMPTZ,
    fechado_por     TEXT,
    UNIQUE (conta_id, competencia)
);

-- ---------------------------------------------------------------------------
-- metricas do SLA (o que o modelo servico-como-servico promete e mede)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW vw_metricas_conciliacao AS
SELECT
    cb.cliente_slug,
    date_trunc('month', le.data_mov)::date                    AS competencia,
    count(*)                                                   AS linhas,
    count(*) FILTER (WHERE m.faixa = 'automatico')             AS automaticas,
    round(100.0 * count(*) FILTER (WHERE m.faixa = 'automatico')
          / nullif(count(*), 0), 1)                            AS pct_automatico,
    count(*) FILTER (WHERE m.desfeito_em IS NOT NULL)          AS retrabalho,
    count(*) FILTER (WHERE e.status = 'aberta')                AS excecoes_abertas,
    count(*) FILTER (WHERE e.tipo IN ('sem_titulo_saida','sem_titulo_entrada'))
                                                               AS buracos_no_erp,
    avg(EXTRACT(EPOCH FROM (e.resolvida_em - e.criado_em)) / 3600.0)
        FILTER (WHERE e.resolvida_em IS NOT NULL)              AS horas_media_excecao
FROM linha_extrato le
JOIN conta_bancaria cb          ON cb.id = le.conta_id
LEFT JOIN match_conciliacao m   ON m.linha_id = le.id AND m.desfeito_em IS NULL
LEFT JOIN excecao e             ON e.linha_id = le.id
GROUP BY 1, 2;
