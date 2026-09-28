"""
Diagnóstico do bug de PERDA/PREJUÍZO contado como dinheiro de verdade
(achado por Rodrigo em 2026-08-08, comparando "Fluxo Diario Ago-2026"
contra FluxoCaixa_Oystr.xlsx no dia 21/08).

O fix em omie_mcp/reports/oystr_diagnostico.py assumiu que os 4 nCodCC do
EXCLUIR de fluxo_caixa.py (1847900459, 1860513751, 2182599423, 2263959487)
cobrem a conta "PERDA / PREJUIZO" — mas isso NUNCA foi confirmado contra
dado real (o sandbox de nuvem não alcança o Omie). A rodada de teste do
Rodrigo em 2026-08-08 saiu com os 7 lançamentos do BARBIERI E DE CASTRO
ADVOGADOS (baixados por perda/prejuízo em 04/08) ainda presentes na
planilha gerada — ou o nCodCC da conta "PERDA / PREJUIZO" não está nesse
EXCLUIR, ou tem outro problema no fix. Este script:

  1) Lista TODAS as contas correntes (nCodCC, descrição, inativo,
     nao_fluxo, nao_resumo) — pra achar o nCodCC real de "PERDA /
     PREJUIZO" e comparar contra o EXCLUIR hardcoded.
  2) Busca o lançamento de conta corrente do título do BARBIERI (usando
     ListarLancCC filtrado pelo período de 04/08/2026) e imprime o
     cabecalho.nCodCC dele — o teste de verdade: esse nCodCC está (ou
     não) no conjunto retornado por contas_fluxo_de_caixa().

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_21.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.reports.oystr_diagnostico import _EXCLUIR_CONTAS_NAO_CAIXA  # noqa: E402
from omie_mcp.tools import contas_correntes as tools_contas_correntes  # noqa: E402
from omie_mcp.tools import lancamentos_cc as tools_lancamentos_cc  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cliente", default=None)
    args = parser.parse_args()

    try:
        registry = ClientesRegistry.load()
        slug = registry.resolver_slug(args.cliente)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"[config] {exc}")
        return 1

    print(f"Cliente: {slug}\n")

    async with OmieClient(settings) as client:
        print("=== 1) Todas as contas correntes ===")
        contas = await tools_contas_correntes.listar_contas_correntes(client)
        print(f"{len(contas)} contas encontradas.\n")
        for c in contas:
            n_cod = c.get("nCodCC")
            marca_exclusao = " <-- ESTA NO EXCLUIR hardcoded" if n_cod in _EXCLUIR_CONTAS_NAO_CAIXA else ""
            print(f"  nCodCC={n_cod!r:15} descricao={c.get('descricao')!r:45} "
                  f"inativo={c.get('inativo')!r} nao_fluxo={c.get('nao_fluxo')!r} "
                  f"nao_resumo={c.get('nao_resumo')!r}{marca_exclusao}")

        contas_validas = await tools_contas_correntes.contas_fluxo_de_caixa(
            client, excluir=_EXCLUIR_CONTAS_NAO_CAIXA
        )
        print(f"\ncontas_fluxo_de_caixa() retornou {len(contas_validas)} contas válidas: "
              f"{sorted(contas_validas)}\n")

        print("=== 2) Lançamento do BARBIERI E DE CASTRO ADVOGADOS (baixado em 04/08/2026) ===")
        lancamentos = await tools_lancamentos_cc.listar_lancamentos_cc(
            client, data_pagamento_de="03/08/2026", data_pagamento_ate="05/08/2026",
        )
        print(f"{len(lancamentos)} lançamentos nesse período curto.\n")
        achou = False
        for lc in lancamentos:
            n_cod_cc = tools_lancamentos_cc.conta_corrente_id(lc)
            desc_cliente = lc.get("cabecalho", {}).get("cDesCliente", "")
            if "BARBIERI" in (desc_cliente or "").upper():
                achou = True
                esta_valido = n_cod_cc in contas_validas
                print(f"  ACHOU: cDesCliente={desc_cliente!r} nCodCC={n_cod_cc!r} "
                      f"nValorLanc={lc.get('cabecalho', {}).get('nValorLanc')!r} "
                      f"dDtLanc={lc.get('cabecalho', {}).get('dDtLanc')!r}")
                print(f"  Esse nCodCC está em contas_validas (ou seja, o lançamento SERIA "
                      f"mantido)? {esta_valido}")
        if not achou:
            print("  Nenhum lançamento do BARBIERI encontrado nesse período "
                  "(pode ser nome de cliente diferente na resposta bruta — ver "
                  "lista completa abaixo).")
            print("\n  Todos os cDesCliente + nCodCC desse período curto:")
            for lc in lancamentos:
                print(f"    {lc.get('cabecalho', {}).get('cDesCliente')!r} | "
                      f"nCodCC={tools_lancamentos_cc.conta_corrente_id(lc)!r} | "
                      f"valor={lc.get('cabecalho', {}).get('nValorLanc')!r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
