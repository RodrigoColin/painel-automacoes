"""
Achar o campo certo de "valor líquido" (valor a pagar/receber de verdade,
já descontando retenção de imposto, desconto e valor já pago/recebido)
pros títulos de Contas a Pagar/Receber do Omie.

Rodrigo confirmou em 2026-08-08: não é pra usar `valor_documento` (valor
bruto da NF) nas colunas "Valor da Conta"/"A Pagar"/"A Receber" — é pra
usar o campo de valor LÍQUIDO, que já desconta retenção de imposto,
desconto e o que já foi pago/recebido (parcial).

Achamos dois títulos reais em 2026-08-08 onde valor_documento diverge do
valor real do extrato bancário:
  - GABRIEL MOREIRA E GABRIELA COELHO ADVOCACIA (codigo_lancamento_omie=
    2386235757): valor_documento=1138.41, extrato mostrou 1068.40 (diff
    R$70,01 — categoria "Advogados", provável retenção de imposto).
  - WEON TELECOMUNICACOES LTDA (codigo_lancamento_omie=2521243109):
    valor_documento=2741.95, extrato mostrou 2735.81 (diff R$6,14).

Este script consulta esses DOIS títulos específicos de duas formas —
`ListarContasPagar` (lista, o que já usamos) e `ConsultarContaPagar`
(consulta individual, pode trazer mais detalhe) — e imprime TODAS as
chaves da resposta, pra achar o nome exato do campo de valor líquido.
Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_24.py --cliente oystr
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

TITULOS_ALVO = [
    ("GABRIEL MOREIRA E GABRIELA COELHO ADVOCACIA", 2386235757),
    ("WEON TELECOMUNICACOES LTDA", 2521243109),
]


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
        for nome, codigo in TITULOS_ALVO:
            print(f"{'=' * 70}")
            print(f"=== {nome} (codigo_lancamento_omie={codigo}) ===")
            print(f"{'=' * 70}")

            print("\n--- ConsultarContaPagar (consulta individual) ---")
            try:
                detalhe = await tools_contas_pagar.consultar_conta_pagar(client, codigo)
                _print_dict(detalhe)
            except Exception as exc:
                print(f"  [erro] {exc}")

            await asyncio.sleep(2)

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
