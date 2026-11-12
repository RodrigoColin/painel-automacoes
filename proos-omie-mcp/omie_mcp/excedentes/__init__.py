"""
Excedentes OYSTR → OS no Omie.

A planilha mensal de excedentes (um robô/serviço por linha) vira uma OS
adicional por contrato, na etapa Faturar (50) — NUNCA faturada por aqui.
Especificação: skill excedentes-oystr-omie; gabarito validado à mão em
novembro/2026 (59 OSs + 1 exceção, R$ 35.107,87).

Módulos:
  planilha    — parser e validação do xlsx (coluna R marcada = ignorada)
  vencimento  — dias úteis (feriados nacionais) e as 3 regras de vencimento
  depara      — De/Para serviço recorrente → excedente (fonte: Postgres)
  resolucao   — consultas ao Omie (cliente por CNPJ, contrato, e-mail)
  plano       — monta o plano (prévia) sem escrever nada no Omie
  criacao     — payload IncluirOS + idempotência por cCodIntOS, lotes de 4
"""
