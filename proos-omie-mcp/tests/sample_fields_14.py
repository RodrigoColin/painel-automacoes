"""
Uma pesquisa sobre outros MCPs open source de Omie (lucassampsouza/omie-mcp e
@codespar/mcp-omie) trouxe dois nomes de call que nunca tínhamos tentado
certo:

  - financas/contacorrentelancamentos / ConsultaLancCC (param nCodLanc) —
    consulta um lançamento bancário específico. Se isso aceitar o
    nCodLancamento que já vemos no extrato (ListarExtrato) e devolver um
    campo que aponte de volta pro título original (ex.: nCodTitulo,
    nCodBaixa), RESOLVE o cruzamento pra qualquer título — inclusive os
    MANP sem numero_documento_fiscal, sem precisar da chave composta.
    (Tentativas anteriores em sample_fields_9.py usaram nomes de call
    errados — "ConsultarLancamento" etc — por isso deram HTTP 500.)

  - financas/mf / ListarMovimentos com filtro dDtPagtoDe/dDtPagtoAte — nunca
    tentamos esse par de nomes (só dDtRegistroDe/dPeriodoInicial, que não
    funcionaram). Se filtrar de verdade por data de pagamento, dá pra achar
    os títulos MANP sem precisar de busca binária.

Ambos os achados vêm de pesquisa em código de terceiros, NÃO da doc oficial
(que não consigo abrir daqui, robots.txt bloqueia o domínio) — por isso
testamos contra a API real antes de confiar, mesma prática já usada nos
testes anteriores desta pasta.

Não escreve nada no Omie (ConsultaLancCC/ListarLancCC/ListarMovimentos são
todas leitura).

Uso:
    python tests\\sample_fields_14.py --cliente oystr
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

# nCodLancamento vistos no extrato real da Oystr (sample_fields_2.py/9.py).
CODIGOS_EXTRATO = [2530065632, 2530086902, 2530086925, 2530571873]


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
        print("=== 1) financas/contacorrentelancamentos / ConsultaLancCC (nCodLanc) ===")
        for cod in CODIGOS_EXTRATO:
            print(f"--- nCodLanc={cod} ---")
            try:
                data = await client.call(
                    "financas/contacorrentelancamentos", "ConsultaLancCC",
                    params={"nCodLanc": cod},
                )
                print("[OK]")
                print(json.dumps(data, indent=2, ensure_ascii=False))
            except OmieAPIError as exc:
                print(f"[erro] {exc} (fault_code={exc.fault_code})")
            except Exception as exc:  # noqa: BLE001
                print(f"[erro inesperado] {type(exc).__name__}: {exc}")
            print()

        print("=== 2) financas/contacorrentelancamentos / ListarLancCC ===")
        try:
            data = await client.call(
                "financas/contacorrentelancamentos", "ListarLancCC",
                params={"nPagina": 1, "nRegPorPagina": 3, "cOrdemDecrescente": "N"},
            )
            print("[OK]")
            print(json.dumps(data, indent=2, ensure_ascii=False)[:3000])
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")
        except Exception as exc:  # noqa: BLE001
            print(f"[erro inesperado] {type(exc).__name__}: {exc}")
        print()

        print("=== 3) financas/mf / ListarMovimentos com dDtPagtoDe/dDtPagtoAte ===")
        try:
            data = await client.call(
                "financas/mf", "ListarMovimentos",
                params={
                    "nPagina": 1, "nRegPorPagina": 5,
                    "dDtPagtoDe": "01/07/2026", "dDtPagtoAte": "05/08/2026",
                },
            )
            print(f"[OK] nTotRegistros={data.get('nTotRegistros')} "
                  f"nTotPaginas={data.get('nTotPaginas')}")
            for m in data.get("movimentos", [])[:3]:
                print(f"  nCodTitulo={m['detalhes'].get('nCodTitulo')} "
                      f"dDtPagamento={m['detalhes'].get('dDtPagamento')} "
                      f"dDtEmissao={m['detalhes'].get('dDtEmissao')}")
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")
        except Exception as exc:  # noqa: BLE001
            print(f"[erro inesperado] {type(exc).__name__}: {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
