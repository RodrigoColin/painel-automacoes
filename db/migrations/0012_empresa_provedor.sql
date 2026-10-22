-- Provedor de dados do fluxo de caixa por empresa.
--
-- Até aqui o motor (container `caixa`) só falava com o Omie — a elegibilidade
-- era implícita ("tem pasta no Infisical com OMIE_APP_KEY"). Para incluir
-- empresas que vivem no Nibo sem reescrever o motor (que já é agnóstico de ERP:
-- lê o pacote normalizado de `caixa_pacote_diario`), esta coluna diz qual
-- adaptador a rodada usa: 'omie' (padrão) ou 'nibo'.
--
-- 'nibo' + a credencial NIBO_API_TOKEN na pasta Infisical da empresa fazem
-- caixa/rodada.py::executar escolher caixa/nibo/montar_pacote em vez do Omie.
-- Nada mais muda: a tela e os cálculos (extra.py) consomem o mesmo pacote.
--
-- Idempotente (IF NOT EXISTS) — seguro reaplicar.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS provedor text NOT NULL DEFAULT 'omie';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'empresas_provedor_check'
  ) THEN
    ALTER TABLE public.empresas
      ADD CONSTRAINT empresas_provedor_check CHECK (provedor IN ('omie', 'nibo'));
  END IF;
END $$;
