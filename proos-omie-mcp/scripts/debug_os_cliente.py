"""
Diagnóstico pontual: dump cru do endpoint `servicos/os` (`ListarOS` /
tentativa de `ConsultarOS`) do Omie — Ordens de Serviço.

Criado em 2026-08-13 a pedido do Rodrigo: além de "Base - Contratos Nao
Faturados" (projeção de receita RECORRENTE calculada a partir do
cadastro do contrato), também precisamos trazer as OS (Ordens de
Serviço) ainda NÃO FATURADAS pra entrar na projeção — essas são receita
NÃO recorrente (pontual/avulsa), diferente da recorrência do contrato.

Achado real que motivou isso: cliente "PEREIRA GIONEDIS ADVOGADOS" tem
uma "OS Adicional de Contrato" (cobrança pontual vinculada ao contrato,
`cNumeroContrato` do título preenchido igual à mensalidade regular — não
dá pra distinguir uma da outra só pelo título) que não é receita
recorrente e precisa ser tratada à parte. Rodrigo confirmou que o campo
que diferencia é o "Nº do Contrato de Venda" na aba "Informações
Adicionais" da PRÓPRIA OS (preenchido = vinculada a um contrato; vazio =
OS comum, avulsa de verdade).

v2 (2026-08-13): primeiro teste (`ListarOS` cru, sem filtro) trouxe
18098 registros / 905 páginas — inviável passear página por página até
achar as OS da PEREIRA GIONEDIS. Encontrado que cada TÍTULO (Contas a
Receber) carrega um campo `nCodOS` apontando pra Ordem de Serviço que o
gerou. Esse script agora: (1) busca os títulos em aberto do cliente
(igual `debug_contrato_cliente.py`) pra pegar os `nCodOS` reais; (2)
tenta `ConsultarOS` (call ainda NÃO catalogada/testada — só um palpite
seguindo o padrão Listar/Consultar do resto da API Omie) com cada
`nCodOS` encontrado, pra ver a OS exata que gerou aquele título e
inspecionar o campo de vínculo com contrato. Se `ConsultarOS` não
existir/falhar, o erro cru da API aparece no terminal — não é um
problema, é informação (tentamos o nome mais provável, sem garantia).

Uso:
    python scripts\\debug_os_cliente.py --cliente oystr --busca "PEREIRA GIONEDIS"
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
    ap.add_argument("--busca", required=True, help="trecho do nome do cliente a procurar")
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
        print(f"NENHUM cliente encontrado com '{args.busca}' no nome.")
        return
    codigos_alvo = {c.get("codigo_cliente_omie") for c in encontrados}
    for c in encontrados:
        print(f"  -> {c.get('razao_social')} (código {c.get('codigo_cliente_omie')})")

    # -----------------------------------------------------------------
    # 1) Títulos EM ABERTO do cliente — pra achar os nCodOS reais.
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

    print(f"{len(titulos_abertos)} título(s) em aberto pra esse(s) cliente(s).\n")

    codigos_os = set()
    for t in titulos_abertos.values():
        print("-" * 70)
        print(f"codigo_lancamento_omie: {t.get('codigo_lancamento_omie')}  |  "
              f"valor_documento: {t.get('valor_documento')}  |  "
              f"data_emissao: {t.get('data_emissao')}  |  "
              f"data_vencimento: {t.get('data_vencimento')}  |  "
              f"cNumeroContrato: {t.get('cNumeroContrato')!r}  |  "
              f"nCodOS: {t.get('nCodOS')!r}")
        cod_os = t.get("nCodOS")
        if cod_os:
            codigos_os.add(cod_os)

    if not codigos_os:
        print("\nNENHUM nCodOS encontrado nos títulos em aberto desse cliente — "
              "não dá pra tentar ConsultarOS. Dump completo de um título de exemplo, "
              "pra conferir se o campo tem outro nome:")
        if titulos_abertos:
            print(_json(next(iter(titulos_abertos.values()))))
        return

    # -----------------------------------------------------------------
    # 2) Tenta ConsultarOS pra cada nCodOS encontrado.
    # -----------------------------------------------------------------
    print(f"\n{len(codigos_os)} nCodOS único(s) encontrado(s): {sorted(codigos_os)}")
    print("\nTentando ConsultarOS pra cada um (call NÃO confirmada, é um palpite)...", flush=True)
    for cod_os in sorted(codigos_os):
        print("=" * 70)
        print(f"nCodOS = {cod_os}")
        for tentativa_params in (
            {"nCodOS": cod_os},
            {"cCodIntOS": "", "nCodOS": cod_os},
        ):
            try:
                data = await client.call("servicos/os", "ConsultarOS", tentativa_params)
                print(f"OK com params {tentativa_params}:")
                print(_json(data))
                break
            except OmieAPIError as exc:
                print(f"Falhou com params {tentativa_params}: {exc}")

    print("\n" + "=" * 70)
    print("Copie e cole ESSE terminal inteiro de volta.")


if __name__ == "__main__":
    asyncio.run(main())
