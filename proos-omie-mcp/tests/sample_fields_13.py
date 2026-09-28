"""
Rodrigo apontou que a doc oficial de financas/mf (https://app.omie.com.br/api
/v1/financas/mf/) parece ter um campo de "data de conciliação" — não consigo
abrir essa página daqui (robots.txt bloqueia o domínio inteiro pro fetch, a
mesma restrição de rede que já bloqueia chamadas de API reais desse sandbox).

Este script tenta confirmar empiricamente:

  1) Testa alguns nomes de filtro plausíveis em ListarMovimentos (nCodTitulo,
     janelas de data) — se algum for aceito, usamos as mensagens de erro do
     próprio Omie (que citam o nome exato da tag errada) pra descobrir o
     parâmetro certo, técnica já validada nos testes anteriores.

  2) Se nenhum filtro funcionar, varre páginas grandes (nRegPorPagina=500)
     procurando pelos nCodTitulo já conhecidos como "sem par" (MANP, sem
     numero_documento_fiscal) e imprime o JSON BRUTO COMPLETO de cada um
     assim que encontrado — sem resumir campo nenhum, pra não filtrar sem
     querer algo como "dConciliacao"/"dDtConciliacao"/etc.

  3) Independente do resultado acima, imprime todas as chaves (nomes de
     campo) vistas em "detalhes" e "resumo" na primeira página, pra
     comparar com a lista de campos da doc oficial que o Rodrigo está
     vendo no navegador dele.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_13.py --cliente oystr
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

# Títulos "sem par" (pagamentos manuais, MANP, sem numero_documento_fiscal)
# já vistos numa rodada real do refresh (diagnostico_sem_par.py).
PAGAMENTOS_SEM_PAR = [2530113660, 2531080356, 2531087492, 2531093933, 2531152028]

# Tentativas de filtro plausíveis pra achar um título específico direto,
# sem precisar varrer todas as páginas.
TENTATIVAS_FILTRO = [
    {"nCodTitulo": PAGAMENTOS_SEM_PAR[0]},
    {"dDtRegistroDe": "01/07/2026", "dDtRegistroAte": "05/08/2026"},
    {"dPeriodoInicial": "01/07/2026", "dPeriodoFinal": "05/08/2026"},
    {"dDtPagamentoDe": "01/07/2026", "dDtPagamentoAte": "05/08/2026"},
    {"cGrupo": "CONTA_A_PAGAR"},
]


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
        print("=== 1) Tentativas de filtro em ListarMovimentos ===")
        for extra in TENTATIVAS_FILTRO:
            params = {"nPagina": 1, "nRegPorPagina": 5, **extra}
            print(f"--- params={extra} ---")
            try:
                data = await client.call("financas/mf", "ListarMovimentos", params=params)
                print(f"[OK] nTotRegistros={data.get('nTotRegistros')} "
                      f"nTotPaginas={data.get('nTotPaginas')} "
                      f"registros_retornados={len(data.get('movimentos', []))}")
            except OmieAPIError as exc:
                print(f"[erro] {exc} (fault_code={exc.fault_code})")
            print()

        print("=== 2) Todas as chaves vistas em detalhes/resumo (página 1) ===")
        try:
            data = await client.call(
                "financas/mf", "ListarMovimentos",
                params={"nPagina": 1, "nRegPorPagina": 200},
            )
            chaves_detalhes: set[str] = set()
            chaves_resumo: set[str] = set()
            for m in data.get("movimentos", []):
                chaves_detalhes.update(m.get("detalhes", {}).keys())
                chaves_resumo.update(m.get("resumo", {}).keys())
            print("detalhes:", sorted(chaves_detalhes))
            print("resumo:  ", sorted(chaves_resumo))

            candidatos_conciliacao = [
                k for k in (chaves_detalhes | chaves_resumo)
                if "concili" in k.lower()
            ]
            print(f"\nCampos com 'concili' no nome: {candidatos_conciliacao or '(nenhum)'}")
        except OmieAPIError as exc:
            print(f"[erro] {exc} (fault_code={exc.fault_code})")
            data = {}

        print("\n=== 3) Varredura procurando os títulos MANP sem par ===")
        print(f"Alvo: {PAGAMENTOS_SEM_PAR}")
        alvo = set(PAGAMENTOS_SEM_PAR)
        encontrados: dict[int, dict] = {}
        total_paginas = data.get("nTotPaginas", 1) if data else 1
        # Varre no máximo 80 páginas de 200 registros (16.000 registros) —
        # se não achar nessa faixa, para e avisa (evita rodar pra sempre
        # sem saber se o endpoint tem ordenação previsível).
        limite_paginas = min(total_paginas, 80)
        for p in range(1, limite_paginas + 1):
            if not alvo - encontrados.keys():
                break
            try:
                d = await client.call(
                    "financas/mf", "ListarMovimentos",
                    params={"nPagina": p, "nRegPorPagina": 200},
                )
            except OmieAPIError as exc:
                print(f"  [erro pagina {p}] {exc}")
                continue
            for m in d.get("movimentos", []):
                cod = m["detalhes"].get("nCodTitulo")
                if cod in alvo and cod not in encontrados:
                    encontrados[cod] = m
            if p % 10 == 0:
                print(f"  ...pagina {p}/{limite_paginas}, {len(encontrados)}/{len(alvo)} encontrados")

        print(f"\n({len(encontrados)}/{len(alvo)} títulos MANP sem par encontrados em "
              f"{limite_paginas} páginas)")
        for cod, m in encontrados.items():
            print(f"\n--- nCodTitulo={cod} — JSON BRUTO COMPLETO ---")
            print(json.dumps(m, indent=2, ensure_ascii=False))
        faltando = alvo - encontrados.keys()
        if faltando:
            print(f"\nNão encontrados na varredura: {sorted(faltando)} "
                  f"(pode estar fora da janela de {limite_paginas} páginas, ou "
                  f"a ordenação não é a que eu supus)")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
