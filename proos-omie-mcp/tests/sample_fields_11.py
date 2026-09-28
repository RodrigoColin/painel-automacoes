"""
Validação do achado: financas/mf / ListarMovimentos parece unir título +
liquidação num só registro (campos "detalhes" + "resumo"), com nCodTitulo
como o próprio ID do título (sem precisar de doc fiscal pra cruzar) e
dDtPagamento como possível data de crédito/débito real.

Este script:
  1) Busca uma página com mais registros (nRegPorPagina=200) pra ver que
     variedade de cStatus aparece (EMABERTO? ATRASADO? só PAGO/CANCELADO?).
  2) Localiza (por busca binária, técnica já validada nos outros testes)
     a região de julho/2026 e verifica se o nCodTitulo/nValPago/dDtPagamento
     de títulos conhecidos (BRIGANTI RPS 2804, PROOS GESTAO doc 168) batem
     com o que já validamos via extrato (sample_fields_8.py).

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_11.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402

# Já confirmados via extrato (sample_fields_8.py): nCodTitulo -> (valor, data esperada)
CONHECIDOS = {
    2529292588: ("BRIGANTI RPS 2804", 1095.52, "01/07/2026"),
    2523938152: ("PROOS GESTAO doc 168", 2500.00, "01/07/2026"),
    2529292869: ("NANTES E MELLO RPS 2812", 2000.00, "01/07/2026"),
}


def parse_br_date(s):
    try:
        return datetime.strptime(s, "%d/%m/%Y")
    except Exception:
        return None


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
        print("=== 1) Página com 200 registros — variedade de cStatus ===")
        try:
            data = await client.call(
                "financas/mf", "ListarMovimentos",
                params={"nPagina": 1, "nRegPorPagina": 200},
            )
            print(f"nTotPaginas={data.get('nTotPaginas')} nTotRegistros={data.get('nTotRegistros')}")
            status_vistos = {}
            for m in data.get("movimentos", []):
                st = m["detalhes"].get("cStatus")
                status_vistos[st] = status_vistos.get(st, 0) + 1
            print("Status vistos nesta página:", status_vistos)
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")
            return 1

        print("\n=== 2) Busca binária pela região de julho/2026 (por dDtRegistro) ===")
        total_paginas_grande = None
        try:
            primeira = await client.call(
                "financas/mf", "ListarMovimentos",
                params={"nPagina": 1, "nRegPorPagina": 100},
            )
            total_paginas_grande = primeira.get("nTotPaginas")
        except OmieAPIError as exc:
            print(f"[erro] {exc}")
            return 1

        alvo = parse_br_date("01/07/2026")
        lo, hi = 1, total_paginas_grande
        pagina_alvo = 1
        while lo <= hi:
            mid = (lo + hi) // 2
            d = await client.call("financas/mf", "ListarMovimentos",
                                   params={"nPagina": mid, "nRegPorPagina": 100})
            movs = d.get("movimentos", [])
            if not movs:
                break
            dt = parse_br_date(movs[0]["detalhes"].get("dDtRegistro"))
            if dt is None:
                break
            if dt < alvo:
                pagina_alvo = mid + 1
                lo = mid + 1
            else:
                hi = mid - 1
        print(f"(região de 01/07/2026 ~ página {pagina_alvo} de {total_paginas_grande}, "
              f"100 registros/página)")

        encontrados = {}
        for p in range(max(1, pagina_alvo - 10), min(total_paginas_grande, pagina_alvo + 20) + 1):
            d = await client.call("financas/mf", "ListarMovimentos",
                                   params={"nPagina": p, "nRegPorPagina": 100})
            for m in d.get("movimentos", []):
                cod = m["detalhes"].get("nCodTitulo")
                if cod in CONHECIDOS:
                    encontrados[cod] = m

        print(f"\n({len(encontrados)}/{len(CONHECIDOS)} títulos conhecidos encontrados)")
        for cod, (nome, valor_esperado, data_esperada) in CONHECIDOS.items():
            m = encontrados.get(cod)
            if not m:
                print(f"  {nome} (nCodTitulo={cod}): NÃO ENCONTRADO na janela de páginas")
                continue
            det, res = m["detalhes"], m["resumo"]
            print(f"  {nome} (nCodTitulo={cod}):")
            print(f"    cStatus={det.get('cStatus')!r} cLiquidado={res.get('cLiquidado')!r} "
                  f"nValPago={res.get('nValPago')!r} (esperado ~{valor_esperado})")
            print(f"    dDtPagamento={det.get('dDtPagamento')!r} (esperado ~{data_esperada}) "
                  f"dDtVenc={det.get('dDtVenc')!r} dDtEmissao={det.get('dDtEmissao')!r}")
            print(f"    --- registro completo ---")
            print(json.dumps(m, indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
