"""
Segunda rodada de investigação de campos, focada no que ainda falta para
mapear "Base - Recebimentos"/"Base - Pagamentos" (valor pago, data de
crédito/débito no extrato) e a tradução de código de categoria -> nome.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_2.py --cliente oystr
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
from omie_mcp.tools import categorias, contas_pagar, extrato  # noqa: E402


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
        print("=== Detalhe de uma conta a pagar PAGA (ConsultarContaPagar) ===")
        try:
            detalhe = await contas_pagar.consultar_conta_pagar(client, 1840849702)
            print(json.dumps(detalhe, indent=2, ensure_ascii=False))
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")

        print("\n=== Categorias (2 registros, pra ver o formato codigo->nome) ===")
        cats = await categorias.listar_categorias(client, max_paginas=1)
        for c in cats[:2]:
            print(json.dumps(c, indent=2, ensure_ascii=False))

        print("\n=== Extrato de Conta Corrente — ITAU (id 1628924843) ===")
        print("(usando tools/extrato.py: chamada ListarExtrato, corrigida a "
              "partir de proos-automacoes/oystr/fluxo_caixa.py)")
        try:
            movimentos = await extrato.consultar_extrato(
                client,
                n_cod_cc=1628924843,
                data_inicial="01/07/2026",
                data_final="05/08/2026",
            )
            print(f"({len(movimentos)} movimentos)")
            for m in movimentos[:5]:
                print(json.dumps(m, indent=2, ensure_ascii=False))
        except OmieAPIError as exc:
            print(f"[erro na chamada 'ListarExtrato'] {exc} (fault_code={exc.fault_code})")
        except Exception as exc:  # noqa: BLE001
            print(f"[erro inesperado] {type(exc).__name__}: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
