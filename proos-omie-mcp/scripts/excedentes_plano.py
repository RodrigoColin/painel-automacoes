"""
Golden test do módulo de excedentes: monta o PLANO (só leitura no Omie)
a partir da planilha mensal e compara com o gabarito validado à mão
("Plano OS Excedentes novembro.26.xlsx", 59 OSs + 1 exceção).

NADA é escrito no Omie — só ListarClientesResumido, ListarContratos,
ConsultarContrato, ConsultarCliente e ConsultarOS.

    python scripts/excedentes_plano.py \
        --planilha "...\\excedente novembro.26.xlsx" \
        --gabarito "...\\Plano OS Excedentes novembro.26.xlsx" \
        --de-para  "...\\Parametros\\De Para Servicos.xlsx" \
        --competencia 202611 --hoje 2026-11-11 --slug oystr

--hoje reproduz a data em que o gabarito foi montado: os vencimentos da
regra "+3 dias úteis" dependem do dia da execução.
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
from omie_mcp.excedentes import plano as plano_mod  # noqa: E402
from omie_mcp.excedentes.depara import MapeamentoExcedente  # noqa: E402
from omie_mcp.excedentes.planilha import ler  # noqa: E402
from omie_mcp.excedentes.resolucao import FonteOmie  # noqa: E402


def carregar_de_para_xlsx(caminho: str) -> dict[str, MapeamentoExcedente]:
    """Mesmo conteúdo da tabela do banco, lido direto do xlsx (o seed da
    migração 0014 veio deste arquivo)."""
    from openpyxl import load_workbook

    ws = load_workbook(caminho, data_only=True).active
    status_map = {"automático": "automatico"}
    mapa: dict[str, MapeamentoExcedente] = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] is None:
            continue
        cod = str(r[0]).strip()
        status = str(r[8] or "automatico").strip().lower()
        mapa[cod] = MapeamentoExcedente(
            cod_recorrente=cod,
            n_cod_serv_recorrente=int(r[2]) if r[2] else None,
            cod_excedente=str(r[3]).strip() if r[3] else None,
            descricao_excedente=str(r[4]).strip() if r[4] else None,
            n_cod_serv_excedente=int(r[5]) if r[5] else None,
            categoria_excedente=str(r[6]).strip() if r[6] else None,
            status=status_map.get(status, status),
        )
    return mapa


def carregar_gabarito(caminho: str) -> tuple[dict, dict, list]:
    from openpyxl import load_workbook

    wb = load_workbook(caminho, data_only=True)
    oss = {}
    for r in wb["OS a criar"].iter_rows(min_row=2, values_only=True):
        if r[0] is None:
            continue
        oss[str(r[11])] = {  # cCodIntOS
            "contrato": str(r[0]), "cliente": r[1], "cnpj": r[2],
            "n_cod_cli": int(r[3]), "n_cod_ctr": int(r[4]), "itens": int(r[5]),
            "valor_total": Decimal(str(r[6])), "desc": r[7],
            "venc_final": str(r[8]), "regra": r[9] or None,
        }
    linhas = {}
    for r in wb["Linhas (60)"].iter_rows(min_row=2, values_only=True):
        if r[0] is None:
            continue
        linhas[int(r[0])] = {
            "status": r[20], "n_cod_serv_exc": int(r[14]) if r[14] else None,
            "cat": r[16], "venc_contrato": r[17], "venc_final": r[18],
            "obs": r[21],
        }
    excecoes = [
        {"linha": int(r[0]), "cliente": r[1], "obs": r[7]}
        for r in wb["Exceções"].iter_rows(min_row=2, values_only=True)
        if r[0] is not None
    ]
    return oss, linhas, excecoes


def _data_br(d: date | None) -> str | None:
    return d.strftime("%d/%m/%Y") if d else None


async def montar(args) -> plano_mod.Plano:
    lida = ler(Path(args.planilha).read_bytes())
    if lida.erros_estrutura:
        raise SystemExit(f"Planilha inválida: {lida.erros_estrutura}")
    mapa = carregar_de_para_xlsx(args.de_para)
    settings = ClientesRegistry.load().settings_for(args.slug)
    hoje = date.fromisoformat(args.hoje) if args.hoje else date.today()
    async with OmieClient(settings) as client:
        fonte = FonteOmie(client)
        return await plano_mod.montar(
            fonte, lida, mapa, args.competencia, hoje=hoje,
            etapa=lambda nome: print(f"  [{nome}]", flush=True))


def comparar(plano: plano_mod.Plano, gab_oss: dict, gab_linhas: dict,
             gab_excecoes: list) -> list[str]:
    difs: list[str] = []

    # --- linhas: status e resolução -------------------------------------
    por_linha = {l.origem.linha: l for l in plano.linhas}
    for num, g in gab_linhas.items():
        l = por_linha.get(num)
        if l is None:
            difs.append(f"linha {num}: esperada no plano e não veio")
            continue
        # EXCEÇÃO do gabarito pode hoje estar "ja_existe": a exceção foi
        # resolvida à mão depois e a OS criada (caso PETRI).
        status = {"OK": ("ok", "ja_existe"), "EXCEÇÃO": ("excecao", "ja_existe")}[g["status"]]
        if l.status not in status:
            difs.append(f"linha {num}: status {l.status!r}, gabarito {g['status']!r} "
                        f"(motivo: {l.excecao_motivo})")
            continue
        if g["status"] == "EXCEÇÃO":
            continue
        if l.n_cod_serv != g["n_cod_serv_exc"]:
            difs.append(f"linha {num}: nCodServ {l.n_cod_serv} ≠ {g['n_cod_serv_exc']}")
        if (l.categoria or None) != (g["cat"] or None):
            difs.append(f"linha {num}: categoria {l.categoria!r} ≠ {g['cat']!r}")
        if l.status == "ja_existe" and l.venc_final is None:
            continue  # recuperada pela idempotência (ex. contrato cancelado depois)
        if (_data_br(l.venc_final) or "")[:5] != str(g["venc_final"])[:5]:
            difs.append(f"linha {num}: venc {_data_br(l.venc_final)} ≠ {g['venc_final']} "
                        f"(regra: {l.regra_venc})")

    # --- OSs -------------------------------------------------------------
    grupos: dict[str, list] = {}
    for l in plano.linhas:
        if l.status in ("ok", "ja_existe") and l.codigo_int_os:
            grupos.setdefault(l.codigo_int_os, []).append(l)
    for codigo, g in gab_oss.items():
        linhas = grupos.get(codigo)
        if not linhas:
            difs.append(f"OS {codigo}: esperada e não montada")
            continue
        if len(linhas) != g["itens"]:
            difs.append(f"OS {codigo}: {len(linhas)} item(ns) ≠ {g['itens']}")
        total = sum(l.origem.valor_total for l in linhas)
        if total != g["valor_total"]:
            difs.append(f"OS {codigo}: valor {total} ≠ {g['valor_total']}")
        l0 = linhas[0]
        if l0.n_cod_cli != g["n_cod_cli"]:
            difs.append(f"OS {codigo}: nCodCli {l0.n_cod_cli} ≠ {g['n_cod_cli']}")
        if l0.n_cod_ctr != g["n_cod_ctr"]:
            difs.append(f"OS {codigo}: nCodCtr {l0.n_cod_ctr} ≠ {g['n_cod_ctr']}")
    excecoes_gab = {e["linha"] for e in gab_excecoes}
    for codigo in set(grupos) - set(gab_oss):
        linhas = grupos[codigo]
        # Grupo extra é aceitável só se for exceção do gabarito já criada à
        # mão depois (ja_existe) — qualquer outra coisa é diferença real.
        if all(l.status == "ja_existe" and l.origem.linha in excecoes_gab
               for l in linhas):
            continue
        difs.append(f"OS fora do gabarito: {codigo}")

    # --- exceções ----------------------------------------------------------
    excecoes_plano = {l.origem.linha for l in plano.excecoes}
    if not excecoes_plano <= excecoes_gab:
        difs.append(f"exceções novas fora do gabarito: "
                    f"{sorted(excecoes_plano - excecoes_gab)}")

    return difs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--planilha", required=True)
    ap.add_argument("--gabarito", required=True)
    ap.add_argument("--de-para", dest="de_para", required=True)
    ap.add_argument("--competencia", default="202611")
    ap.add_argument("--hoje", default=None, help="AAAA-MM-DD da montagem do gabarito")
    ap.add_argument("--slug", default="oystr")
    args = ap.parse_args()

    print("Montando o plano (só leitura no Omie)…", flush=True)
    plano = asyncio.run(montar(args))
    resumo = plano.resumo()
    print(f"\nresumo: {resumo}\n")
    for l in plano.linhas:
        if l.avisos or l.status == "excecao":
            print(f"  linha {l.origem.linha} [{l.status}] {l.origem.cliente}: "
                  f"{l.excecao_motivo or ''} {l.avisos or ''}")

    gab_oss, gab_linhas, gab_excecoes = carregar_gabarito(args.gabarito)
    difs = comparar(plano, gab_oss, gab_linhas, gab_excecoes)
    print(f"\n===== comparação com o gabarito: {len(gab_oss)} OSs, "
          f"{len(gab_linhas)} linhas, {len(gab_excecoes)} exceção(ões) =====")
    if difs:
        for d in difs:
            print(f"  DIF: {d}")
        print(f"\n{len(difs)} diferença(s).")
        return 1
    print("PLANO IDÊNTICO AO GABARITO ✔")
    ja = plano.resumo()["ja_existem"]
    if ja:
        print(f"(idempotência: {ja} linha(s) já têm OS no Omie e não seriam recriadas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
