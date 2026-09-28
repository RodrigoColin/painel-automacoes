"""
Testa se o módulo financas/contacorrentelancamentos ("Contas Correntes -
Lançamentos", nunca testado antes) aceita o nCodLancamento que aparece no
extrato — diferente de financas/contapagar/contareceber, que já
confirmamos que rejeita esse código ("Lançamento não cadastrado").

Se aceitar, o registro pode trazer o elo direto entre o movimento do
extrato e o título original (útil especialmente pra pagamentos manuais
sem numero_documento_fiscal, onde a chave composta não funciona).

Usa os nCodLancamento já vistos numa rodada anterior do extrato real
(sample_fields_2.py, cliente oystr). Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_9.py --cliente oystr
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

# nCodLancamento vistos no extrato real (sample_fields_2.py)
CODIGOS = [2530065632, 2530086902, 2530086925, 2530571873]

# Nomes de call plausíveis pra tentar, do mais óbvio ao menos óbvio.
CALLS_PARA_TESTAR = [
    "ConsultarLancamento",
    "ConsultarContaCorrenteLancamento",
    "ListarLancamentos",
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
        for call in CALLS_PARA_TESTAR:
            print(f"=== financas/contacorrentelancamentos / {call} ===")

            # 1) tenta como "Consultar" (um único nCodLancamento)
            try:
                data = await client.call(
                    "financas/contacorrentelancamentos", call,
                    params={"nCodLancamento": CODIGOS[0]},
                )
                print(f"[OK como Consultar, nCodLancamento={CODIGOS[0]}]")
                print(json.dumps(data, indent=2, ensure_ascii=False))
                continue
            except OmieAPIError as exc:
                print(f"[erro tentativa 'Consultar'] {exc} (fault_code={exc.fault_code})")
            except Exception as exc:  # noqa: BLE001
                print(f"[erro inesperado 'Consultar'] {type(exc).__name__}: {exc}")

            # 2) tenta como "Listar" (paginado, sem filtro específico)
            try:
                data = await client.call(
                    "financas/contacorrentelancamentos", call,
                    params={"pagina": 1, "registros_por_pagina": 3},
                )
                print("[OK como Listar]")
                print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])
            except OmieAPIError as exc:
                print(f"[erro tentativa 'Listar'] {exc} (fault_code={exc.fault_code})")
            except Exception as exc:  # noqa: BLE001
                print(f"[erro inesperado 'Listar'] {type(exc).__name__}: {exc}")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
