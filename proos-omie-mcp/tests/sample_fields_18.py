"""
sample_fields_17.py achou os 5 pagamentos sem par via ListarLancCC com
dtPagInicial/dtPagFinal, mas nenhum dos 5 recebimentos sem par apareceu —
mesmo alargando a janela pra 11/06 a 25/08 (quase 40 dias de folga). Isso
não parece ser janela de data — parece que o filtro dtPagInicial/dtPagFinal
("Pagto") só cobre natureza P (pagamentos), e ignora R (recebimentos).

Este script confirma a hipótese: verifica se ATÉ os casos de recebimento
JÁ CONHECIDOS como corretos (BRIGANTI RPS 2804 = título 2529292588,
NANTES E MELLO RPS 2812 = título 2529292869 — confirmados via
ConsultaLancCC em sample_fields_14.py, com dDtConc dentro do período)
aparecem na listagem filtrada por dtPagInicial/dtPagFinal.

  - Se SIM: o problema é outra coisa (não o filtro), precisa investigar
    os 5 recebimentos sem par especificamente.
  - Se NÃO: confirma que dtPagInicial/dtPagFinal filtra só natureza P, e
    os recebimentos sem par simplesmente não usam esse filtro pra achar
    os movimentos — precisamos de outro approach pra eles (ex.: sem
    filtro de data nenhum, só cNatureza=R, ou manter o cruzamento por
    ConsultaLancCC individual só pra esses casos residuais).

Também imprime a contagem de natureza (P vs R) vista na página 1, pra
confirmar diretamente se R aparece ou não na resposta filtrada.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_18.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402

# Casos de recebimento JÁ confirmados via ConsultaLancCC (sample_fields_14.py)
RECEBIMENTOS_CONHECIDOS = {
    2529292588: "BRIGANTI RPS 2804",
    2529292869: "NANTES E MELLO RPS 2812",
}

RECEBIMENTOS_SEM_PAR = [2530621884, 2530622310, 2530622447, 2530623771, 2530623986]


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cliente", default=None)
    parser.add_argument("--desde", default="11/06/2026")
    parser.add_argument("--ate", default="25/08/2026")
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
        print("=== 1) Contagem de natureza (P vs R) na página 1 filtrada ===")
        try:
            data = await client.call(
                "financas/contacorrentelancamentos", "ListarLancCC",
                params={
                    "nPagina": 1, "nRegPorPagina": 200, "cOrdemDecrescente": "N",
                    "dtPagInicial": args.desde, "dtPagFinal": args.ate,
                },
            )
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")
            return 1

        naturezas: dict[str, int] = {}
        for lc in data.get("listaLancamentos", []):
            nat = lc.get("diversos", {}).get("cNatureza", "?")
            naturezas[nat] = naturezas.get(nat, 0) + 1
        print(f"nTotRegistros={data.get('nTotRegistros')} nTotPaginas={data.get('nTotPaginas')}")
        print(f"Natureza vista na página 1: {naturezas}\n")

        total_paginas = data.get("nTotPaginas", 1)
        print(f"=== 2) Varrendo {total_paginas} página(s), procurando os recebimentos "
              f"conhecidos + sem par ===")
        indice: dict[int, dict] = {}
        contagem_natureza_total: dict[str, int] = {}
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
                nat = div.get("cNatureza", "?")
                contagem_natureza_total[nat] = contagem_natureza_total.get(nat, 0) + 1
                cod_titulo = div.get("nCodLancCR") or div.get("nCodLancCP")
                if cod_titulo:
                    indice[cod_titulo] = lc
            total_paginas = d.get("nTotPaginas", total_paginas)
            pagina += 1

        print(f"Natureza no total varrido: {contagem_natureza_total}\n")

        print("=== 3) Recebimentos JÁ CONHECIDOS (devem aparecer) ===")
        for cod, rotulo in RECEBIMENTOS_CONHECIDOS.items():
            lc = indice.get(cod)
            if lc:
                print(f"  {rotulo} ({cod}): ACHOU! dDtConc={lc['diversos'].get('dDtConc')!r}")
            else:
                print(f"  {rotulo} ({cod}): NÃO achou (confirma que R não entra nesse filtro)")

        print("\n=== 4) Recebimentos sem par ===")
        for cod in RECEBIMENTOS_SEM_PAR:
            lc = indice.get(cod)
            if lc:
                print(f"  {cod}: ACHOU! dDtConc={lc['diversos'].get('dDtConc')!r}")
            else:
                print(f"  {cod}: não achou")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
