"""
Sétima rodada: investigar se existe uma ligação real (não aproximada)
entre o movimento do extrato e o título original — em vez de aceitar
cruzamento por aproximação, já que a "Data de Crédito ou Débito (No
Extrato)" é o dado mais importante do fluxo de caixa.

Três frentes:

  A) Buscar o título da BRIGANTI (visto no extrato: cDocumentoFiscal
     "2804", cNumero "RPS 2804", nCodCliente 2175755986, R$ 1095.52 em
     01/07/2026) via ListarContasReceber filtrando por
     numero_documento_fiscal — se o Omie aceitar esse filtro, achamos
     o título exato e testamos se ConsultarContaReceber nele já traz
     data de liquidação real (título recente, integrado via Itaú —
     diferente do título antigo/manual testado antes, que veio vazio).

  B) Testar a call "PesquisarLancamentos" (financas/pesquisartitulos)
     — catalogada como "busca combinada de contas a pagar/receber",
     nunca testada. Pode já unir título + baixa bancária num só
     registro.

  C) Testar a call "ListarMovimentos" (financas/mf) — também nunca
     testada, nome sugere movimentos financeiros (pode ser o elo entre
     extrato e título, ou pode ser sobre transferências internas).

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_7.py --cliente oystr
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
from omie_mcp.tools import contas_receber  # noqa: E402


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
        print("=== A) ListarContasReceber filtrando por numero_documento_fiscal='2804' ===")
        titulo_encontrado = None
        try:
            titulos = await contas_receber.listar_contas_receber(
                client,
                filtros={"filtrar_por_status": "LIQUIDADO", "numero_documento_fiscal": "2804"},
                max_paginas=1,
            )
            print(f"({len(titulos)} títulos encontrados)")
            for t in titulos[:5]:
                print(json.dumps(t, indent=2, ensure_ascii=False))
                if t.get("codigo_cliente_fornecedor") == 2175755986:
                    titulo_encontrado = t
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")

        if titulo_encontrado:
            cod = titulo_encontrado["codigo_lancamento_omie"]
            print(f"\n=== A2) ConsultarContaReceber({cod}) — título recente (VENR), "
                  "todos os campos ===")
            try:
                detalhe = await contas_receber.consultar_conta_receber(client, cod)
                print(json.dumps(detalhe, indent=2, ensure_ascii=False))
            except OmieAPIError as exc:
                print(f"[erro] {exc} (fault_code={exc.fault_code})")
        else:
            print("\n(não achou o título exato da BRIGANTI por esse filtro — pulando A2)")

        print("\n=== B) PesquisarLancamentos (financas/pesquisartitulos) ===")
        try:
            data = await client.call(
                "financas/pesquisartitulos", "PesquisarLancamentos",
                params={"pagina": 1, "registros_por_pagina": 3},
            )
            print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")
        except Exception as exc:  # noqa: BLE001
            print(f"[erro inesperado] {type(exc).__name__}: {exc}")

        print("\n=== C) ListarMovimentos (financas/mf) ===")
        try:
            data = await client.call(
                "financas/mf", "ListarMovimentos",
                params={"pagina": 1, "registros_por_pagina": 3},
            )
            print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")
        except Exception as exc:  # noqa: BLE001
            print(f"[erro inesperado] {type(exc).__name__}: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))