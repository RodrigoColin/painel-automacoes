"""
Puxa 1-2 registros reais de Contas a Receber, Contas a Pagar e Contas
Correntes para inspecionar os nomes exatos dos campos que o Omie devolve
— usado para mapear com precisão as colunas da planilha
Oystr_Diagnostico_Consolidado.xlsx (abas "Base - Receber Aberto" e
"Base - Pagar Aberto"). Não escreve nada no Omie.

Uso:
    python tests\\sample_fields.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.tools import clientes, contas_correntes, contas_pagar, contas_receber  # noqa: E402


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
        print("=== Contas Correntes (todas) ===")
        contas = await contas_correntes.listar_contas_correntes(client, max_paginas=1)
        for c in contas[:20]:
            print(json.dumps(c, indent=2, ensure_ascii=False))

        print("\n=== Contas a Receber (1 registro) ===")
        receber = await contas_receber.listar_contas_receber(client, max_paginas=1)
        if receber:
            print(json.dumps(receber[0], indent=2, ensure_ascii=False))
        else:
            print("(nenhum registro retornado)")

        print("\n=== Contas a Pagar (1 registro) ===")
        pagar = await contas_pagar.listar_contas_pagar(client, max_paginas=1)
        if pagar:
            print(json.dumps(pagar[0], indent=2, ensure_ascii=False))
        else:
            print("(nenhum registro retornado)")

        print("\n=== Cliente (1 registro, para achar Razão Social/CNPJ) ===")
        cli = await clientes.listar_clientes(client, max_paginas=1)
        if cli:
            print(json.dumps(cli[0], indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
