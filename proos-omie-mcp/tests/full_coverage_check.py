"""
Verificação em massa de TODOS os endpoints catalogados contra a API real do
Omie. É este script que transforma os `call`s "chutados" (confiança
média/baixa) em confirmados — ou identifica quais precisam de correção.

Não escreve nada no Omie: cada chamada usa `registros_por_pagina=1` e
`max_paginas=1`, ou seja, o mínimo de dados possível só para confirmar que
o endpoint responde.

Uso (cliente único, via .env):
    python tests/full_coverage_check.py

Uso (múltiplos clientes, via clientes_omie.json):
    python tests/full_coverage_check.py --cliente oystr

Gera:
    - Um resumo no console (contagem por status)
    - tests/full_coverage_report_<cliente>.csv com o detalhe de cada endpoint
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.catalog import CATALOG, EndpointSpec  # noqa: E402
from omie_mcp.client import OmieAPIError, OmieClient, OmieNotFoundError  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402

REPORT_DIR = Path(__file__).resolve().parent


async def checar_endpoint(client: OmieClient, spec: EndpointSpec) -> dict[str, str]:
    row = {
        "categoria": spec.categoria,
        "nome": spec.nome,
        "modulo": spec.modulo,
        "slug": spec.slug,
        "call_tentado": spec.call_listar or "",
        "confianca_previa": spec.confianca,
        "status": "",
        "detalhe": "",
    }

    if spec.somente_escrita or not spec.call_listar:
        row["status"] = "PULADO (somente-escrita)"
        return row

    try:
        data = await client.call(
            spec.modulo, spec.call_listar, params={"pagina": 1, "registros_por_pagina": 1}
        )
        campos = ", ".join(list(data.keys())[:6])
        row["status"] = "OK"
        row["detalhe"] = f"Resposta com campos: {campos}"
    except OmieNotFoundError as exc:
        row["status"] = "OK (sem registros)"
        row["detalhe"] = str(exc)
    except OmieAPIError as exc:
        row["status"] = "FAULT"
        row["detalhe"] = f"{exc} (fault_code={exc.fault_code})"
    except Exception as exc:  # noqa: BLE001
        row["status"] = "EXCEPTION"
        row["detalhe"] = f"{type(exc).__name__}: {exc}"

    return row


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cliente", default=None,
        help="slug do cliente Proos a verificar (ver tests/smoke_test.py "
             "--listar-clientes). Opcional se só houver um cliente configurado.",
    )
    args = parser.parse_args()

    try:
        registry = ClientesRegistry.load()
        slug = registry.resolver_slug(args.cliente)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"[config] {exc}")
        return 1

    report_path = REPORT_DIR / f"full_coverage_report_{slug}.csv"

    print(f"Cliente: {slug}")
    print(f"Verificando {len(CATALOG)} endpoints catalogados (isso pode levar alguns minutos "
          f"por causa do rate limiting)...")

    rows: list[dict[str, str]] = []
    async with OmieClient(settings) as client:
        for i, spec in enumerate(CATALOG, start=1):
            row = await checar_endpoint(client, spec)
            rows.append(row)
            print(f"[{i}/{len(CATALOG)}] {spec.categoria} > {spec.nome}: {row['status']}")

    with report_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["categoria", "nome", "modulo", "slug", "call_tentado",
                        "confianca_previa", "status", "detalhe"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nRelatório salvo em: {report_path}")

    contagem: dict[str, int] = {}
    for row in rows:
        contagem[row["status"]] = contagem.get(row["status"], 0) + 1
    print("\nResumo:")
    for status, qtd in sorted(contagem.items()):
        print(f"  {status}: {qtd}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
