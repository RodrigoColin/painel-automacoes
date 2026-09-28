"""
Diagnóstico pontual: dump de TODOS os `cOrigem` do extrato bancário
(`financas/extrato` `ListarExtrato`) num período — incluindo os que hoje
`tools/extrato.py::previsao_titulos_por_extrato()` filtra e descarta de
propósito ("Previsão de Pedido de Compra/Venda", que não tem
`nCodLancamento` de título pra cruzar de volta).

Criado em 2026-08-13: esse endpoint já é usado com sucesso em produção
(`ListarExtrato`, testado e funcionando — diferente de `ListarOS`/
`ListarMovimentos`, que ainda não confirmamos). A hipótese é que os
`cOrigem` de PREVISÃO (não só "Conta a Receber"/"Conta a Pagar", mas
também qualquer variante ligada a Contrato de Serviço ou OS) podem ser
exatamente a fonte que o relatório nativo do Omie usa pra "3.1. Receitas
Previstas" — o que resolveria de uma vez a projeção de contrato
recorrente E de OS avulsa, sem precisar reconstruir a lógica de
`nDiaFixo`/`cNumeroContrato` que já causou 6 bugs reais diferentes.

Uso:
    python scripts\\debug_extrato_previsoes.py --cliente oystr
    python scripts\\debug_extrato_previsoes.py --cliente oystr --busca "PEREIRA GIONEDIS"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesRegistry  # noqa: E402
from omie_mcp.tools import contas_correntes as tools_contas_correntes  # noqa: E402
from omie_mcp.tools import extrato as tools_extrato  # noqa: E402
from omie_mcp.reports.oystr_diagnostico import _EXCLUIR_CONTAS_NAO_CAIXA  # noqa: E402


def _json(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cliente", required=True, help="slug do cliente Proos (ex.: oystr)")
    ap.add_argument("--busca", default=None,
                     help="opcional: trecho do nome do cliente/fornecedor (cDesCliente) pra "
                          "filtrar os movimentos mostrados")
    ap.add_argument("--desde", default="01/08/2026", help="dd/mm/aaaa")
    ap.add_argument("--ate", default="30/09/2026", help="dd/mm/aaaa")
    args = ap.parse_args()

    registry = ClientesRegistry.load()
    settings = registry.settings_for(args.cliente)
    client = OmieClient(settings)

    print("Buscando contas correntes válidas (fluxo de caixa)...", flush=True)
    contas = await tools_contas_correntes.contas_fluxo_de_caixa(
        client, excluir=_EXCLUIR_CONTAS_NAO_CAIXA
    )
    contas = sorted(contas)
    print(f"{len(contas)} conta(s): {contas}\n")

    todos_origens = Counter()
    achados_busca = []

    for i, n_cod_cc in enumerate(contas):
        if i > 0:
            await asyncio.sleep(1.5)
        print(f"Consultando extrato da conta {n_cod_cc} ({args.desde} a {args.ate})...", flush=True)
        movimentos = await tools_extrato.consultar_extrato(client, n_cod_cc, args.desde, args.ate)
        print(f"  {len(movimentos)} movimento(s) nessa conta/período.")
        for mov in movimentos:
            origem = mov.get("cOrigem")
            todos_origens[origem] += 1
            if args.busca:
                nome = str(mov.get("cDesCliente", "")).upper()
                if args.busca.strip().upper() in nome:
                    achados_busca.append(mov)

    print("\n" + "=" * 70)
    print("TODOS os cOrigem encontrados (contagem):")
    for origem, qtd in todos_origens.most_common():
        print(f"  {qtd:5d}  {origem!r}")

    if args.busca:
        print("\n" + "=" * 70)
        print(f"{len(achados_busca)} movimento(s) mencionando '{args.busca}':")
        for mov in achados_busca:
            print("-" * 70)
            print(_json(mov))
    else:
        # sem busca: mostra um exemplo de cada cOrigem visto, pra ver os campos
        print("\n" + "=" * 70)
        print("Um exemplo de cada cOrigem visto (dump completo):")
        vistos = set()
        for i, n_cod_cc in enumerate(contas):
            movimentos = await tools_extrato.consultar_extrato(client, n_cod_cc, args.desde, args.ate)
            for mov in movimentos:
                origem = mov.get("cOrigem")
                if origem not in vistos:
                    vistos.add(origem)
                    print("-" * 70)
                    print(f"cOrigem = {origem!r}")
                    print(_json(mov))

    print("\n" + "=" * 70)
    print("Copie e cole ESSE terminal inteiro de volta.")


if __name__ == "__main__":
    asyncio.run(main())
