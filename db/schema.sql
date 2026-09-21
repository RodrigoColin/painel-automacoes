-- Schema do banco de dados do proos-omie-mcp — camada de armazenamento
-- persistente pros dados hoje só gravados no Oystr_Diagnostico_Consolidado.xlsx.
--
-- Desenho: multi-tenant desde o início (coluna `empresa`, o mesmo slug já
-- usado em clientes_omie.json — ver omie_mcp/clients.py) porque a Proos já
-- atende mais de um cliente Omie e o mesmo pipeline deve servir todos.
--
-- Cada rodada de extração (relatorio.montar_relatorio() ou
-- analise_faturamento_mrr.py --modo gerar) grava um lote de linhas
-- carimbado com `rodada_id` — NUNCA sobrescreve o lote anterior. Isso seque
-- o mesmo princípio que Rodrigo já escolheu pro nome de arquivo do Excel
-- (Oystr_Diagnostico_Consolidado_AAAAMMDD_HHMMSS.xlsx, timestamp em vez de
-- sobrescrita) — mantém histórico completo pra auditoria (ex.: "por que
-- esse cliente aparecia como churn na rodada de 20/08 e não aparece mais na
-- de 26/08?"), e "os dados de agora" é sempre só "a rodada CONCLUIDA mais
-- recente por empresa/tipo" (ver views no fim do arquivo) — nunca uma
-- linha é alterada ou apagada por uma rodada nova.
--
-- Idempotente: pode rodar este arquivo várias vezes (CREATE ... IF NOT
-- EXISTS / CREATE OR REPLACE em tudo).

-- ============================================================================
-- 1. rodadas_extracao — log/auditoria de cada execução do pipeline
-- ============================================================================
CREATE TABLE IF NOT EXISTS rodadas_extracao (
    id              BIGSERIAL PRIMARY KEY,
    empresa         TEXT NOT NULL,               -- slug do cliente Proos (ex.: 'oystr')
    tipo            TEXT NOT NULL CHECK (tipo IN ('diagnostico', 'mrr')),
    iniciado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluido_em    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'em_andamento'
                        CHECK (status IN ('em_andamento', 'concluida', 'falhou')),
    data_de         DATE,
    data_ate        DATE,
    parametros      JSONB,                       -- args da execução (desde/ate/meses_futuros/etc.)
    erro            TEXT,                        -- preenchido só quando status='falhou'
    origem          TEXT                         -- hostname/usuário de quem rodou, se quiser rastrear
);

CREATE INDEX IF NOT EXISTS idx_rodadas_empresa_tipo_status
    ON rodadas_extracao (empresa, tipo, status, concluido_em DESC);


-- ============================================================================
-- 2. titulos_movimento — grão unificado das 6 listas que hoje viram as
--    abas "Base -" do Excel (Receber Aberto / Pagar Aberto / Recebimentos /
--    Pagamentos / Contratos Não Faturados / OS Não Faturadas), vindas de
--    relatorio.montar_relatorio() em omie_mcp/reports/oystr_diagnostico.py.
--    `tipo` diz qual das 6 listas originou a linha — mantém tudo numa
--    tabela só porque as colunas se sobrepõem quase totalmente, mas nada
--    impede separar em 6 tabelas depois se um `tipo` específico crescer
--    demais e precisar de colunas próprias.
-- ============================================================================
CREATE TABLE IF NOT EXISTS titulos_movimento (
    id                          BIGSERIAL PRIMARY KEY,
    rodada_id                   BIGINT NOT NULL REFERENCES rodadas_extracao(id) ON DELETE CASCADE,
    empresa                     TEXT NOT NULL,
    tipo                        TEXT NOT NULL CHECK (tipo IN (
                                    'receber_aberto', 'pagar_aberto',
                                    'recebimento', 'pagamento',
                                    'contrato_nao_faturado', 'os_nao_faturada'
                                 )),
    cliente                     TEXT,
    cnpj_cpf                    TEXT,
    categoria                   TEXT,
    emissao                     DATE,
    vencimento                  DATE,
    previsao                    DATE,             -- 'Previsão' (Aberto) ou 'Data Prevista' (contrato/OS não faturado)
    data_credito_debito         DATE,              -- só recebimento/pagamento
    documento                   TEXT,
    conta_corrente               TEXT,
    valor_conta                 NUMERIC(14, 2),    -- 'Valor da Conta' (Aberto) ou 'Valor da Conta' liquidado
    valor_realizado              NUMERIC(14, 2),    -- 'Recebido'/'Valor Pago' (0 se aberto) ou 'Valor Mensal'/'Valor' (projeção)
    conciliado                  BOOLEAN,           -- só recebimento/pagamento
    status_titulo               TEXT,              -- só *Aberto
    codigo_lancamento_omie      BIGINT,
    codigo_cliente_fornecedor   BIGINT,
    numero_contrato              TEXT,
    criado_em                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_titulos_mov_rodada ON titulos_movimento (rodada_id);
CREATE INDEX IF NOT EXISTS idx_titulos_mov_empresa_tipo_emissao
    ON titulos_movimento (empresa, tipo, emissao);
CREATE INDEX IF NOT EXISTS idx_titulos_mov_cliente_forn
    ON titulos_movimento (empresa, codigo_cliente_fornecedor);


-- ============================================================================
-- 3. faturamento_linhas — grão de linha de faturamento (histórico realizado
--    + projeção de contrato ainda não faturado), vindo de
--    analise_faturamento_mrr.py: montar_linhas_faturamento() +
--    montar_linhas_projetadas(). É esta tabela que alimenta MRR/ARR/Novos
--    Clientes/Churn — cada linha é um evento de faturamento (título real
--    emitido) ou uma linha de projeção de contrato recorrente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS faturamento_linhas (
    id                      BIGSERIAL PRIMARY KEY,
    rodada_id               BIGINT NOT NULL REFERENCES rodadas_extracao(id) ON DELETE CASCADE,
    empresa                 TEXT NOT NULL,
    codigo_cliente_omie     BIGINT,               -- NULL quando só foi possível identificar por nome (ver cliente_chave)
    cliente_chave           TEXT NOT NULL,        -- cod_cli como veio da extração (inclui o fallback "nome:<cliente>")
    cliente                 TEXT NOT NULL,
    categoria                TEXT NOT NULL,
    contrato                 TEXT,
    emissao                  DATE NOT NULL,        -- data de emissão (histórico) ou dDataLancamento (projeção)
    periodo                  TEXT NOT NULL,        -- 'AAAA-MM', mesmo formato de _mes_ano() no script (rótulo)
    periodo_data              DATE NOT NULL,        -- primeiro dia do mês de `periodo` — pra ordenar/agrupar em SQL
    valor                    NUMERIC(14, 2) NOT NULL,
    realizado                 BOOLEAN NOT NULL,     -- True = título já emitido; False = projeção de contrato
    criado_em                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faturamento_rodada ON faturamento_linhas (rodada_id);
CREATE INDEX IF NOT EXISTS idx_faturamento_empresa_periodo_categoria
    ON faturamento_linhas (empresa, periodo_data, categoria);
CREATE INDEX IF NOT EXISTS idx_faturamento_cliente_chave
    ON faturamento_linhas (empresa, cliente_chave);


-- ============================================================================
-- 4. contratos_status — grão de contrato, vindo de
--    analise_faturamento_mrr.py: montar_status_por_cliente() — usado pra
--    qualificar Novos Clientes/Churn (Ativo / Suspenso / Cancelado /
--    Desconhecido, ver STATUS_CONTRATO_MAP e validacao_churn()).
-- ============================================================================
CREATE TABLE IF NOT EXISTS contratos_status (
    id                      BIGSERIAL PRIMARY KEY,
    rodada_id               BIGINT NOT NULL REFERENCES rodadas_extracao(id) ON DELETE CASCADE,
    empresa                 TEXT NOT NULL,
    codigo_cliente_omie     BIGINT NOT NULL,
    numero_contrato          TEXT,                 -- nCodCtr
    cod_sit_bruto             TEXT,                 -- cCodSit cru do Omie ('10','99','90','00',...)
    status                   TEXT NOT NULL,         -- rótulo mapeado (Ativo/Suspenso/Cancelado/Desconhecido(...))
    valor_mensal              NUMERIC(14, 2),
    vigencia_inicial          DATE,
    vigencia_final            DATE,
    criado_em                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contratos_status_rodada ON contratos_status (rodada_id);
CREATE INDEX IF NOT EXISTS idx_contratos_status_empresa_cliente
    ON contratos_status (empresa, codigo_cliente_omie);


-- ============================================================================
-- Views de conveniência — "os dados de agora" = a rodada CONCLUÍDA mais
-- recente por empresa/tipo. Nenhuma linha de rodada antiga é apagada; as
-- views só filtram pra mostrar a mais recente.
-- ============================================================================

-- Última rodada concluída de cada (empresa, tipo) — junte com isso pra
-- pegar sempre "a foto mais recente".
CREATE OR REPLACE VIEW v_ultima_rodada AS
SELECT DISTINCT ON (empresa, tipo)
    id AS rodada_id, empresa, tipo, concluido_em, data_de, data_ate
FROM rodadas_extracao
WHERE status = 'concluida'
ORDER BY empresa, tipo, concluido_em DESC;

-- Faturamento (linhas) só da última rodada 'mrr' de cada empresa.
CREATE OR REPLACE VIEW v_faturamento_atual AS
SELECT f.*
FROM faturamento_linhas f
JOIN v_ultima_rodada r
  ON r.rodada_id = f.rodada_id AND r.tipo = 'mrr';

-- Status de contrato só da última rodada 'mrr' de cada empresa.
CREATE OR REPLACE VIEW v_contratos_status_atual AS
SELECT c.*
FROM contratos_status c
JOIN v_ultima_rodada r
  ON r.rodada_id = c.rodada_id AND r.tipo = 'mrr';

-- Títulos/movimentos (as 6 "Base -") só da última rodada 'diagnostico' de
-- cada empresa.
CREATE OR REPLACE VIEW v_titulos_movimento_atual AS
SELECT t.*
FROM titulos_movimento t
JOIN v_ultima_rodada r
  ON r.rodada_id = t.rodada_id AND r.tipo = 'diagnostico';

-- MRR agregado por período/categoria a partir da rodada MRR mais recente —
-- inclui o quadro virtual "MRR (RPA + Presto Recorrente)" via UNION ALL,
-- espelhando QUADRO_RECORRENTE em analise_faturamento_mrr.py. Isso é o que
-- um dashboard pode consultar direto, sem reprocessar nada em Python.
--
-- NOTA: Novos Clientes / Churn (diferença de conjunto de clientes entre
-- períodos consecutivos) NÃO está nesta view — é mais claro e mais seguro
-- calcular isso numa consulta/rotina dedicada (ou em Python, como já é
-- hoje) do que embutir a lógica de "período anterior" dentro de uma view.
-- Ver pendência registrada na entrega.
CREATE OR REPLACE VIEW v_mrr_por_periodo_categoria AS
WITH base AS (
    SELECT * FROM v_faturamento_atual
)
SELECT empresa, periodo, periodo_data, categoria,
       COUNT(DISTINCT cliente_chave) AS qtde_clientes,
       COUNT(DISTINCT NULLIF(contrato, '')) AS qtde_contratos,
       SUM(valor) AS valor_total,
       BOOL_OR(realizado) AS tem_faturamento_real
FROM base
GROUP BY empresa, periodo, periodo_data, categoria

UNION ALL

SELECT empresa, periodo, periodo_data, 'MRR (RPA + Presto Recorrente)' AS categoria,
       COUNT(DISTINCT cliente_chave) AS qtde_clientes,
       COUNT(DISTINCT NULLIF(contrato, '')) AS qtde_contratos,
       SUM(valor) AS valor_total,
       BOOL_OR(realizado) AS tem_faturamento_real
FROM base
WHERE categoria IN ('RPA Recorrente', 'Presto Recorrente')
GROUP BY empresa, periodo, periodo_data;
