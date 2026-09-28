"""
Testa nomes de filtro de data sugeridos por uma pesquisa externa sobre um
MCP open source do Omie (@codespar/mcp-omie) — a pesquisa avisa que esse
MCP tem erros de schema em outros pontos, então aqui só validamos contra
a API real antes de confiar:

  filtrar_por_data_de / filtrar_por_data_ate
  filtrar_por_emissao_de / filtrar_por_emissao_ate

Se algum funcionar em ListarContasReceber/ListarContasPagar, substitui o
hack de busca binária por página que hoje faz
buscar_titulos_liquidados_no_periodo() em omie_mcp/reports/oystr_diagnostico.py.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_12.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402

TENTATIVAS = [
    {"filtrar_por_status": "LIQUIDADO",
     "filtrar_por_data_de": "01/07/2026", "filtrar_por_data_ate": "05/08/2026"},
    {"filtrar_por_status": "LIQUIDADO",
     "filtrar_por_emissao_de": "01/07/2026", "filtrar_por_emissao_ate": "05/08/2026"},
]


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
        for params in TENTATIVAS:
            print(f"=== ListarContasReceber com params={params} ===")
            try:
                full_params = dict(params)
                full_params.update({"pagina": 1, "registros_por_pagina": 5})
                data = await client.call(
                    "financas/contareceber", "ListarContasReceber", params=full_params
                )
                registros = data.get("conta_receber_cadastro", [])
                print(f"[OK] total_de_registros={data.get('total_de_registros')} "
                      f"total_de_paginas={data.get('total_de_paginas')}")
                for r in registros[:3]:
                    print(f"  data_emissao={r.get('data_emissao')} "
                          f"data_vencimento={r.get('data_vencimento')} "
                          f"status_titulo={r.get('status_titulo')}")
            except OmieAPIError as exc:
                print(f"[erro] {exc} (fault_code={exc.fault_code})")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
