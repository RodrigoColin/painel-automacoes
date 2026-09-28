"""
sample_fields_17/18.py confirmaram: os 5 títulos a receber "sem par" não
têm NENHUM lançamento correspondente em financas/contacorrentelancamentos
(ListarLancCC), mesmo numa janela de quase 80 dias. Isso sugere que a
baixa desses títulos não passou pela conciliação bancária — algo como
baixa manual, compensação, desconto integral, ou outra forma sem trânsito
pela conta corrente.

Este script consulta os 5 títulos diretamente (ConsultarContaReceber) e
imprime TODOS os campos, procurando qualquer indício da forma de baixa
(datas de liquidação, meio de pagamento, campos de desconto/compensação
etc.) — só pra confirmar a hipótese antes de decidir como tratar esses
casos no relatório (ficam mesmo como "sem par", pra revisão manual do
Rodrigo, ou tem algum campo que ainda dá pra usar como Data de Crédito).

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_19.py --cliente oystr
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
from omie_mcp.tools import contas_receber  # noqa: E402

RECEBIMENTOS_SEM_PAR = [2530621884, 2530622310, 2530622447, 2530623771, 2530623986]


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
        for cod in RECEBIMENTOS_SEM_PAR:
            print(f"=== título {cod} — JSON completo ===")
            try:
                titulo = await contas_receber.consultar_conta_receber(client, cod)
                print(json.dumps(titulo, indent=2, ensure_ascii=False))
            except OmieAPIError as exc:
                print(f"[erro] {exc}")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
