"""
Diagnóstico pontual (2026-08-19): pra decidir COMO mudar o critério de
"Realizado" pra ficar igual ao relatório nativo do Omie mesmo em títulos
sem par no extrato (pedido do Rodrigo).

Achado que motivou este script: comparando "Fluxo Diario Ago-2026" contra
o export nativo `FluxoCaixa_Oystr.xlsx` do dia 19/08, o dia 18/08 teve uma
diferença de R$14.310,27 — rastreada até 12 títulos que o Omie já mostra
como "realizado" no dia 18/08, mas que na nossa base ficam com "Data de
Crédito ou Débito (No Extrato)" em branco (sem lançamento de conta
corrente casado via `ListarLancCC`, ver `linha_liquidado()` em
oystr_diagnostico.py) — então caem fora do "Realizado" do dia até alguém
revisar manualmente.

O problema: o título consultado via `ConsultarContaReceber`/
`ConsultarContaPagar` (usado no caminho PRIMÁRIO, com lançamento já
casado) não tem nenhum campo de "data de pagamento" de verdade — só
data_emissao/data_previsao/data_vencimento/data_registro (confirmado
inspecionando o cache local `.cache/titulos_liquidados_*.json`: os campos
'recebimento' e 'lancamento_detalhe' vêm sempre None nos 8269+3835
títulos já cacheados). E os títulos "SEM PAR" (o caso que queremos
corrigir) nem passam por essa consulta individual — vêm direto de
`ListarContasReceber`/`ListarContasPagar` (paginado, status LIQUIDADO/
PAGO), que pode ter campos DIFERENTES da consulta individual.

Este script:
  1) Busca via ListarContasReceber/ListarContasPagar (mesma chamada que
     `buscar_titulos_liquidados_no_periodo` usa) e imprime o JSON CRU
     completo de títulos que batem com os exemplos reais do dia 18/08
     (por nome de cliente) — pra ver TODOS os campos disponíveis, achar
     se existe uma data de pagamento/liquidação de verdade.
  2) Pra cada um desses títulos, também busca em ListarLancCC (lançamentos
     de conta corrente) numa janela BEM mais larga (90 dias pra cada lado,
     contra os 20 dias que o relatório usa hoje) — pra checar se na
     verdade EXISTE um lançamento vinculado que a janela atual de 20 dias
     está perdendo (isso seria uma causa raiz diferente e mais simples de
     corrigir: só alargar a margem, sem precisar mudar o critério).

Uso:
    python scripts\\debug_titulos_sem_par.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesRegistry  # noqa: E402
from omie_mcp.reports.oystr_diagnostico import (  # noqa: E402
    buscar_titulos_liquidados_no_periodo,
    buscar_lancamentos_cc_periodo,
)
from omie_mcp.tools import lancamentos_cc as tools_lancamentos_cc  # noqa: E402

# Exemplos reais do dia 18/08/2026 (via export nativo "FluxoCaixa_Oystr.xlsx",
# aba Detalhamento) que estão SEM par no extrato na nossa base hoje.
NOMES_EXEMPLO = [
    "CONTINI",
    "AZEVEDO SETTE",
    "MORAES JR",
    "MORAES JUNIOR",
    "PRECATORIOEXPRESS",
    "TURIANO",
    "BASTIAN",
    "BELCAR",
    "CARREIRA E SARTORELLO",
    "BOCHI BRUM",
    "ROCHA E CALDERON",
    "MARISA BALBOA",
    "FREIRE",
]


def _json(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cliente", required=True, help="slug do cliente Proos (ex.: oystr)")
    ap.add_argument("--desde", default="01/08/2026", help="dd/mm/aaaa (emissão)")
    ap.add_argument("--ate", default="18/08/2026", help="dd/mm/aaaa (emissão)")
    args = ap.parse_args()

    registry = ClientesRegistry.load()
    settings = registry.settings_for(args.cliente)
    client = OmieClient(settings)

    print("Buscando títulos RECEBIDOS via ListarContasReceber...", flush=True)
    recebidos = await buscar_titulos_liquidados_no_periodo(
        client, "financas/contareceber", "ListarContasReceber", "LIQUIDADO",
        "conta_receber_cadastro", args.desde, args.ate,
    )
    print(f"  {len(recebidos)} título(s) recebido(s) no período.\n")

    achados = []
    for t in recebidos:
        # nome não vem no título cru — mas o número do documento/RPS costuma
        # bater com o exemplo do Detalhamento nativo, então também mostra os
        # títulos cujo numero_documento aparece nos exemplos (RPS 3472 etc.)
        doc = str(t.get("numero_documento", ""))
        if any(doc.strip().upper() == d for d in ["RPS 3472", "RPS 3745", "RPS 3777",
                                                     "RPS 3561", "RPS 3686", "RPS 3914",
                                                     "RPS 3659", "RPS 3678", "RPS 3799",
                                                     "RPS 3891", "RPS 3334"]):
            achados.append(t)

    print("=" * 70)
    print(f"{len(achados)} título(s) batendo pelo número do documento (RPS) dos exemplos:")
    for t in achados:
        print("-" * 70)
        print(_json(t))

    if not achados:
        print("\nNenhum bateu por número de documento — mostrando os 5 primeiros "
              "títulos do período pra eu ver o formato completo dos campos:")
        for t in recebidos[:5]:
            print("-" * 70)
            print(_json(t))

    # Parte 2: checa se existe lançamento de conta corrente vinculado numa
    # janela BEM mais larga que os 20 dias usados em produção hoje.
    print("\n" + "=" * 70)
    print("Checando ListarLancCC numa janela de 90 dias pra cada lado...")
    margem = timedelta(days=90)
    de = (datetime.strptime(args.desde, "%d/%m/%Y") - margem).strftime("%d/%m/%Y")
    ate = (datetime.strptime(args.ate, "%d/%m/%Y") + margem).strftime("%d/%m/%Y")
    lancamentos = await buscar_lancamentos_cc_periodo(client, de, ate)
    print(f"  {len(lancamentos)} lançamento(s) de conta corrente na janela larga.")

    codigos_alvo = {t.get("codigo_lancamento_omie") for t in achados}
    for lc in lancamentos:
        cod_receber = tools_lancamentos_cc.titulo_vinculado_receber(lc)
        if cod_receber in codigos_alvo:
            print("-" * 70)
            print(f"ACHOU lançamento vinculado (fora da janela de 20 dias) pro título "
                  f"{cod_receber}:")
            print(_json(lc))

    print("\n" + "=" * 70)
    print("Copie e cole ESSE terminal inteiro de volta.")


if __name__ == "__main__":
    asyncio.run(main())
