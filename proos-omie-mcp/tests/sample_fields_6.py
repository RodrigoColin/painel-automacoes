"""
Sexta rodada: `codigo_cliente_fornecedor` não é um filtro válido de
ListarContasReceber/ListarContasPagar (erro: tag não faz parte da
estrutura lcrListarRequest/lcpListarRequest). Em vez de continuar
adivinhando nomes de filtro, esta rodada só olha a primeira e a última
página de títulos LIQUIDADO/PAGO (sem filtro extra) pra descobrir a
ordenação (crescente/decrescente por data) e por quantas páginas
teríamos que rodar pra achar registros de julho/2026 — assim decidimos
com dado real se dá pra usar `pagina` diretamente em vez de baixar tudo.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_6.py --cliente oystr
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


async def olhar(client, modulo, call, status, registros_key):
    print(f"--- {call} (status={status}) ---")
    try:
        primeira = await client.call(
            modulo, call,
            params={"pagina": 1, "registros_por_pagina": 20, "filtrar_por_status": status},
        )
    except OmieAPIError as exc:
        print(f"[erro pagina 1] {exc} (fault_code={exc.fault_code})")
        return

    total_paginas = primeira.get("total_de_paginas")
    total_registros = primeira.get("total_de_registros")
    print(f"total_de_registros={total_registros} total_de_paginas={total_paginas}")

    lote1 = primeira.get(registros_key, [])
    if lote1:
        print("Pagina 1 - primeiro e ultimo emissao/vencimento:")
        print(" ", lote1[0].get("data_emissao"), "/", lote1[0].get("data_vencimento"),
              "-", lote1[-1].get("data_emissao"), "/", lote1[-1].get("data_vencimento"))

    if total_paginas and total_paginas > 1:
        try:
            ultima = await client.call(
                modulo, call,
                params={"pagina": total_paginas, "registros_por_pagina": 20,
                        "filtrar_por_status": status},
            )
            lote2 = ultima.get(registros_key, [])
            if lote2:
                print(f"Pagina {total_paginas} (ultima) - primeiro e ultimo emissao/vencimento:")
                print(" ", lote2[0].get("data_emissao"), "/", lote2[0].get("data_vencimento"),
                      "-", lote2[-1].get("data_emissao"), "/", lote2[-1].get("data_vencimento"))
                print("Exemplo de registro completo da ultima pagina:")
                print(json.dumps(lote2[-1], indent=2, ensure_ascii=False))
        except OmieAPIError as exc:
            print(f"[erro ultima pagina] {exc} (fault_code={exc.fault_code})")
    print()


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
        await olhar(client, "financas/contareceber", "ListarContasReceber",
                    "LIQUIDADO", "conta_receber_cadastro")
        await olhar(client, "financas/contapagar", "ListarContasPagar",
                    "PAGO", "conta_pagar_cadastro")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
