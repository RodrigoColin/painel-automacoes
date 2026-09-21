"""
financas/mf / ListarMovimentos já confirmamos que EXISTE (o erro anterior
foi de parâmetro errado, "Tag [PAGINA] não faz parte da estrutura
[mfListarRequest]" — ou seja, o nome da call é aceito, só não usa pagina/
registros_por_pagina como os outros "Listar*"). Este script tenta
descobrir o formato certo de parâmetro por tentativa e erro estruturado,
usando as mensagens de erro do próprio Omie como guia (elas dizem o nome
exato da tag errada).

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_10.py --cliente oystr
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

# Tentativas de parâmetro, da mais simples pra mais específica — cada uma
# testada isoladamente pra ver a mensagem de erro exata do Omie.
TENTATIVAS = [
    {},
    {"nPagina": 1, "nRegPorPagina": 3},
    {"cCodIntCC": "", "dPeriodoInicial": "01/07/2026", "dPeriodoFinal": "05/08/2026"},
    {"nCodCC": 1628924843, "dPeriodoInicial": "01/07/2026", "dPeriodoFinal": "05/08/2026"},
    {"nCodLancamento": 2530065632},
    {"codigo_lancamento": 2530065632},
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
            print(f"=== ListarMovimentos com params={params} ===")
            try:
                data = await client.call("financas/mf", "ListarMovimentos", params=params)
                print("[OK]")
                print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])
            except OmieAPIError as exc:
                print(f"[erro] {exc} (fault_code={exc.fault_code})")
            except Exception as exc:  # noqa: BLE001
                print(f"[erro inesperado] {type(exc).__name__}: {exc}")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
