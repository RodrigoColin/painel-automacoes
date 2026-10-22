"""
Adaptador do Nibo para o pipeline de fluxo de caixa.

O motor (caixa/extra.py::montar_extra, caixa/rodada.py e a tela Next.js) é
agnóstico de ERP: só consome o `extrato` (dict) e as 7 `bases` de títulos, com
os nomes de coluna fixados em caixa/bases.py::COLUNAS. Este pacote produz
EXATAMENTE essas duas estruturas a partir da API do Nibo, do mesmo jeito que
caixa/extrato.py + caixa/bases.py produzem a partir do Omie — ver montar_pacote.

Diferença de fonte que molda o adaptador:
  - o extrato do Omie (ListarExtrato) já traz as previsões futuras embutidas;
    o `views/statement` do Nibo traz só movimento realizado. Então as linhas
    futuras do extrato (dias "previsto") são SINTETIZADAS a partir dos
    agendamentos em aberto (schedules isPaid=false), por data de vencimento.
  - o Nibo não tem "contratos" nem "OS": as bases contratos_nao_faturados,
    os_nao_faturadas e status_contratos saem vazias (montar_extra lida bem com
    isso — só não há projeção de receita por contrato; ela se apoia no a
    receber em aberto + recorrência).
"""

from __future__ import annotations

from .cliente import NiboClient, NiboError, NiboTokenExpirado
from .pacote import contas_excluidas, montar_pacote

__all__ = [
    "NiboClient",
    "NiboError",
    "NiboTokenExpirado",
    "montar_pacote",
    "contas_excluidas",
]
