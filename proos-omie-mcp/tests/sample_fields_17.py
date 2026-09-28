"""
nCodLancRelac (testado em sample_fields_16.py) NÃO é o elo pro título — é
autorreferência (igual ao próprio nCodLancamento). Descartado.

Mas ListarLancCC (financas/contacorrentelancamentos) já mostrou ter, pra
cada lançamento, os mesmos campos que ConsultaLancCC: diversos.dDtConc
(data de conciliação) e diversos.nCodLancCR/nCodLancCP (ID do título). Se
der pra filtrar ListarLancCC por data de pagamento, dá pra buscar TUDO em
uma varredura paginada só, com o elo pro título já embutido — sem precisar
de uma chamada ConsultaLancCC por movimento, e sem depender de
numero_documento_fiscal.

Este script:
  1) Testa se dtPagInicial/dtPagFinal filtram de verdade ListarLancCC (a
     varredura sem filtro trouxe registros de 2022, então sem filtro não
     dá pra usar direto).
  2) Se filtrar, pagina por TODO o período pedido (sem passar nCodCC, pra
     ver se cobre todas as contas de uma vez) e monta um índice por
     nCodLancCR/nCodLancCP.
  3) Confere os 10 títulos "sem par" contra esse índice.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_17.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402

PAGAMENTOS_SEM_PAR = [2530113660, 2531080356, 2531087492, 2531093933, 2531152028]
RECEBIMENTOS_SEM_PAR = [2530621884, 2530622310, 2530622447, 2530623771, 2530623986]


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cliente", default=None)
    parser.add_argument("--desde", default="01/07/2026")
    parser.add_argument("--ate", default="05/08/2026")
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
        print("=== 1) ListarLancCC com dtPagInicial/dtPagFinal ===")
        try:
            data = await client.call(
                "financas/contacorrentelancamentos", "ListarLancCC",
                params={
                    "nPagina": 1, "nRegPorPagina": 20, "cOrdemDecrescente": "N",
                    "dtPagInicial": args.desde, "dtPagFinal": args.ate,
                },
            )
            print(f"[OK] nTotRegistros={data.get('nTotRegistros')} "
                  f"nTotPaginas={data.get('nTotPaginas')}")
            amostra = data.get("listaLancamentos", [])[:3]
            for lc in amostra:
                print(f"  dDtLanc={lc['cabecalho'].get('dDtLanc')!r} "
                      f"dDtConc={lc['diversos'].get('dDtConc')!r} "
                      f"nCodCC={lc['cabecalho'].get('nCodCC')!r}")
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")
            print("\n(dtPagInicial/dtPagFinal não funcionou — parando aqui.)")
            return 0
        print()

        total_paginas = data.get("nTotPaginas", 1)
        print(f"=== 2) Varrendo {total_paginas} página(s) de 200 registros ===")
        indice: dict[int, dict] = {}
        pagina = 1
        while pagina <= total_paginas:
            d = await client.call(
                "financas/contacorrentelancamentos", "ListarLancCC",
                params={
                    "nPagina": pagina, "nRegPorPagina": 200, "cOrdemDecrescente": "N",
                    "dtPagInicial": args.desde, "dtPagFinal": args.ate,
                },
            )
            for lc in d.get("listaLancamentos", []):
                div = lc.get("diversos", {})
                cod_titulo = div.get("nCodLancCR") or div.get("nCodLancCP")
                if cod_titulo:
                    indice[cod_titulo] = lc
            if pagina % 10 == 0 or pagina == total_paginas:
                print(f"  ...pagina {pagina}/{total_paginas}, {len(indice)} títulos indexados")
            pagina += 1
            total_paginas = d.get("nTotPaginas", total_paginas)

        print(f"\n{len(indice)} títulos únicos indexados por nCodLancCR/nCodLancCP.\n")

        print("=== 3) TESTE DE VERDADE: títulos sem par ===")
        print("--- Pagamentos sem par ---")
        for cod in PAGAMENTOS_SEM_PAR:
            lc = indice.get(cod)
            if lc:
                print(f"  {cod}: ACHOU! dDtConc={lc['diversos'].get('dDtConc')!r} "
                      f"nValorLanc={lc['cabecalho'].get('nValorLanc')!r}")
            else:
                print(f"  {cod}: não achou")
        print("--- Recebimentos sem par ---")
        for cod in RECEBIMENTOS_SEM_PAR:
            lc = indice.get(cod)
            if lc:
                print(f"  {cod}: ACHOU! dDtConc={lc['diversos'].get('dDtConc')!r} "
                      f"nValorLanc={lc['cabecalho'].get('nValorLanc')!r}")
            else:
                print(f"  {cod}: não achou")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
