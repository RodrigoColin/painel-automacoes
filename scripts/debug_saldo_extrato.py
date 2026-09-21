"""
Diagnóstico pontual (2026-08-13): checar se o "Saldo de abertura" que a
aba "Fluxo Diario <Mês>-<Ano>" usa (hoje: encadeado mês a mês, a partir de
um "Saldo real informado" digitado manualmente em julho e corrigido à mão
em 05/08 pra R$233.067,64) ainda bate com o saldo que o PRÓPRIO Omie tem
registrado.

O `ListarExtrato` (mesmo endpoint já usado em produção pra previsão de
contrato/OS — ver bug #7) devolve, no início do período consultado, um
registro sintético com `cDesCliente == "SALDO ANTERIOR"` cujo campo
`nSaldo` é o saldo real da conta corrente naquele ponto, direto do livro-
-razão do Omie (não é um cálculo nosso). Esse script consulta esse
registro pra 01/08/2026 (abertura de agosto) em cada conta de fluxo de
caixa da Oystr e soma — pra comparar com os R$233.067,64 que a planilha
está usando hoje como abertura de agosto.

Uso:
    python scripts\\debug_saldo_extrato.py --cliente oystr
    python scripts\\debug_saldo_extrato.py --cliente oystr --data 13/08/2026
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesRegistry  # noqa: E402
from omie_mcp.tools import contas_correntes as tools_contas_correntes  # noqa: E402
from omie_mcp.tools import extrato as tools_extrato  # noqa: E402
from omie_mcp.reports.oystr_diagnostico import _EXCLUIR_CONTAS_NAO_CAIXA  # noqa: E402


def _json(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cliente", required=True, help="slug do cliente Proos (ex.: oystr)")
    ap.add_argument("--data", default="01/08/2026",
                     help="dd/mm/aaaa — dia cujo 'SALDO ANTERIOR' (abertura) queremos ver "
                          "(default: 01/08/2026, abertura de agosto)")
    args = ap.parse_args()

    registry = ClientesRegistry.load()
    settings = registry.settings_for(args.cliente)
    client = OmieClient(settings)

    print("Buscando contas correntes válidas (fluxo de caixa)...", flush=True)
    contas = await tools_contas_correntes.contas_fluxo_de_caixa(
        client, excluir=_EXCLUIR_CONTAS_NAO_CAIXA
    )
    contas = sorted(contas)
    print(f"{len(contas)} conta(s): {contas}\n")

    total_saldo_anterior = 0.0
    print("=" * 70)
    for i, n_cod_cc in enumerate(contas):
        if i > 0:
            await asyncio.sleep(1.5)
        # janela de 1 dia só pra capturar o registro "SALDO ANTERIOR" da abertura
        movimentos = await tools_extrato.consultar_extrato(client, n_cod_cc, args.data, args.data)
        saldo_registro = next(
            (m for m in movimentos if str(m.get("cDesCliente", "")).upper() == "SALDO ANTERIOR"),
            None,
        )
        if saldo_registro is None:
            print(f"Conta {n_cod_cc}: nenhum registro 'SALDO ANTERIOR' encontrado "
                  f"({len(movimentos)} movimento(s) no dia). Dump do primeiro movimento, se houver:")
            if movimentos:
                print(_json(movimentos[0]))
            continue
        saldo = float(saldo_registro.get("nSaldo") or 0)
        total_saldo_anterior += saldo
        print(f"Conta {n_cod_cc}: SALDO ANTERIOR em {args.data} = R$ {saldo:,.2f}")

    print("=" * 70)
    print(f"SOMA de todas as contas (saldo real do Omie na abertura de {args.data}): "
          f"R$ {total_saldo_anterior:,.2f}")
    print("\nCopie e cole ESSE terminal inteiro de volta.")


if __name__ == "__main__":
    asyncio.run(main())
