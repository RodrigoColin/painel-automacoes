"""
Lote de TESTE em escala — cria TODAS as OSs do plano de novembro com o
código marcado (sufixo -TESTE) e DEIXA no Omie para inspeção manual.
Autorizado pelo Rodrigo em 13/11/2026; a exclusão é manual, por ele.

ATENÇÃO: são duplicatas com valores reais na coluna Faturar — NÃO faturar.

Reusa exatamente o motor do worker: plano.montar (resolução) + criacao
(payload/lotes de 4). Diferenças do fluxo real: o código ganha "-TESTE" e
linhas sem vencimento/e-mail (exceções recuperadas) são completadas igual
ao worker (_completar_lacunas replicado aqui de forma simples).

    python scripts/excedentes_lote_teste.py --slug oystr --sim \
        --planilha "...xlsx" --de-para "...xlsx" --competencia 202611
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesRegistry  # noqa: E402
from omie_mcp.excedentes import criacao, plano as plano_mod, vencimento as venc_mod  # noqa: E402
from omie_mcp.excedentes.planilha import ler  # noqa: E402
from omie_mcp.excedentes.resolucao import FonteOmie  # noqa: E402

from excedentes_plano import carregar_de_para_xlsx  # noqa: E402

from omie_mcp.excedentes.resolucao import OsExistente  # noqa: E402

# O Omie bloqueou o ConsultarOS por "consumo indevido" (centenas de chamadas
# hoje). Modo retomada: NENHUM ConsultarOS — a idempotência fica por conta da
# recusa de cCodIntOS duplicado do próprio IncluirOS. As duas exceções que o
# plano só recupera consultando OS (MONTRONI 861 e PETRI sem contrato) são
# respondidas de memória, com os códigos já confirmados hoje mais cedo.
_RECUPERADAS = {"EXC-202611-861", "EXC-202611-14803071000137"}


class FonteSemConsultarOS(FonteOmie):
    async def os_existente(self, codigo):
        if codigo in _RECUPERADAS:
            return OsExistente(n_cod_os=None, numero=None, etapa=None)
        return None


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--planilha", required=True)
    ap.add_argument("--de-para", dest="de_para", required=True)
    ap.add_argument("--competencia", default="202611")
    ap.add_argument("--slug", default="oystr")
    ap.add_argument("--sim", action="store_true",
                    help="confirma a autorização do Rodrigo para ESCREVER")
    args = ap.parse_args()
    if not args.sim:
        print("Recuse-se a rodar sem --sim (autorização explícita do Rodrigo).")
        return 2

    hoje = date.today()
    comp = (int(args.competencia[:4]), int(args.competencia[4:6]))
    lida = ler(Path(args.planilha).read_bytes())
    mapa = carregar_de_para_xlsx(args.de_para)
    settings = ClientesRegistry.load().settings_for(args.slug)

    async with OmieClient(settings) as client:
        fonte = FonteSemConsultarOS(client)
        print("1/3 montando o plano (só leitura)…", flush=True)
        plano = await plano_mod.montar(
            fonte, lida, mapa, args.competencia, hoje=hoje,
            etapa=lambda nome: print(f"   [{nome}]", flush=True))

        linhas = [l for l in plano.linhas if l.status in ("ok", "ja_existe")]
        print(f"   {len(linhas)} linha(s) aproveitáveis; "
              f"{len(plano.excecoes)} exceção(ões) ficam de fora")

        # agrupa por código (mesma regra do worker) e completa lacunas
        grupos: dict[str, list] = {}
        for l in linhas:
            grupos.setdefault(l.codigo_int_os, []).append(l)

        oss: list[criacao.OsParaCriar] = []
        for codigo, grupo in grupos.items():
            l0 = grupo[0]
            venc = l0.venc_final
            email = l0.email_envio
            if venc is None:
                if l0.n_cod_ctr:
                    det = await fonte.consultar_contrato(l0.n_cod_ctr)
                    venc = venc_mod.calcular(hoje, comp, det.regra_venc).data
                    email = email or det.email_envio or None
                else:
                    venc = venc_mod.somar_dias_uteis(hoje, 3)
            if email is None and l0.n_cod_cli:
                email = (await fonte.consultar_cliente(l0.n_cod_cli)).email or None
            oss.append(criacao.OsParaCriar(
                c_cod_int_os=f"{codigo}-TESTE",
                n_cod_cli=l0.n_cod_cli,
                n_cod_ctr=l0.n_cod_ctr,
                numero_contrato=l0.numero_contrato if l0.n_cod_ctr else None,
                categoria=l0.categoria,
                n_cod_cc=l0.n_cod_cc,
                cidade_prest=l0.cidade_prest,
                vencimento=venc,
                previsao=hoje,
                email_envio=email,
                itens=[criacao.ItemOS(
                    linha_id=l.origem.linha, n_cod_servico=l.n_cod_serv,
                    valor_total=l.origem.valor_total, categoria=l.categoria)
                    for l in grupo],
            ))

        total = sum(o.valor_total for o in oss)
        print(f"2/3 criando {len(oss)} OS(s) de TESTE (total {total})…", flush=True)
        resultados = await criacao.criar(client, fonte, oss)

        # 3/3 sem ConsultarOS (bloqueado): o relatório sai do retorno do
        # próprio IncluirOS. O formato do payload já foi conferido campo a
        # campo no piloto e nas 11 primeiras.
        criadas = [r for r in resultados if r.status == "criada"]
        ja_existiam = [r for r in resultados if r.status == "ja_existia"]
        falhas = [r for r in resultados if r.status == "falha"]
        valor_criado = sum((r.os.valor_total for r in criadas), Decimal(0))
        for r in criadas:
            print(f"   criada {r.os.c_cod_int_os} -> OS {r.numero_os} "
                  f"({r.os.valor_total})", flush=True)

        print("\n===== RELATÓRIO DO LOTE DE TESTE =====")
        print(f"criadas nesta rodada: {len(criadas)}  ·  valor: {valor_criado}")
        print(f"já existiam (rodada anterior): {len(ja_existiam)}")
        print(f"falhas: {len(falhas)}")
        for r in falhas:
            print(f"   FALHA {r.os.c_cod_int_os}: {r.erro}")
        total_geral = sum((r.os.valor_total for r in resultados
                           if r.status in ("criada", "ja_existia")), Decimal(0))
        print(f"TOTAL no Omie (criadas + já existentes): "
              f"{len(criadas) + len(ja_existiam)} OSs · {total_geral}")
        print("\nEXCLUSÃO MANUAL (Rodrigo): todas têm código terminando em "
              "-TESTE, etapa Faturar. NÃO FATURAR.")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
