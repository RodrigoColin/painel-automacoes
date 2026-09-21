"""
Investiga por que alguns títulos liquidados/pagos não acharam par no
extrato — testa a hipótese de que títulos lançados manualmente (origem
"MANP") costumam não ter numero_documento_fiscal preenchido, que é o
campo usado no cruzamento com o extrato (cDocumentoFiscal).

Usa os códigos de lançamento que já apareceram como "sem par" numa
rodada real do scripts/refresh_oystr_diagnostico.py. Não escreve nada
no Omie.

Uso:
    python tests\\diagnostico_sem_par.py --cliente oystr
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
from omie_mcp.tools import contas_pagar, contas_receber  # noqa: E402

RECEBIMENTOS_SEM_PAR = [2530621884, 2530622310, 2530622447, 2530623771, 2530623986]
PAGAMENTOS_SEM_PAR = [2530113660, 2531080356, 2531087492, 2531093933, 2531152028]


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
        print("=== Recebimentos sem par ===")
        for cod in RECEBIMENTOS_SEM_PAR:
            try:
                t = await contas_receber.consultar_conta_receber(client, cod)
                print(f"  {cod}: numero_documento_fiscal={t.get('numero_documento_fiscal')!r} | "
                      f"numero_documento={t.get('numero_documento')!r} | "
                      f"id_origem={t.get('id_origem')!r} | "
                      f"codigo_tipo_documento={t.get('codigo_tipo_documento')!r}")
            except OmieAPIError as exc:
                print(f"  {cod}: [erro] {exc}")

        print("\n=== Pagamentos sem par ===")
        for cod in PAGAMENTOS_SEM_PAR:
            try:
                t = await contas_pagar.consultar_conta_pagar(client, cod)
                print(f"  {cod}: numero_documento_fiscal={t.get('numero_documento_fiscal')!r} | "
                      f"numero_documento={t.get('numero_documento')!r} | "
                      f"id_origem={t.get('id_origem')!r} | "
                      f"codigo_tipo_documento={t.get('codigo_tipo_documento')!r}")
            except OmieAPIError as exc:
                print(f"  {cod}: [erro] {exc}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
