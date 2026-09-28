"""
Quarta rodada: o `nCodLancamento` do extrato NÃO bate com o
`codigo_lancamento_omie` do título (confirmado — sample_fields_3.py deu
"Lançamento não cadastrado" nos 4 casos). São espaços de ID diferentes
(o extrato tem seu próprio código de lançamento bancário). Preciso ver
o formato completo de um título já RECEBIDO/PAGO (via ListarContas*
com filtrar_por_status) pra achar visualmente o campo certo pra cruzar
com o movimento do extrato (nome do cliente, valor, categoria, número
de documento) — em vez de adivinhar mais um nome de campo.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_4.py --cliente oystr
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
from omie_mcp.tools import contas_pagar, contas_receber  # noqa: E402


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
        print("=== Contas a Receber com status RECEBIDO (3 registros, todos os campos) ===")
        try:
            receber = await contas_receber.listar_contas_receber(
                client,
                filtros={"filtrar_por_status": "RECEBIDO"},
                max_paginas=1,
            )
            for r in receber[:3]:
                print(json.dumps(r, indent=2, ensure_ascii=False))
        except OmieAPIError as exc:
            print(f"[erro RECEBIDO] {exc} (fault_code={exc.fault_code})")

        print("\n=== Contas a Pagar com status PAGO (3 registros, todos os campos) ===")
        try:
            pagar = await contas_pagar.listar_contas_pagar(
                client,
                filtros={"filtrar_por_status": "PAGO"},
                max_paginas=1,
            )
            for p in pagar[:3]:
                print(json.dumps(p, indent=2, ensure_ascii=False))
        except OmieAPIError as exc:
            print(f"[erro PAGO] {exc} (fault_code={exc.fault_code})")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))