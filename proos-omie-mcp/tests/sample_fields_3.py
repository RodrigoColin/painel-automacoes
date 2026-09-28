"""
Terceira rodada de investigação: cruza movimentos reais do extrato (já
confirmados em sample_fields_2.py) com o título original (Contas a
Receber/Pagar) pelo código `nCodLancamento` do movimento == `codigo_
lancamento_omie` do título, para confirmar:

  1. Se `nCodLancamento` do extrato realmente bate com `codigo_
     lancamento_omie` do título (join correto pra Base - Recebimentos/
     Base - Pagamentos: Cliente/Emissão/Vencimento/Categoria/Documento/
     Conta Corrente/Valor da Conta/Recebido-Pago).
  2. Se `valor_documento` do título == "Valor da Conta" da planilha, e
     `nValorDocumento` do movimento == "Recebido"/"Valor Pago" (podem
     diferir por juros/desconto/pagamento parcial).

Usa os 4 códigos de lançamento já vistos numa rodada anterior do
extrato (via sample_fields_2.py, cliente oystr, conta ITAU
1628924843, 01/07/2026 a 05/08/2026). Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_3.py --cliente oystr
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

# (nCodLancamento visto no extrato, natureza "R"/"P", nValorDocumento do movimento)
CASOS = [
    (2530065632, "R", 1095.52),  # BRIGANTI SOCIEDADE DE ADVOGADOS — Conta Recebida
    (2530086902, "P", -2500.00),  # PROOS GESTAO EMPRESARIAL — Conta Paga
    (2530086925, "P", -4685.09),  # PROOS GESTAO EMPRESARIAL — Conta Paga
    (2530571873, "R", 2000.00),  # NANTES E MELLO SOCIEDADE DE ADVOGADOS — Conta Recebida
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
        for n_cod_lancamento, natureza, valor_movimento in CASOS:
            print(f"=== nCodLancamento={n_cod_lancamento} (natureza {natureza}, "
                  f"movimento no extrato = R$ {valor_movimento}) ===")
            try:
                if natureza == "R":
                    titulo = await contas_receber.consultar_conta_receber(
                        client, n_cod_lancamento
                    )
                else:
                    titulo = await contas_pagar.consultar_conta_pagar(
                        client, n_cod_lancamento
                    )
                campos_chave = {
                    k: titulo.get(k)
                    for k in (
                        "codigo_lancamento_omie",
                        "codigo_cliente_fornecedor",
                        "data_emissao",
                        "data_vencimento",
                        "data_previsao",
                        "valor_documento",
                        "codigo_categoria",
                        "numero_documento",
                        "codigo_tipo_documento",
                        "status_titulo",
                        "id_conta_corrente",
                    )
                }
                print(json.dumps(campos_chave, indent=2, ensure_ascii=False))
                bate_valor = campos_chave.get("valor_documento") == abs(valor_movimento)
                print(f"  -> valor_documento do título == |valor do movimento|? {bate_valor}")
            except OmieAPIError as exc:
                print(f"[erro] {exc} (fault_code={exc.fault_code})")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
