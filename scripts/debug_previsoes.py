"""
Diagnóstico pontual: testa o endpoint `financas/mf` (`ListarMovimentos`)
com o filtro `cTplancamento=PPV` (previsões financeiras) — indicado pelo
Rodrigo em 2026-08-13 como a fonte mais direta pra receitas/despesas
PREVISTAS (o mesmo tipo de dado que "3.1. RECEITAS PREVISTAS" no pivot
nativo do Omie mostra), cobrindo tanto títulos em aberto quanto
contratos/OS ainda não faturados.

Por que testar isso agora: se esse endpoint devolver diretamente os
mesmos valores/datas que o relatório nativo do Omie usa (ex.: R$2.000,00
em 25/08 pra NANTES E MELLO, R$32.730,59 em 28/08 pra PEREIRA GIONEDIS),
dá pra usar ele como fonte PRIMÁRIA de "Base - Contratos Nao Faturados"
(e possivelmente de uma nova "Base - OS Nao Faturadas") em vez de tentar
reconstruir a lógica de projeção do zero a partir de `ListarContratos` +
heurísticas de cruzamento com título — que já causou 6 bugs reais
diferentes até agora (ver `montar_contratos_recorrentes_nao_faturados`
em `omie_mcp/reports/oystr_diagnostico.py`).

Este endpoint está catalogado em `omie_mcp/catalog.py` com confiança
"baixa" — nunca foi testado de verdade. Este script não assume nada além
do que o Rodrigo informou (nome dos parâmetros pode variar — tenta um
palpite de nomes de parâmetro em camelCase, que é o padrão desse módulo
específico da API do Omie, diferente do snake_case usado noutros
módulos já testados neste projeto).

Uso:
    python scripts\\debug_previsoes.py --cliente oystr
    python scripts\\debug_previsoes.py --cliente oystr --busca "NANTES"
    python scripts\\debug_previsoes.py --cliente oystr --busca "PEREIRA GIONEDIS"
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


def _json(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cliente", required=True, help="slug do cliente Proos (ex.: oystr)")
    ap.add_argument("--busca", default=None,
                     help="opcional: trecho do nome do cliente FINAL pra filtrar depois de "
                          "trazido — se omitido, mostra as primeiras previsões de qualquer "
                          "cliente, só pra ver o formato")
    ap.add_argument("--paginas", type=int, default=5,
                     help="quantas páginas buscar (padrão 5, só pra ter chance de achar o "
                          "cliente procurado sem demorar demais)")
    args = ap.parse_args()

    registry = ClientesRegistry.load()
    settings = registry.settings_for(args.cliente)
    client = OmieClient(settings)

    codigos_alvo = None
    if args.busca:
        print(f"Buscando clientes cujo nome contenha '{args.busca}'...", flush=True)
        todos_clientes = await tools_clientes.listar_clientes(client)
        alvo = args.busca.strip().upper()
        encontrados = [
            c for c in todos_clientes
            if alvo in str(c.get("razao_social", "")).upper()
            or alvo in str(c.get("nome_fantasia", "")).upper()
        ]
        if not encontrados:
            print(f"NENHUM cliente encontrado com '{args.busca}' no nome.")
            return
        codigos_alvo = {c.get("codigo_cliente_omie") for c in encontrados}
        for c in encontrados:
            print(f"  -> {c.get('razao_social')} (código {c.get('codigo_cliente_omie')})")

    print("\nChamando financas/mf ListarMovimentos com cTplancamento=PPV "
          "(palpite de nomes de parâmetro, primeiro tenta camelCase)...", flush=True)

    tentativas_params = [
        {"nPagina": 1, "cTplancamento": "PPV", "nRegPorPagina": 100},
        {"pagina": 1, "cTplancamento": "PPV", "registros_por_pagina": 100},
    ]

    data = None
    params_ok = None
    for params in tentativas_params:
        try:
            data = await client.call("financas/mf", "ListarMovimentos", params)
            params_ok = params
            break
        except OmieAPIError as exc:
            print(f"Falhou com params {params}: {exc}")

    if data is None:
        print("\nNenhuma combinação de parâmetros funcionou — dump dos erros acima ajuda "
              "a ajustar o nome certo.")
        return

    print(f"\nOK com params {params_ok}")
    print(f"Chaves de topo da resposta: {list(data.keys())}")
    print("=" * 70)
    print(_json(data)[:8000])
    if len(_json(data)) > 8000:
        print("... (truncado, resposta maior que 8000 caracteres) ...")

    # tenta achar a lista de registros dentro da resposta (nome do campo
    # ainda não confirmado) pra filtrar pelo cliente buscado
    lista = None
    for key, value in data.items():
        if isinstance(value, list):
            lista = value
            print(f"\nCampo de lista detectado: '{key}' ({len(value)} registro(s) nesta página)")
            break

    if lista and codigos_alvo:
        print(f"\nFiltrando pelos códigos de cliente {codigos_alvo}...")
        achados = [
            r for r in lista
            if any(str(v) in {str(c) for c in codigos_alvo} for v in r.values() if not isinstance(v, (dict, list)))
        ]
        print(f"{len(achados)} registro(s) que mencionam algum desses códigos nesta página:")
        for r in achados:
            print("-" * 70)
            print(_json(r))

    print("\n" + "=" * 70)
    print("Copie e cole ESSE terminal inteiro de volta.")


if __name__ == "__main__":
    asyncio.run(main())
