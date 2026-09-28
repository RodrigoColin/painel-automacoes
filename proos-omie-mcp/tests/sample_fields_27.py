"""
Segunda exploração de `servicos/contrato` (ListarContratos) — depois do
sample_fields_26.py confirmar os campos-chave:

  cabecalho.nCodCli    -> código do cliente (resolvido pra nome via Lookups)
  cabecalho.nValTotMes -> valor total mensal do contrato (a "mensalidade")
  cabecalho.cCodSit    -> status do contrato ('10' parece ativo, '99' parece
                          encerrado/cancelado — não confirmado oficialmente)
  cabecalho.dVigFinal  -> data final de vigência do contrato
  vencTextos.nDiaFixo  -> dia fixo do mês em que a cobrança vence
  vencTextos.cAntecipar/cPostergar -> parecem controlar o que acontece
                          quando nDiaFixo cai em fim de semana (antecipar
                          pro dia útil anterior / postergar pro seguinte)

Objetivo: dump COMPLETO e compacto (uma linha por contrato) de todos esses
campos pra TODOS os contratos retornados, pra eu conseguir simular a
projeção de recorrência (qual dia de agosto cada contrato deveria cair,
ajustando fim de semana) e comparar contra o relatório nativo "Fluxo de
Caixa por Categoria Diário" que você já me mandou — sem precisar de mais
uma rodada de ida e volta.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_27.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.reports.oystr_diagnostico import carregar_lookups  # noqa: E402
from omie_mcp.tools import servicos as tools_servicos  # noqa: E402


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
        print("Carregando lookups (clientes/fornecedores)...")
        lookups = await carregar_lookups(client)

        print("Buscando ListarContratos (todas as páginas)...\n")
        contratos = await tools_servicos.listar_contratos_servico(client)
        print(f"{len(contratos)} contrato(s) no total.\n")

        print("=== DUMP (uma linha por contrato) ===")
        print(
            "nCodCtr | nCodCli | nome_cliente | cCodSit | dVigFinal | "
            "nValTotMes | nDiaFixo | nDias | cAntecipar | cPostergar | "
            "cCodPerRef | cTpVenc | cProxMes"
        )
        for c in contratos:
            cab = c.get("cabecalho", {}) or {}
            venc = c.get("vencTextos", {}) or {}
            n_cod_cli = cab.get("nCodCli")
            nome = lookups.nome_cliente(n_cod_cli)
            print(
                f"{cab.get('nCodCtr')} | {n_cod_cli} | {nome} | "
                f"{cab.get('cCodSit')} | {cab.get('dVigFinal')} | "
                f"{cab.get('nValTotMes')} | {venc.get('nDiaFixo')} | "
                f"{venc.get('nDias')} | {venc.get('cAntecipar')} | "
                f"{venc.get('cPostergar')} | {venc.get('cCodPerRef')} | "
                f"{venc.get('cTpVenc')} | {venc.get('cProxMes')}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
