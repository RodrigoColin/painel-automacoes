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
from omie_mcp.conciliacao import dicionario_banco as dic  # noqa: E402
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
            # SEMPRE False aqui, ignorando o que o exportador marcou — e
            # proposital, nao e o mesmo bug que existia antes de 2026-09-21.
            #
            # O exportador agora marca `conciliado=True` pra titulo que ja
            # esta PAGO/RECEBIDO na consulta de HOJE. Isso e correto pra uso
            # em producao real (conciliar.py, que consulta o Omie no
            # momento do lote e nao deve reoferecer titulo ja fechado como
            # candidato). Mas o modo sombra testa dado RETROATIVO: todo
            # titulo que o humano pagou com sucesso num mes passado
            # necessariamente aparece como PAGO na consulta de hoje — isso
            # e o proprio significado de "deu certo", nao motivo pra
            # excluir. Respeitar o campo aqui teria excluido 91/94 titulos
            # da Proos e derrubado o acerto medido de 43% pra 3% (e da
            # Oystr, de 88% pra 0%) por um artefato de metodologia, nao por
            # regressao real do motor — confirmado ao rodar as duas
            # empresas de novo em 2026-09-21 e ver a mesma queda nas duas.
            conciliado=False,
        )
        for t in dados
    ]


def carregar_gabarito(caminho: Path) -> dict[str, list[dict]]:
    """{ chave: [ {"titulo_id": ..., "tipo": "titulo|lanc_direto|...", "observacao": ...}, ... ] }

    Uma chave pode ter mais de uma entrada: duas transacoes reais podem
    cair na mesma data+valor (dois boletos de fornecedores diferentes no
    mesmo dia, mesmo valor) — ver indexar_gabarito para a desambiguacao.
    """
    return json.loads(caminho.read_text(encoding="utf-8"))


def chave_data_valor(data_mov, valor) -> str:
    """Chave usada quando o gabarito vem do Omie (que nao conhece o FITID).

    O Omie guarda o lancamento por data e valor, nao pelo id da transacao no
    banco. Entao casamos linha do OFX <-> lancamento do Omie por
    "data do lancamento + valor com sinal".
    """
    return f"{data_mov.isoformat()}|{float(valor):.2f}"


_RUIDO_OBSERVACAO = {
    "LTDA", "ME", "EIRELI", "SA", "S/A", "EPP", "MEI", "DE", "DA", "DO", "DOS",
    "DAS", "E", "PAGAMENTOS", "PAGAMENTO", "PIX", "QRCODE", "GERADO",
    "AUTOMATICAMENTE", "PELA", "IMPORTACAO", "EXTRATO", "BOLETO", "PAGO",
}


def _tokens_significativos(texto: str) -> set[str]:
    normalizado = dic._normalizar((texto or "").replace("|", " "))
    return {
        t for t in normalizado.split()
        if len(t) > 2 and t not in _RUIDO_OBSERVACAO and not t.isdigit()
    }


def _similaridade_textual(a: str, b: str) -> float:
    """Jaccard simples por token — usado so pra desempatar 2+ lancamentos
    reais que colidiram na mesma chave data+valor (ver indexar_gabarito)."""
    ta, tb = _tokens_significativos(a), _tokens_significativos(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def indexar_gabarito(
    gabarito: dict[str, list[dict]], linhas, por_data_valor: bool
) -> dict[str, dict]:
    """Devolve o gabarito re-chaveado pelo id da linha do extrato.

    Tolera +-1 dia entre a data do OFX e a do lancamento no Omie — os dois
    podem divergir por compensacao (DTPOSTED do banco vs dDtLanc do Omie),
    mitigacao registrada como pendente em VALIDACAO-2026-09-20.md. A data
    exata (offset 0) e tentada primeiro, pra nao roubar o casamento exato de
    uma linha por causa de outra que so bate no dia vizinho.

    Uma chave pode ter mais de uma entrada real (duas transacoes distintas,
    mesma data+valor — achado real na Leadfy, 2026-09-21: dois boletos de
    fornecedores diferentes, R$814,00, mesmo dia). Nesse caso desambigua
    pela observacao do lancamento Omie vs a descricao da linha do extrato —
    sem isso, a segunda transacao sobrescrevia a primeira e o motor era
    julgado errado quando na verdade tinha acertado.
    """
    if not por_data_valor:
        return gabarito

    indexado: dict[str, dict] = {}
    usados: set[tuple[str, int]] = set()
    for offset in (0, -1, 1):
        for linha in linhas:
            if linha.id in indexado:
                continue
            data_tentativa = linha.data + timedelta(days=offset)
            # o Omie grava o valor com sinal; tentamos as duas convencoes
            for valor in (linha.valor_com_sinal, linha.valor):
                chave = chave_data_valor(data_tentativa, valor)
                entradas = gabarito.get(chave)
                if not entradas:
                    continue
                candidatos = [
                    (i, e) for i, e in enumerate(entradas) if (chave, i) not in usados
                ]
                if not candidatos:
                    continue
                if len(candidatos) == 1:
                    idx, entrada = candidatos[0]
                else:
                    idx, entrada = max(
                        candidatos,
                        key=lambda ie: _similaridade_textual(
                            ie[1].get("observacao", ""), linha.descricao
                        ),
                    )
                indexado[linha.id] = entrada
                usados.add((chave, idx))
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
    ap.add_argument("--ofx", required=True, type=Path, nargs="+",
                     help="um ou mais extratos (varias contas no mesmo lote, "
                          "pra medir transferencia entre contas da mesma empresa)")
    ap.add_argument("--conta", default=None,
                     help="id da conta corrente — uso com um unico --ofx")
    ap.add_argument("--contas", nargs="+", default=None,
                     help="nCodCC de cada --ofx, na MESMA ORDEM — obrigatorio "
                          "quando --ofx tem mais de um arquivo")
    ap.add_argument("--banco", default=None, help="itau, inter, santander...")
    ap.add_argument("--titulos", required=True, type=Path)
    ap.add_argument("--gabarito", type=Path, default=None)
    ap.add_argument("--regras", type=Path, default=None)
    ap.add_argument("--saida", type=Path, default=Path("sombra_resultado.json"))
    ap.add_argument("--corte-automatico", type=int, default=90)
    ap.add_argument("--corte-revisao", type=int, default=60)
    ap.add_argument("--dias-antes", type=int, default=Config().dias_antes,
                     help="quantos dias ANTES do vencimento uma linha ainda casa com o "
                          "titulo (padrao pensado pra quem paga em cima da data; "
                          "clientes que antecipam pagamento precisam de um numero maior)")
    ap.add_argument("--dias-depois", type=int, default=Config().dias_depois,
                     help="quantos dias DEPOIS do vencimento uma linha ainda casa com o titulo")
    ap.add_argument(
        "--gabarito-por-data-valor", action="store_true",
        help="gabarito vindo do Omie, chaveado por 'data|valor' em vez de FITID",
    )
    args = ap.parse_args()

    if args.contas:
        if len(args.contas) != len(args.ofx):
            print(f"ERRO: {len(args.ofx)} --ofx mas {len(args.contas)} --contas — "
                  "precisa ter a mesma quantidade, na mesma ordem.")
            return 2
        pares = list(zip(args.ofx, args.contas))
    elif len(args.ofx) == 1 and args.conta:
        pares = [(args.ofx[0], args.conta)]
    else:
        print("ERRO: informe --conta (um unico --ofx) ou --contas "
              "(uma por --ofx, na mesma ordem, pra lote multi-conta).")
        return 2

    linhas = []
    for caminho, conta in pares:
        linhas.extend(ofx.ler_arquivo(caminho, conta_id=conta, banco=args.banco))
    linhas = ofx.renumerar_para_lote_multiconta(linhas)
    linhas.sort(key=lambda l: (l.data, l.id))
    if len(pares) > 1:
        print(f"Lote multi-conta: {len(pares)} contas, {len(linhas)} linhas no total.")

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
        dias_antes=args.dias_antes,
        dias_depois=args.dias_depois,
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
