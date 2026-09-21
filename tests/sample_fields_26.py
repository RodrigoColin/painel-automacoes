"""
Primeira exploração real de `servicos/contrato` (ListarContratos) — endpoint
já catalogado e com um wrapper básico em `tools/servicos.py::listar_contratos_servico()`,
mas NUNCA testado contra dado real (nomes de campo não confirmados).

Objetivo (pedido do Rodrigo em 2026-08-10): o relatório nativo do Omie "Fluxo
de Caixa por Categoria Diário" projeta receita de contratos recorrentes
(RPA Recorrente/Presto Recorrente) mesmo ANTES do título do mês ser gerado —
e a gente precisa fazer o mesmo. Pra isso precisamos entender, no retorno de
ListarContratos, quais campos existem pra:
  - identificar o cliente (código/nome)
  - o valor da mensalidade/parcela recorrente
  - a periodicidade/dia de vencimento (ex.: "todo dia 28")
  - até quando o contrato já tem título gerado / próxima geração prevista
  - status do contrato (ativo/inativo/suspenso)

Este script:
  1) Lista contratos (sem filtro, primeira página) e imprime o registro cru
     completo de até 3 contratos, pra ver todos os campos disponíveis.
  2) Tenta achar contratos de alguns clientes específicos que sabemos que
     têm previsão de recorrência em 28/08/2026 no relatório nativo do Omie
     mas SEM nenhum título aberto em Contas a Receber ainda: PEREIRA
     GIONEDIS, VIANA PEIXOTO, MASCARENHAS BARBOSA, INTELLIGENTI (STEFANINI).
     Se achar, imprime o registro completo desse cliente — é o caso mais
     informativo pra entender que campo aponta pra "dia 28".

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_26.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieClient, OmieAPIError  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.tools import servicos as tools_servicos  # noqa: E402

CLIENTES_ALVO = [
    "PEREIRA GIONEDIS",
    "VIANA PEIXOTO",
    "MASCARENHAS BARBOSA",
    "INTELLIGENTI",
]


def _print_dict(d, indent: str = "  ") -> None:
    for k in sorted(d.keys()):
        v = d[k]
        if isinstance(v, dict):
            print(f"{indent}{k}:")
            _print_dict(v, indent + "    ")
        elif isinstance(v, list):
            print(f"{indent}{k}: [lista com {len(v)} item(ns)]")
            for item in v[:3]:
                if isinstance(item, dict):
                    _print_dict(item, indent + "    ")
                else:
                    print(f"{indent}    {item!r}")
        else:
            print(f"{indent}{k} = {v!r}")


def _nome_contrato(c: dict) -> str:
    for chave in ("razao_social", "nome_fantasia", "cCodCli", "codigo_cliente"):
        if c.get(chave):
            return str(c[chave])
    return ""


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
        print("Buscando ListarContratos (sem filtro, pode levar um instante)...\n")
        try:
            contratos = await tools_servicos.listar_contratos_servico(client, max_paginas=3)
        except OmieAPIError as exc:
            print(f"[erro Omie] {exc}")
            print(f"  fault_code={exc.fault_code}")
            print(f"  payload={exc.payload}")
            return 1
        except Exception as exc:
            print(f"[erro inesperado] {type(exc).__name__}: {exc}")
            return 1

        print(f"{len(contratos)} contrato(s) retornado(s) (até 3 páginas).\n")
        if not contratos:
            print("[!] Lista vazia — pode ser filtro obrigatório faltando, ou "
                  "records_key errado (ver tools/servicos.py). Rode com "
                  "--modo relatorio noutro endpoint se quiser comparar.")
            return 0

        print("=== Registro cru completo dos 3 primeiros contratos ===\n")
        for i, c in enumerate(contratos[:3], start=1):
            print(f"--- contrato {i} ---")
            _print_dict(c)
            print()

        print("\n=== Procurando clientes-alvo (dia 28/08 sem título aberto) ===\n")
        for alvo in CLIENTES_ALVO:
            achados = [
                c for c in contratos
                if alvo.upper() in _nome_contrato(c).upper()
                or alvo.upper() in str(c).upper()
            ]
            if not achados:
                print(f"[!] Nenhum contrato encontrado contendo '{alvo}'")
                continue
            for c in achados:
                print(f"=== Contrato encontrado: '{alvo}' ===")
                _print_dict(c)
                print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
