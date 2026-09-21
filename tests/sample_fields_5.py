"""
Quinta rodada: usa `filtrar_por_status="LIQUIDADO"` (contas a receber) /
"PAGO" (contas a pagar) combinado com `codigo_cliente_fornecedor` dos
clientes/fornecedores que JÁ apareceram nos movimentos reais do extrato
(sample_fields_2.py) — pra achar o título exato correspondente e comparar
campo a campo (Emissão, Vencimento, valor_documento) com o que o
movimento do extrato trouxe.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_5.py --cliente oystr
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

# (descrição, codigo_cliente_fornecedor, natureza)
CASOS = [
    ("BRIGANTI SOCIEDADE DE ADVOGADOS (recebimento RPS 2804, R$ 1095.52 em 01/07/2026)",
     2175755986, "R"),
    ("NANTES E MELLO SOCIEDADE DE ADVOGADOS (recebimento RPS 2812, R$ 2000.00 em 01/07/2026)",
     2493349530, "R"),
    ("PROOS GESTAO EMPRESARIAL (pagamentos R$ 2500.00 e R$ 4685.09 em 01/07/2026)",
     1628930719, "P"),
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
        for descricao, codigo_cliente_fornecedor, natureza in CASOS:
            print(f"=== {descricao} ===")
            try:
                if natureza == "R":
                    titulos = await contas_receber.listar_contas_receber(
                        client,
                        filtros={
                            "filtrar_por_status": "LIQUIDADO",
                            "codigo_cliente_fornecedor": codigo_cliente_fornecedor,
                        },
                        max_paginas=1,
                    )
                else:
                    titulos = await contas_pagar.listar_contas_pagar(
                        client,
                        filtros={
                            "filtrar_por_status": "PAGO",
                            "codigo_cliente_fornecedor": codigo_cliente_fornecedor,
                        },
                        max_paginas=1,
                    )
                print(f"({len(titulos)} títulos encontrados)")
                for t in titulos[:5]:
                    print(json.dumps(t, indent=2, ensure_ascii=False))
            except OmieAPIError as exc:
                print(f"[erro] {exc} (fault_code={exc.fault_code})")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
