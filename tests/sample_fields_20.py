"""
A rodada real do refresh mostrou 136/137 pagamentos conciliados (ótimo!) e
500/657 recebimentos — mas os mesmos 5 recebimentos "sem par" de antes
continuam aparecendo, mesmo já confirmados como status_titulo=CANCELADO
via ConsultarContaReceber (sample_fields_19.py).

Isso é estranho: eles vieram de uma busca com filtrar_por_status=
"LIQUIDADO" (buscar_titulos_liquidados_no_periodo) — se o filtro
funcionasse perfeito, um título CANCELADO nem deveria aparecer na
resposta. Este script confere:

  1) O próprio campo status_titulo dentro do registro retornado pela
     LISTAGEM filtrada (não a consulta individual) — pra ver se o Omie
     devolve um registro "inconsistente" (retornado sob o filtro
     LIQUIDADO, mas com status_titulo dizendo outra coisa).
  2) A distribuição de status_titulo em TODOS os registros retornados
     pela busca liquidados-no-período, pra ver se esse é um problema
     isolado ou mais espalhado (o que explicaria parte dos ~152
     recebimentos sem par que ainda não investigamos um por um).

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_20.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.reports import oystr_diagnostico as rel  # noqa: E402

RECEBIMENTOS_SEM_PAR_CONHECIDOS = [2530621884, 2530622310, 2530622447, 2530623771, 2530623986]


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
        print("Buscando títulos a receber liquidados no período (mesma busca do relatório)...")
        recebidos_raw = await rel.buscar_titulos_liquidados_no_periodo(
            client, "financas/contareceber", "ListarContasReceber", "LIQUIDADO",
            "conta_receber_cadastro", args.desde, args.ate,
        )
        print(f"{len(recebidos_raw)} registros retornados.\n")

        print("=== 1) status_titulo dos 5 casos já conhecidos, DENTRO da listagem ===")
        por_id = {r.get("codigo_lancamento_omie"): r for r in recebidos_raw}
        for cod in RECEBIMENTOS_SEM_PAR_CONHECIDOS:
            r = por_id.get(cod)
            if r is None:
                print(f"  {cod}: nem apareceu na listagem (estranho, o relatório disse que sim)")
            else:
                print(f"  {cod}: status_titulo={r.get('status_titulo')!r} "
                      f"data_emissao={r.get('data_emissao')!r}")

        print("\n=== 2) Distribuição de status_titulo em TODA a listagem 'liquidados' ===")
        distrib: dict[str, int] = {}
        for r in recebidos_raw:
            st = r.get("status_titulo", "(vazio)")
            distrib[st] = distrib.get(st, 0) + 1
        for st, n in sorted(distrib.items(), key=lambda kv: -kv[1]):
            print(f"  {st}: {n}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
