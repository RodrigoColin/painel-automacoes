"""
OS PILOTO de excedentes — ESCREVE no Omie. Rodar SÓ com autorização
explícita do Rodrigo.

Cria UMA OS real com um cCodIntOS de teste (sufixo -TESTE, não colide com
os códigos de produção), confere com ConsultarOS (etapa, parcelas, e-mail,
cDadosAdicNF vazio, cNumContrato) e, com --excluir, remove em seguida.

    # criar e conferir (deixa a OS no Omie para inspeção manual):
    python scripts/excedentes_piloto.py --slug oystr

    # criar, conferir e excluir na sequência:
    python scripts/excedentes_piloto.py --slug oystr --excluir
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesRegistry  # noqa: E402
from omie_mcp.excedentes import criacao  # noqa: E402
from omie_mcp.excedentes.resolucao import FonteOmie  # noqa: E402
from omie_mcp.excedentes.vencimento import somar_dias_uteis  # noqa: E402

# Espelho da OS real 20019 (ARAUZ, EXC-202611-6), com código de teste e
# valor simbólico — os demais campos são exatamente os que o módulo usa.
PILOTO = dict(
    c_cod_int_os="EXC-202611-6-TESTE",
    n_cod_cli=1835264895,            # ARAUZ
    n_cod_ctr=1860490808,            # contrato 6
    numero_contrato="6",
    categoria="1.01.02",
    n_cod_cc=1628924843,             # mesmo CC das OSs reais de novembro
    cidade_prest="CURITIBA (PR)",
    email_envio="controle@arauz.com.br, contasapagar@arauz.com.br",
    n_cod_servico=2174029906,        # Tribunais - Intimações - ... - Excedentes
    valor=Decimal("1.00"),
)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default="oystr")
    ap.add_argument("--excluir", action="store_true")
    ap.add_argument("--sim", action="store_true",
                    help="confirma que o Rodrigo autorizou a escrita")
    args = ap.parse_args()
    if not args.sim:
        print("Recuse-se a rodar sem --sim (autorização explícita do Rodrigo).")
        return 2

    hoje = date.today()
    os_ = criacao.OsParaCriar(
        c_cod_int_os=PILOTO["c_cod_int_os"],
        n_cod_cli=PILOTO["n_cod_cli"],
        n_cod_ctr=PILOTO["n_cod_ctr"],
        numero_contrato=PILOTO["numero_contrato"],
        categoria=PILOTO["categoria"],
        n_cod_cc=PILOTO["n_cod_cc"],
        cidade_prest=PILOTO["cidade_prest"],
        vencimento=somar_dias_uteis(hoje, 3),
        previsao=hoje,
        email_envio=PILOTO["email_envio"],
        itens=[criacao.ItemOS(linha_id=0, n_cod_servico=PILOTO["n_cod_servico"],
                              valor_total=PILOTO["valor"],
                              categoria=PILOTO["categoria"])],
    )
    print("payload IncluirOS:")
    print(json.dumps(criacao.montar_payload(os_), ensure_ascii=False, indent=2))

    settings = ClientesRegistry.load().settings_for(args.slug)
    async with OmieClient(settings) as client:
        fonte = FonteOmie(client)
        [resultado] = await criacao.criar(client, fonte, [os_])
        print(f"\nresultado: {resultado.status} nCodOS={resultado.n_cod_os} "
              f"numero={resultado.numero_os} erro={resultado.erro}")
        if resultado.status == "falha":
            return 1

        conferida = await client.call(
            "servicos/os", "ConsultarOS", {"cCodIntOS": os_.c_cod_int_os})
        cab = conferida.get("Cabecalho") or {}
        inf = conferida.get("InformacoesAdicionais") or {}
        print("\nconferência (ConsultarOS):")
        print(f"  cEtapa={cab.get('cEtapa')!r} (esperado '50')")
        print(f"  dDtPrevisao={cab.get('dDtPrevisao')!r}")
        print(f"  cNumContrato={inf.get('cNumContrato')!r} (esperado '6')")
        print(f"  cDadosAdicNF={inf.get('cDadosAdicNF')!r} (esperado vazio)")
        print(f"  cCidPrestServ={inf.get('cCidPrestServ')!r} nCodCC={inf.get('nCodCC')!r}")
        print(f"  Email={json.dumps(conferida.get('Email') or {}, ensure_ascii=False)}")
        print(f"  Parcelas={json.dumps(conferida.get('Parcelas') or [], ensure_ascii=False)}")

        if args.excluir:
            apagada = await client.call(
                "servicos/os", "ExcluirOS", {"cCodIntOS": os_.c_cod_int_os})
            print(f"\nexcluída: {json.dumps(apagada, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
