"""
Diagnóstico do resíduo de R$76,15 achado pelo Rodrigo em 2026-08-08 comparando
"Fluxo Diario Ago-2026" (dia 21, G nosso R$8.829,19 vs. referência R$8.905,34)
contra FluxoCaixa_Oystr.xlsx.

Já lemos o código-fonte de fluxo_caixa.py (proos-automacoes/oystr/) e achamos
a causa provável: ele NÃO usa o campo `data_previsao` do título de Contas a
Pagar/Receber (que é o que `oystr_diagnostico.py` usa hoje) — ele usa
`financas/extrato/ListarExtrato`, e pega a data de `dDataLancamento` do
próprio movimento do extrato bancário, filtrando por `cOrigem` em
{"Conta a Receber", "Conta a Pagar", "Previsão de Pedido de Compra",
"Previsão de Pedido de Venda"}. Essas duas fontes (campo do título vs.
extrato bancário) podem ter datas ligeiramente diferentes pro MESMO título —
é isso que provavelmente está causando o resíduo.

Este script busca as DUAS fontes lado a lado pros dias 10/08 e 20/08/2026
(os dois dias onde achamos diferença: R$70,01 e R$6,14) e imprime tudo, pra
identificarmos o(s) título(s) exato(s) que diverge(m) — sem escrever nada
no Omie.

Uso:
    python tests\\sample_fields_23.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.reports.oystr_diagnostico import (  # noqa: E402
    _EXCLUIR_CONTAS_NAO_CAIXA,
    buscar_titulos_abertos,
)
from omie_mcp.tools import contas_correntes as tools_contas_correntes  # noqa: E402
from omie_mcp.tools import extrato as tools_extrato  # noqa: E402

DIAS_A_CONFERIR = ["10/08/2026", "20/08/2026"]
ORIGENS_PREVISTAS = {
    "Conta a Receber", "Conta a Pagar",
    "Previsão de Pedido de Compra", "Previsão de Pedido de Venda",
}


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
        print("=== 1) Contas correntes válidas pro fluxo de caixa ===")
        contas_validas = await tools_contas_correntes.contas_fluxo_de_caixa(
            client, excluir=_EXCLUIR_CONTAS_NAO_CAIXA
        )
        contas = await tools_contas_correntes.listar_contas_correntes(client)
        contas_para_buscar = [c for c in contas if c["nCodCC"] in contas_validas]
        print(f"{len(contas_para_buscar)} conta(s): "
              f"{[(c['nCodCC'], c.get('descricao')) for c in contas_para_buscar]}\n")

        print("=== 2) ListarExtrato — movimentos PREVISTOS de saída (P) nos dias-alvo ===")
        print("    (fonte que o fluxo_caixa.py de referência usa)\n")
        extrato_por_dia: dict[str, list[dict]] = {d: [] for d in DIAS_A_CONFERIR}
        for conta in contas_para_buscar:
            movs = await tools_extrato.consultar_extrato(
                client, conta["nCodCC"], "05/08/2026", "25/08/2026"
            )
            for m in movs:
                if m.get("cDesCliente") == "SALDO ANTERIOR":
                    continue
                if m.get("dDataLancamento") not in DIAS_A_CONFERIR:
                    continue
                if m.get("cOrigem") not in ORIGENS_PREVISTAS:
                    continue
                if m.get("cNatureza") != "P":
                    continue
                extrato_por_dia[m["dDataLancamento"]].append(m)

        for dia in DIAS_A_CONFERIR:
            itens = extrato_por_dia[dia]
            total = sum(abs(m.get("nValorDocumento", 0)) for m in itens)
            print(f"--- {dia}: {len(itens)} movimento(s) no extrato, TOTAL = R$ {total:,.2f} ---")
            for m in sorted(itens, key=lambda x: -abs(x.get("nValorDocumento", 0))):
                print(f"  cDesCliente={m.get('cDesCliente')!r:50} "
                      f"nValorDocumento={m.get('nValorDocumento')!r:>12} "
                      f"cNumero={m.get('cNumero')!r} cOrigem={m.get('cOrigem')!r} "
                      f"cSituacao={m.get('cSituacao')!r}")
                # imprime TODAS as chaves cruas desse movimento, pra achar
                # se existe algum campo de ID de título escondido
                extras = {k: v for k, v in m.items()
                          if k not in ("cDesCliente", "nValorDocumento", "cNumero",
                                       "cOrigem", "cSituacao", "dDataLancamento", "cNatureza")}
                if extras:
                    print(f"      (outros campos: {extras})")
            print()

        print("=== 3) ListarContasPagar em aberto — mesmos dias, pelo campo data_previsao ===")
        print("    (fonte que oystr_diagnostico.py usa hoje)\n")
        titulos = await buscar_titulos_abertos(
            client, "financas/contapagar", "ListarContasPagar",
            records_key=["conta_pagar_cadastro", "cadastros"],
        )
        for dia in DIAS_A_CONFERIR:
            achados = [t for t in titulos if t.get("data_previsao") == dia
                       or (not t.get("data_previsao") and t.get("data_vencimento") == dia)]
            total = sum(t.get("valor_documento", 0) for t in achados)
            print(f"--- {dia}: {len(achados)} título(s) em aberto, TOTAL = R$ {total:,.2f} ---")
            for t in sorted(achados, key=lambda x: -x.get("valor_documento", 0)):
                print(f"  codigo_cliente_fornecedor={t.get('codigo_cliente_fornecedor')!r:12} "
                      f"valor={t.get('valor_documento')!r:>10} "
                      f"venc={t.get('data_vencimento')!r} prev={t.get('data_previsao')!r} "
                      f"doc={t.get('numero_documento_fiscal') or t.get('numero_documento')!r} "
                      f"codigo_lancamento_omie={t.get('codigo_lancamento_omie')!r}")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
