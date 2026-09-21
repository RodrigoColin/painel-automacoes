"""
Diagnóstico pontual: por que um cliente específico não aparece em
"Base - Contratos Nao Faturados", mesmo sem título em aberto? / por que
um contrato está sendo projetado com periodicidade errada? / por que um
título real não está sendo reconhecido como "já cobre" o contrato?

Criado em 2026-08-12 pra investigar o caso "M S ASESSORIA JURIDICAS"
(contrato sumia da projeção por causa do corte de vigência por dia) e
"LEAO ALIMENTOS E BEBIDAS" (contrato ANUAL sendo projetado como se
fosse mensal). Estendido em 2026-08-12 (mesmo dia) pra investigar 3
casos novos achados comparando contra o pivot fresco do Omie:
  - "CAIQUE CASTRO" / "FRANCISCO ALVES": contrato com valor nominal
    (nValTotMes) MUITO diferente do valor real faturado no mês (ex.:
    contrato de R$3.600, mas título real de agosto de só R$600) —
    RPA/Presto Recorrente com valor variável. Nosso cruzamento
    título<->contrato é por VALOR (com tolerância de 5 centavos agora,
    ver `montar_contratos_recorrentes_nao_faturados`), então nesses
    casos o contrato continua sendo (indevidamente) projetado como
    "ainda não faturado" mesmo já tendo sido faturado no mês.
  - "NANTES E MELLO": cliente com receita recorrente mensal
    (~R$2.000/mês, categoria "Presto Recorrente") mas que NÃO aparece
    em NENHUM mês em "Base - Contratos Nao Faturados" — nem título
    aberto nem contrato projetado, mesmo o relatório nativo do Omie
    esperando R$2.000 desse cliente em 25/08.

Este script dump TUDO que a API do Omie devolve pra um cliente —
contrato completo (`ListarContratos`) E títulos crus (`ListarContas
Receber`, aberto E liquidado no ano corrente) — pra tentar achar um
campo de vínculo direto título<->contrato (algo tipo nCodCtr dentro do
título) que permita um cruzamento mais confiável do que "bate o valor".

Uso:
    python scripts\\debug_contrato_cliente.py --cliente oystr --busca "ASESSORIA"
    python scripts\\debug_contrato_cliente.py --cliente oystr --busca "CAIQUE CASTRO"
    python scripts\\debug_contrato_cliente.py --cliente oystr --busca "FRANCISCO ALVES"
    python scripts\\debug_contrato_cliente.py --cliente oystr --busca "NANTES"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient  # noqa: E402
from omie_mcp.clients import ClientesRegistry  # noqa: E402
from omie_mcp.tools import clientes as tools_clientes  # noqa: E402
from omie_mcp.tools import servicos as tools_servicos  # noqa: E402


def _json(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cliente", required=True, help="slug do cliente Proos (ex.: oystr)")
    ap.add_argument("--busca", required=True, help="trecho do nome (razão social ou fantasia) a procurar")
    args = ap.parse_args()

    registry = ClientesRegistry.load()
    settings = registry.settings_for(args.cliente)
    client = OmieClient(settings)

    print(f"Buscando clientes cujo nome contenha '{args.busca}'...", flush=True)
    todos_clientes = await tools_clientes.listar_clientes(client)
    alvo = args.busca.strip().upper()
    encontrados = [
        c for c in todos_clientes
        if alvo in str(c.get("razao_social", "")).upper()
        or alvo in str(c.get("nome_fantasia", "")).upper()
    ]

    if not encontrados:
        print(f"NENHUM cliente encontrado com '{args.busca}' no nome. "
              f"({len(todos_clientes)} clientes no total consultados.)")
        return

    print(f"{len(encontrados)} cliente(s) encontrado(s):\n")
    codigos_alvo = set()
    for c in encontrados:
        cod = c.get("codigo_cliente_omie")
        codigos_alvo.add(cod)
        print("=" * 70)
        print(f"Código Omie: {cod}")
        print(f"Razão Social: {c.get('razao_social')}")
        print(f"Nome Fantasia: {c.get('nome_fantasia')}")
        print(f"CNPJ/CPF: {c.get('cnpj_cpf')}")
        print("Dump completo do cadastro do cliente:")
        print(_json(c))

    # -----------------------------------------------------------------
    # 1) CONTRATOS do cliente (igual antes)
    # -----------------------------------------------------------------
    print("\nBuscando TODOS os contratos de serviço (ListarContratos)...", flush=True)
    contratos = await tools_servicos.listar_contratos_servico(client)
    print(f"{len(contratos)} contrato(s) no total.\n", flush=True)

    contratos_do_cliente = [
        ct for ct in contratos
        if (ct.get("cabecalho", {}) or {}).get("nCodCli") in codigos_alvo
    ]

    if not contratos_do_cliente:
        print("NENHUM contrato de serviço encontrado pra esse(s) cliente(s) em ListarContratos "
              "(cliente pode estar sendo faturado sem um objeto 'contrato' formal no Omie).")
    else:
        print(f"{len(contratos_do_cliente)} contrato(s) desse(s) cliente(s) — DUMP COMPLETO:\n")
        for ct in contratos_do_cliente:
            cab = ct.get("cabecalho", {}) or {}
            print("-" * 70)
            print(f"nCodCtr: {cab.get('nCodCtr')}  |  cCodSit: {cab.get('cCodSit')}  |  "
                  f"cTipoFat: {cab.get('cTipoFat')}  |  nValTotMes: {cab.get('nValTotMes')}")
            print(f"dVigInicial: {cab.get('dVigInicial')}  |  dVigFinal: {cab.get('dVigFinal')}")
            print("Chaves de topo do registro:", list(ct.keys()))
            print(_json(ct))

    # -----------------------------------------------------------------
    # 2) TÍTULOS crus do cliente — em aberto E liquidados no ano corrente
    #    (dump completo, todos os campos, pra procurar um vínculo direto
    #    com o contrato que não seja "bate o valor").
    # -----------------------------------------------------------------
    print("\nBuscando títulos EM ABERTO (Contas a Receber, todos os status)...", flush=True)
    _STATUS_ABERTO = ["EMABERTO", "ATRASADO", "AVENCER", "VENCEHOJE", "PAGTO_PARCIAL"]
    titulos_abertos: dict[int, dict] = {}
    for status in _STATUS_ABERTO:
        try:
            registros = await client.call_paginated(
                "financas/contareceber", "ListarContasReceber",
                params={"filtrar_por_status": status},
                records_key=["conta_receber_cadastro", "cadastros"],
            )
        except OmieAPIError as exc:
            if "não foram encontrados" in str(exc).lower():
                continue
            raise
        for r in registros:
            if r.get("codigo_cliente_fornecedor") in codigos_alvo:
                cod = r.get("codigo_lancamento_omie")
                titulos_abertos[cod] = r

    print(f"{len(titulos_abertos)} título(s) em aberto pra esse(s) cliente(s):\n")
    for t in titulos_abertos.values():
        print("-" * 70)
        print(f"codigo_lancamento_omie: {t.get('codigo_lancamento_omie')}  |  "
              f"valor_documento: {t.get('valor_documento')}  |  "
              f"data_vencimento: {t.get('data_vencimento')}  |  "
              f"codigo_categoria: {t.get('codigo_categoria')}")
        print("Chaves do registro:", list(t.keys()))
        print(_json(t))

    print("\nBuscando títulos LIQUIDADOS este ano (Contas a Receber, status LIQUIDADO)...", flush=True)
    try:
        liquidados = await client.call_paginated(
            "financas/contareceber", "ListarContasReceber",
            params={
                "filtrar_por_status": "LIQUIDADO",
                "filtrar_por_emissao_de": "01/01/2026",
                "filtrar_por_emissao_ate": "31/12/2026",
            },
            records_key=["conta_receber_cadastro", "cadastros"],
        )
    except OmieAPIError as exc:
        print(f"Falhou: {exc}")
        liquidados = []

    liquidados_cliente = [
        r for r in liquidados
        if r.get("codigo_cliente_fornecedor") in codigos_alvo
        and r.get("status_titulo") != "CANCELADO"
    ]
    print(f"{len(liquidados_cliente)} título(s) liquidado(s) este ano pra esse(s) cliente(s):\n")
    for t in liquidados_cliente:
        print("-" * 70)
        print(f"codigo_lancamento_omie: {t.get('codigo_lancamento_omie')}  |  "
              f"valor_documento: {t.get('valor_documento')}  |  "
              f"data_vencimento: {t.get('data_vencimento')}  |  "
              f"codigo_categoria: {t.get('codigo_categoria')}")
        print("Chaves do registro:", list(t.keys()))
        print(_json(t))


if __name__ == "__main__":
    asyncio.run(main())
