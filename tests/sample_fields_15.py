"""
CONFIRMADO em sample_fields_13.py: financas/mf / ListarMovimentos aceita
nCodTitulo como filtro (sem erro de tag, retornou o registro certo). Isso
pode resolver de vez o cruzamento pros títulos MANP sem numero_documento_
fiscal — em vez de casar por chave composta com o extrato, consulta direto
por nCodTitulo=codigo_lancamento_omie do título.

Este script:
  1) Pra cada título "sem par" (5 a pagar + 5 a receber, já vistos numa
     rodada real do refresh), busca o próprio título via Consultar
     ContaPagar/ContaReceber (já validado, pra saber valor_documento e
     data_vencimento esperados).
  2) Consulta financas/mf/ListarMovimentos com filtrar por nCodTitulo=
     codigo_lancamento_omie do título.
  3) Compara nValPago/nValLiquido contra valor_documento, e imprime
     dDtPagamento — candidato a "Data de Crédito ou Débito" pros casos que
     hoje ficam sem par.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_15.py --cliente oystr
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

PAGAMENTOS_SEM_PAR = [2530113660, 2531080356, 2531087492, 2531093933, 2531152028]
RECEBIMENTOS_SEM_PAR = [2530621884, 2530622310, 2530622447, 2530623771, 2530623986]


async def checar(client, cod, consultar_titulo, rotulo):
    print(f"--- {rotulo} nCodTitulo={cod} ---")
    try:
        titulo = await consultar_titulo(client, cod)
        print(f"  título: valor_documento={titulo.get('valor_documento')!r} "
              f"data_vencimento={titulo.get('data_vencimento')!r} "
              f"status_titulo={titulo.get('status_titulo')!r} "
              f"numero_documento_fiscal={titulo.get('numero_documento_fiscal')!r}")
    except OmieAPIError as exc:
        print(f"  [erro consultando título] {exc}")
        titulo = None

    try:
        data = await client.call(
            "financas/mf", "ListarMovimentos",
            params={"nPagina": 1, "nRegPorPagina": 10, "nCodTitulo": cod},
        )
        movimentos = data.get("movimentos", [])
        print(f"  financas/mf: nTotRegistros={data.get('nTotRegistros')} "
              f"registros_retornados={len(movimentos)}")
        for m in movimentos:
            det, res = m.get("detalhes", {}), m.get("resumo", {})
            print(f"    dDtPagamento={det.get('dDtPagamento')!r} "
                  f"cLiquidado={res.get('cLiquidado')!r} "
                  f"nValPago={res.get('nValPago')!r} nValLiquido={res.get('nValLiquido')!r} "
                  f"cStatus={det.get('cStatus')!r}")
        if movimentos:
            print("  --- JSON bruto do primeiro registro ---")
            print(json.dumps(movimentos[0], indent=2, ensure_ascii=False))
    except OmieAPIError as exc:
        print(f"  [erro financas/mf] {exc} (fault_code={exc.fault_code})")
    print()


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
        print("=== Pagamentos sem par ===\n")
        for cod in PAGAMENTOS_SEM_PAR:
            await checar(client, cod, contas_pagar.consultar_conta_pagar, "PAGAR")

        print("=== Recebimentos sem par ===\n")
        for cod in RECEBIMENTOS_SEM_PAR:
            await checar(client, cod, contas_receber.consultar_conta_receber, "RECEBER")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
