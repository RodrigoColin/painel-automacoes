"""
ACHADO em sample_fields_14.py: ConsultaLancCC devolve, no bloco "diversos",
o elo direto pro título original:

    diversos.dDtConc     -> Data de Conciliação (o campo que o Rodrigo viu
                             na doc oficial de financas/mf, mas que na
                             verdade mora em financas/contacorrentelancamentos)
    diversos.nCodLancCR  -> codigo_lancamento_omie do título de CONTA A
                             RECEBER (quando cNatureza="R")
    diversos.nCodLancCP  -> idem pra CONTA A PAGAR (quando cNatureza="P")

Isso bateu exato com os 2 casos já conhecidos (BRIGANTI RPS 2804 =
2529292588, PROOS GESTAO = 2523938152).

Este script testa se dá pra pular a chamada extra ao ConsultaLancCC: o
ListarExtrato (que já buscamos em massa pra todas as contas) tem um campo
nCodLancRelac nunca testado antes — se ele for igual ao nCodLancCR/
nCodLancCP, o cruzamento título<->movimento fica trivial (chave única,
sem precisar de numero_documento_fiscal), direto dos dados que já baixamos.

Passos:
  1) Busca o extrato de todas as contas no período, indexa por
     nCodLancRelac.
  2) Confere os 4 casos já conhecidos (BRIGANTI, PROOS GESTAO, NANTES,
     +1 caso de transferência) batendo nCodLancRelac contra o
     nCodLancCR/nCodLancCP visto via ConsultaLancCC.
  3) O TESTE DE VERDADE: confere se os 10 títulos "sem par" (5 pagar + 5
     receber, que hoje falham no cruzamento por chave composta) aparecem
     no índice por nCodLancRelac. Se aparecerem, o gap dos MANP está
     resolvido.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_16.py --cliente oystr
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
from omie_mcp.reports import oystr_diagnostico as rel  # noqa: E402

# Já confirmados via ConsultaLancCC (sample_fields_14.py): nCodLancamento do
# extrato -> nCodLancCR/nCodLancCP esperado.
CASOS_CONHECIDOS = {
    2530065632: ("BRIGANTI RPS 2804 (Conta Recebida)", 2529292588),
    2530086902: ("PROOS GESTAO PIX (Conta Paga)", 2523938152),
    2530086925: ("Transferência PIX BPO (Conta Paga)", 2386233017),
    2530571873: ("NANTES E MELLO RPS 2812 (Conta Recebida)", 2529292869),
}

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
        print("Carregando contas correntes...")
        lookups = await rel.carregar_lookups(client)
        contas = list(lookups.contas_correntes.keys())
        print(f"{len(contas)} conta(s). Buscando extrato de {args.desde} a {args.ate}...\n")

        movimentos = await rel.buscar_extrato_periodo(client, contas, args.desde, args.ate)
        print(f"{len(movimentos)} movimentos no extrato.\n")

        # Índice por nCodLancRelac (a nova hipótese) e, pra comparação, o
        # índice antigo por chave composta.
        indice_relac: dict[int, dict] = {}
        sem_relac = 0
        for m in movimentos:
            relac = m.get("nCodLancRelac")
            if relac:
                indice_relac[relac] = m
            else:
                sem_relac += 1

        print(f"Movimentos com nCodLancRelac preenchido: {len(indice_relac)} "
              f"(sem preencher: {sem_relac})\n")

        print("=== 1) Casos já conhecidos (nCodLancamento -> nCodLancRelac esperado) ===")
        for n_cod_lanc, (rotulo, esperado) in CASOS_CONHECIDOS.items():
            mov = next((m for m in movimentos if m.get("nCodLancamento") == n_cod_lanc), None)
            if mov is None:
                print(f"  {rotulo}: movimento {n_cod_lanc} não encontrado no extrato buscado")
                continue
            relac = mov.get("nCodLancRelac")
            bate = "OK" if relac == esperado else "DIVERGENTE"
            print(f"  {rotulo}: nCodLancRelac={relac!r} esperado={esperado!r} [{bate}]")
            print(f"    dDataConciliacao={mov.get('dDataConciliacao')!r} "
                  f"dDataLancamento={mov.get('dDataLancamento')!r}")

        print("\n=== 2) TESTE DE VERDADE: títulos sem par via nCodLancRelac ===")
        print("--- Pagamentos sem par ---")
        for cod in PAGAMENTOS_SEM_PAR:
            mov = indice_relac.get(cod)
            if mov:
                print(f"  {cod}: ACHOU! dDataConciliacao={mov.get('dDataConciliacao')!r} "
                      f"nValorDocumento={mov.get('nValorDocumento')!r} "
                      f"cDocumentoFiscal={mov.get('cDocumentoFiscal')!r}")
            else:
                print(f"  {cod}: não achou no índice por nCodLancRelac")

        print("--- Recebimentos sem par ---")
        for cod in RECEBIMENTOS_SEM_PAR:
            mov = indice_relac.get(cod)
            if mov:
                print(f"  {cod}: ACHOU! dDataConciliacao={mov.get('dDataConciliacao')!r} "
                      f"nValorDocumento={mov.get('nValorDocumento')!r} "
                      f"cDocumentoFiscal={mov.get('cDocumentoFiscal')!r}")
            else:
                print(f"  {cod}: não achou no índice por nCodLancRelac")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
