"""
Oitava rodada. A documentação pública do Omie (ajuda.omie.com.br) não
expõe um filtro de API que ligue diretamente um movimento do extrato a
um título — mas confirma que a "conciliação bancária" é um recurso real
dentro do Omie (associar lançamento do extrato a título). O extrato já
mostra `cSituacao: "Conciliado"` nos movimentos — ou seja, a ligação
existe no banco de dados do Omie, só não é exposta como um ID direto na
API de leitura.

Hipótese a testar: dá pra achar o título certo por uma CHAVE COMPOSTA
determinística — codigo_cliente_fornecedor + numero_documento_fiscal +
numero_parcela (== nCodCliente + cDocumentoFiscal + cParcela do
movimento) — em vez de aproximação por valor/data. Não existe filtro de
API por essas colunas (testado e confirmado o erro), então este script
faz uma busca binária por `pagina` (usando data_emissao, que já
confirmamos ser crescente por página) pra achar a região certa sem
baixar milhares de páginas, e então varre linearmente essa região
procurando o título com o codigo_cliente_fornecedor já visto no
extrato — pra comparar numero_documento_fiscal/numero_parcela/
valor_documento campo a campo com o movimento real.

Não escreve nada no Omie.

Uso:
    python tests\\sample_fields_8.py --cliente oystr
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402

# (descrição, módulo, call, status, records_key, codigo_cliente_fornecedor alvo,
#  data alvo aproximada dd/mm/aaaa, valores do(s) movimento(s) já vistos no extrato)
CASOS = [
    ("BRIGANTI SOCIEDADE DE ADVOGADOS (RPS 2804, doc.fiscal 2804)",
     "financas/contareceber", "ListarContasReceber", "LIQUIDADO", "conta_receber_cadastro",
     2175755986, "01/07/2026", [1095.52]),
    ("NANTES E MELLO SOCIEDADE DE ADVOGADOS (RPS 2812, doc.fiscal 2812)",
     "financas/contareceber", "ListarContasReceber", "LIQUIDADO", "conta_receber_cadastro",
     2493349530, "01/07/2026", [2000.00]),
]

# (PROOS GESTAO EMPRESARIAL já foi confirmada numa rodada anterior: o título
# com numero_documento_fiscal="168" bateu exatamente com o movimento do
# extrato que tinha cDocumentoFiscal="168" — mesmo cliente, mesmo valor,
# mesma data. Removido daqui pra não gastar chamadas repetindo o que já
# validamos.)


def parse_br_date(s):
    try:
        return datetime.strptime(s, "%d/%m/%Y")
    except Exception:
        return None


async def buscar_total_paginas(client, modulo, call, status):
    data = await client.call(modulo, call, params={"pagina": 1, "registros_por_pagina": 50,
                                                     "filtrar_por_status": status})
    return data.get("total_de_paginas", 1)


async def data_da_pagina(client, modulo, call, status, records_key, pagina):
    data = await client.call(modulo, call, params={"pagina": pagina, "registros_por_pagina": 50,
                                                     "filtrar_por_status": status})
    registros = data.get(records_key, [])
    if not registros:
        return None, []
    return registros[0].get("data_emissao"), registros


async def busca_binaria_pagina(client, modulo, call, status, records_key, total_paginas, alvo):
    alvo_dt = parse_br_date(alvo)
    lo, hi = 1, total_paginas
    melhor_pagina = 1
    while lo <= hi:
        mid = (lo + hi) // 2
        data_str, _ = await data_da_pagina(client, modulo, call, status, records_key, mid)
        dt = parse_br_date(data_str) if data_str else None
        if dt is None:
            break
        if dt <= alvo_dt:
            melhor_pagina = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return melhor_pagina


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
        for (descricao, modulo, call, status, records_key,
             codigo_cliente, data_alvo, valores_extrato) in CASOS:
            print(f"=== {descricao} ===")
            try:
                total_paginas = await buscar_total_paginas(client, modulo, call, status)
                pagina_alvo = await busca_binaria_pagina(
                    client, modulo, call, status, records_key, total_paginas, data_alvo
                )
                print(f"(busca binária: {total_paginas} páginas no total, "
                      f"região de {data_alvo} ~ página {pagina_alvo})")

                encontrados = []
                for p in range(max(1, pagina_alvo - 8), min(total_paginas, pagina_alvo + 15) + 1):
                    data = await client.call(
                        modulo, call,
                        params={"pagina": p, "registros_por_pagina": 50,
                                "filtrar_por_status": status},
                    )
                    for reg in data.get(records_key, []):
                        if reg.get("codigo_cliente_fornecedor") == codigo_cliente:
                            encontrados.append(reg)

                print(f"({len(encontrados)} títulos desse cliente/fornecedor nas páginas "
                      f"vizinhas)")
                for reg in encontrados:
                    bate_valor = round(reg.get("valor_documento", 0), 2) in [
                        round(v, 2) for v in valores_extrato
                    ]
                    print(f"  valor_documento={reg.get('valor_documento')} "
                          f"(bate com movimento do extrato? {bate_valor}) | "
                          f"numero_documento={reg.get('numero_documento')!r} | "
                          f"numero_documento_fiscal={reg.get('numero_documento_fiscal')!r} | "
                          f"numero_parcela={reg.get('numero_parcela')!r} | "
                          f"data_emissao={reg.get('data_emissao')} | "
                          f"data_vencimento={reg.get('data_vencimento')} | "
                          f"codigo_lancamento_omie={reg.get('codigo_lancamento_omie')}")
                    if bate_valor:
                        print("  --- registro completo ---")
                        print(json.dumps(reg, indent=2, ensure_ascii=False))
            except OmieAPIError as exc:
                print(f"[erro] {exc} (fault_code={exc.fault_code})")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
