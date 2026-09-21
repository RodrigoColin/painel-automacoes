"""Modo sombra: roda o motor contra um mes ja conciliado a mao e mede o acerto.

NAO grava nada no ERP. E o passo que valida (ou derruba) a tese antes de
qualquer escrita — o numero que sai daqui decide se o piloto avanca.

Como funciona: o Omie ja registra o que o humano decidiu. Cada lancamento de
conta corrente traz `diversos.nCodLancCR` / `nCodLancCP` apontando para o titulo
que foi baixado. Essa e a nossa resposta certa (gabarito). O motor recebe as
mesmas linhas do extrato e os titulos que estavam em aberto, e comparamos.

Uso:
    python scripts/modo_sombra.py --ofx extrato.ofx --conta cc-itau \\
        --gabarito gabarito.json --titulos titulos.json

Os dois JSON sao gerados a partir do omie_mcp (ver `exportar_base.py`, ou
montados a mao na primeira rodada). Formatos no fim deste arquivo.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.conciliacao import (  # noqa: E402
    Config, Contexto, Desfecho, Faixa, RegraCliente, Titulo, conciliar,
)
from omie_mcp.conciliacao import ofx  # noqa: E402


def carregar_titulos(caminho: Path) -> list[Titulo]:
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    return [
        Titulo(
            id=str(t["id"]),
            tipo=t["tipo"],
            vencimento=date.fromisoformat(t["vencimento"]),
            valor=Decimal(str(t["valor"])),
            parceiro_nome=t.get("parceiro_nome", ""),
            parceiro_documento=t.get("parceiro_documento"),
            numero_documento=t.get("numero_documento"),
            categoria=t.get("categoria"),
            tem_documento_anexo=bool(t.get("tem_documento_anexo", False)),
            conciliado=False,  # no sombra, todos entram como se estivessem abertos
        )
        for t in dados
    ]


def carregar_gabarito(caminho: Path) -> dict[str, dict]:
    """{ fitid_ou_chave: {"titulo_id": ..., "tipo": "titulo|lanc_direto|..."} }"""
    return json.loads(caminho.read_text(encoding="utf-8"))


def chave_data_valor(data_mov, valor) -> str:
    """Chave usada quando o gabarito vem do Omie (que nao conhece o FITID).

    O Omie guarda o lancamento por data e valor, nao pelo id da transacao no
    banco. Entao casamos linha do OFX <-> lancamento do Omie por
    "data do lancamento + valor com sinal".
    """
    return f"{data_mov.isoformat()}|{float(valor):.2f}"


def indexar_gabarito(gabarito: dict, linhas, por_data_valor: bool) -> dict[str, dict]:
    """Devolve o gabarito re-chaveado pelo id da linha do extrato.

    Tolera +-1 dia entre a data do OFX e a do lancamento no Omie — os dois
    podem divergir por compensacao (DTPOSTED do banco vs dDtLanc do Omie),
    mitigacao registrada como pendente em VALIDACAO-2026-09-20.md. A data
    exata (offset 0) e tentada primeiro, pra nao roubar o casamento exato de
    uma linha por causa de outra que so bate no dia vizinho.
    """
    if not por_data_valor:
        return gabarito

    indexado: dict[str, dict] = {}
    usados: set[str] = set()
    for offset in (0, -1, 1):
        for linha in linhas:
            if linha.id in indexado:
                continue
            data_tentativa = linha.data + timedelta(days=offset)
            # o Omie grava o valor com sinal; tentamos as duas convencoes
            for valor in (linha.valor_com_sinal, linha.valor):
                chave = chave_data_valor(data_tentativa, valor)
                if chave in gabarito and chave not in usados:
                    indexado[linha.id] = gabarito[chave]
                    usados.add(chave)
                    break
    return indexado


def bateu(r, esperado: dict) -> bool:
    """Compara o resultado do motor contra o gabarito, sem folga.

    Antes: qualquer desfecho != TITULO contava como acerto sempre que o
    gabarito nao apontava titulo_id — inclusive comparando transferencia
    prevista contra lancamento direto esperado (achado do Codex de
    2026-09-19). Agora exige o MESMO tipo de desfecho.
    """
    esperado_id = esperado.get("titulo_id")
    if esperado_id:
        return (
            r.desfecho is Desfecho.TITULO
            and r.candidato is not None
            and r.candidato.titulo.id == esperado_id
        )
    esperado_tipo = esperado.get("tipo")
    if not esperado_tipo:
        return False
    return r.desfecho.value == esperado_tipo


def main() -> int:
    ap = argparse.ArgumentParser(description="Modo sombra da conciliacao Proos")
    ap.add_argument("--ofx", required=True, type=Path)
    ap.add_argument("--conta", required=True, help="id da conta corrente")
    ap.add_argument("--banco", default=None, help="itau, inter, santander...")
    ap.add_argument("--titulos", required=True, type=Path)
    ap.add_argument("--gabarito", type=Path, default=None)
    ap.add_argument("--regras", type=Path, default=None)
    ap.add_argument("--saida", type=Path, default=Path("sombra_resultado.json"))
    ap.add_argument("--corte-automatico", type=int, default=90)
    ap.add_argument("--corte-revisao", type=int, default=60)
    ap.add_argument(
        "--gabarito-por-data-valor", action="store_true",
        help="gabarito vindo do Omie, chaveado por 'data|valor' em vez de FITID",
    )
    args = ap.parse_args()

    linhas = ofx.ler_arquivo(args.ofx, conta_id=args.conta, banco=args.banco)
    titulos = carregar_titulos(args.titulos)

    regras: list[RegraCliente] = []
    if args.regras and args.regras.exists():
        for r in json.loads(args.regras.read_text(encoding="utf-8")):
            regras.append(
                RegraCliente(
                    padrao=r["padrao"],
                    desfecho=Desfecho(r["desfecho"]),
                    categoria=r.get("categoria"),
                    parceiro_id=r.get("parceiro_id"),
                    conta_destino_id=r.get("conta_destino_id"),
                    confirmacoes=int(r.get("confirmacoes", 1)),
                )
            )

    cfg = Config(
        corte_automatico=args.corte_automatico,
        corte_revisao=args.corte_revisao,
    )
    ctx = Contexto(linhas=linhas, titulos=titulos, regras=regras)
    resultados = conciliar(ctx, cfg)

    print(f"\nLinhas lidas: {len(linhas)}  |  Titulos no universo: {len(titulos)}")

    por_desfecho = Counter(r.desfecho.value for r in resultados)
    por_faixa = Counter(r.faixa.value for r in resultados)
    por_excecao = Counter(
        r.tipo_excecao.value for r in resultados if r.tipo_excecao
    )

    print("\n-- Desfechos --")
    for k, v in por_desfecho.most_common():
        print(f"  {k:<16} {v:>5}  ({v/len(resultados):.0%})")

    print("\n-- Faixas de confianca --")
    for k, v in por_faixa.most_common():
        print(f"  {k:<16} {v:>5}  ({v/len(resultados):.0%})")

    if por_excecao:
        print("\n-- Excecoes por tipo --")
        for k, v in por_excecao.most_common():
            print(f"  {k:<26} {v:>5}")

    # ---- comparacao com o gabarito ----
    if args.gabarito and args.gabarito.exists():
        gabarito = indexar_gabarito(
            carregar_gabarito(args.gabarito), linhas, args.gabarito_por_data_valor
        )
        if args.gabarito_por_data_valor:
            print(f"\n  gabarito casado por data+valor: "
                  f"{len(gabarito)}/{len(linhas)} linhas")
        acertos = erros = sem_gabarito = 0
        divergencias = []

        for r in resultados:
            esperado = gabarito.get(r.linha.id)
            if esperado is None:
                sem_gabarito += 1
                continue
            obtido = r.candidato.titulo.id if r.candidato else None
            esperado_id = esperado.get("titulo_id")

            if bateu(r, esperado):
                acertos += 1
            else:
                erros += 1
                divergencias.append({
                    "linha": r.linha.id,
                    "data": r.linha.data.isoformat(),
                    "valor": str(r.linha.valor_com_sinal),
                    "descricao": r.linha.descricao[:60],
                    "motor": f"{r.desfecho.value}/{r.faixa.value}",
                    "motor_titulo": obtido,
                    "humano_titulo": esperado_id,
                    "humano_tipo": esperado.get("tipo"),
                    "score": r.score,
                })

        avaliadas = acertos + erros
        print("\n-- Comparacao com a conciliacao manual --")
        print(f"  linhas com gabarito: {avaliadas}  (sem gabarito: {sem_gabarito})")
        if avaliadas:
            print(f"  acertos: {acertos}  ({acertos/avaliadas:.1%})")
            print(f"  erros:   {erros}")

        # o numero que realmente importa: acerto DENTRO da faixa automatica
        auto = [r for r in resultados if r.faixa is Faixa.AUTOMATICO
                and r.linha.id in gabarito]
        if auto:
            auto_ok = sum(1 for r in auto if bateu(r, gabarito[r.linha.id]))
            print(f"\n  >> acerto na faixa AUTOMATICA: {auto_ok}/{len(auto)} "
                  f"({auto_ok/len(auto):.1%})")
            print("     (este e o corte que libera a escrita no ERP)")

        if divergencias:
            print(f"\n  {len(divergencias)} divergencias — as 10 primeiras:")
            for d in divergencias[:10]:
                print(f"   {d['data']} {d['valor']:>12} {d['descricao']}")
                print(f"     motor={d['motor']} t={d['motor_titulo']} "
                      f"| humano t={d['humano_titulo']} | score={d['score']}")

    saida = {
        "resumo": {
            "linhas": len(linhas),
            "desfechos": dict(por_desfecho),
            "faixas": dict(por_faixa),
            "excecoes": dict(por_excecao),
        },
        "resultados": [r.to_dict() for r in resultados],
    }
    args.saida.write_text(
        json.dumps(saida, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nDetalhe gravado em {args.saida}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# ---------------------------------------------------------------------------
# FORMATO DOS ARQUIVOS DE ENTRADA
#
# titulos.json — titulos que estavam em aberto no periodo (CP + CR):
# [
#   {"id": "4823910", "tipo": "CP", "vencimento": "2026-09-10",
#    "valor": "1500.00", "parceiro_nome": "DELL COMPUTADORES DO BRASIL LTDA",
#    "parceiro_documento": "72381189000110", "numero_documento": "4471",
#    "categoria": "2.01.03", "tem_documento_anexo": true}
# ]
#
# gabarito.json — o que o humano de fato fez (vem de ListarLancCC, campo
# diversos.nCodLancCR / nCodLancCP):
# {
#   "2026091001": {"titulo_id": "4823910", "tipo": "titulo"},
#   "2026091102": {"titulo_id": null, "tipo": "lanc_direto"}
# }
#
# regras.json — opcional, regras ja aprendidas do cliente:
# [{"padrao": "COPEL", "desfecho": "lanc_direto",
#   "categoria": "Energia Eletrica", "confirmacoes": 4}]
# ---------------------------------------------------------------------------
