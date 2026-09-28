"""
Confirma se os campos de retenção (valor_ir, valor_pis, valor_cofins,
valor_csll, valor_inss, valor_iss) já vêm de graça em `ListarContasPagar`
(a chamada em LISTA que a gente já usa pra buscar todos os títulos em
aberto) ou se só aparecem em `ConsultarContaPagar` (consulta individual,
1 chamada por título — caro demais pra rodar em ~2000+ títulos toda vez).

Confirmado em 2026-08-08 (Rodrigo rodou sample_fields_24.py): o valor
líquido de verdade que sai do banco é

    valor_liquido = valor_documento - valor_pag
                     - valor_cofins - valor_csll - valor_inss
                     - valor_ir - valor_iss - valor_pis

(bateu exato nos dois títulos testados: R$70,01 e R$6,14 de diferença
eram exatamente a soma dessas retenções). Falta só confirmar ONDE
buscar esses campos sem estourar o número de chamadas à API.

Este script busca o MESMO título (GABRIEL MOREIRA, codigo_lancamento_omie
2386235757) via `ListarContasPagar` (lista, filtrando por status "A
VENCER") e imprime o registro cru completo — se `valor_cofins` etc.
aparecerem aqui, não precisamos de chamada extra nenhuma. Não escreve
nada no Omie.

Uso:
    python tests\\sample_fields_25.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.tools import contas_pagar as tools_contas_pagar  # noqa: E402

CODIGO_ALVO = 2386235757  # GABRIEL MOREIRA E GABRIELA COELHO ADVOCACIA


def _print_dict(d: dict, indent: str = "  ") -> None:
    for k in sorted(d.keys()):
        v = d[k]
        if isinstance(v, dict):
            print(f"{indent}{k}:")
            _print_dict(v, indent + "    ")
        elif isinstance(v, list):
            print(f"{indent}{k}: [lista com {len(v)} item(ns)]")
            for item in v:
                if isinstance(item, dict):
                    _print_dict(item, indent + "    ")
                else:
                    print(f"{indent}    {item!r}")
        else:
            print(f"{indent}{k} = {v!r}")


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
        print("Buscando ListarContasPagar, status 'A VENCER' (pode levar um instante)...\n")
        registros = await tools_contas_pagar.listar_contas_pagar(
            client, filtros={"filtrar_por_status": "AVENCER"}
        )
        print(f"{len(registros)} título(s) em 'A VENCER'.\n")

        achado = next((r for r in registros if r.get("codigo_lancamento_omie") == CODIGO_ALVO), None)
        if achado is None:
            print(f"[!] Não achei codigo_lancamento_omie={CODIGO_ALVO} na lista.")
            return 0

        print(f"=== Registro cru de ListarContasPagar pro título {CODIGO_ALVO} ===\n")
        _print_dict(achado)

        tem_retencao = any(
            k in achado for k in
            ("valor_cofins", "valor_csll", "valor_inss", "valor_ir", "valor_iss", "valor_pis")
        )
        print(f"\n>>> Campos de retenção presentes em ListarContasPagar? {tem_retencao}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
