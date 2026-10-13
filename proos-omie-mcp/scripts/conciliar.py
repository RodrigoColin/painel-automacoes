"""Pipeline de conciliacao — o comando do dia a dia.

    OFX -> motor -> (dry-run | gravacao no Omie) -> JSON para a fila

Uso tipico durante o piloto (sem gravar nada):

    python scripts/conciliar.py --cliente oystr --conta-omie 1628924843 \\
        --ofx extrato_set.ofx --titulos sombra/titulos.json

Quando o modo sombra bater o corte de acerto, libera a escrita:

    python scripts/conciliar.py ... --gravar

O `--gravar` so age sobre a faixa AUTOMATICA. Revisao e excecao continuam
esperando o operador na fila — por desenho, nao por limitacao.
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

from omie_mcp.conciliacao import (  # noqa: E402
    Config, Contexto, Desfecho, Faixa, LinhaExtrato, Natureza, Resultado, Titulo,
    buscar_linhas_ja_existentes, buscar_recebimentos, conciliar, regras_de_json,
    regras_para_json, verificar_contas_omie_cash,
)
from omie_mcp.conciliacao import escrita_omie as eo  # noqa: E402
from omie_mcp.conciliacao import ofx  # noqa: E402


# --------------------------- memoria de transferencias ---------------------

def _serializar_linha(l: LinhaExtrato) -> dict:
    return {
        "id": l.id, "conta_id": l.conta_id, "data": l.data.isoformat(),
        "valor": str(l.valor), "natureza": l.natureza.value,
        "descricao": l.descricao, "contraparte_nome": l.contraparte_nome,
        "contraparte_documento": l.contraparte_documento, "banco": l.banco,
        "fonte": l.fonte,
    }


def _linha_de_dict(d: dict) -> LinhaExtrato:
    return LinhaExtrato(
        id=d["id"], conta_id=d["conta_id"], data=date.fromisoformat(d["data"]),
        valor=Decimal(d["valor"]), natureza=Natureza(d["natureza"]),
        descricao=d["descricao"], contraparte_nome=d.get("contraparte_nome"),
        contraparte_documento=d.get("contraparte_documento"), banco=d.get("banco"),
        fonte=d.get("fonte", "pendente"),
    )


def _esta_aguardando_par(r: Resultado) -> bool:
    """So a "transferencia com indicio textual, par ainda nao apareceu, mas
    dentro da janela de espera" cai nessa combinacao especifica — ver
    motor._tentar_transferencia. Usado pra decidir o que entra/sai da
    memoria de pendentes, sem duplicar a logica do motor aqui."""
    return r.desfecho is Desfecho.FILA and r.faixa is Faixa.REVISAO


def atualizar_pendentes(
    resultados: list[Resultado], ids_pendentes_antes: set[str]
) -> tuple[list[LinhaExtrato], list[LinhaExtrato]]:
    """Decide o que continua pendente e o que e novo, a partir dos
    resultados de uma rodada — pura, sem tocar em arquivo, pra ser testavel.

    Retorna (ainda_pendentes, novas_aguardando). O chamador junta as duas
    listas e persiste. Uma linha carregada da memoria (`ids_pendentes_antes`)
    que NAO esta mais "aguardando" (resolveu como transferencia real, ou
    escalou pra excecao dura por estourar o prazo) sai da memoria — resolvida
    ou nao, ela ja teve a chance de parear.
    """
    ainda_pendentes = [
        r.linha for r in resultados
        if r.linha.id in ids_pendentes_antes and _esta_aguardando_par(r)
    ]
    novas_aguardando = [
        r.linha for r in resultados
        if r.linha.id not in ids_pendentes_antes and _esta_aguardando_par(r)
    ]
    return ainda_pendentes, novas_aguardando


# buscar_linhas_ja_existentes mudou pra omie_mcp/conciliacao/duplicidade.py
# em 2026-09-22 — scripts/conciliar_extrato_painel.py (usado pela tela de
# Conciliacao Bancaria do Portal Proos) passou a precisar da mesma logica,
# e duplicar essa integracao com o Omie em dois scripts arriscava os dois
# divergirem com o tempo.


# verificar_contas_omie_cash mudou pra omie_mcp/conciliacao/omie_cash.py em
# 2026-09-22 — mesmo motivo do buscar_linhas_ja_existentes acima.


def persistir_estado(caminho: Path, chaves: set[str]) -> None:
    """Grava as chaves de idempotencia de forma atomica (escreve num
    temporario e substitui) — uma queda no meio da escrita nunca deixa o
    arquivo de estado corrompido/truncado."""
    tmp = caminho.with_suffix(caminho.suffix + ".tmp")
    tmp.write_text(json.dumps(sorted(chaves)), encoding="utf-8")
    tmp.replace(caminho)


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
            conciliado=bool(t.get("conciliado", False)),
        )
        for t in dados
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description="Conciliacao bancaria — Proos")
    ap.add_argument("--cliente", required=True)
    ap.add_argument("--conta-omie", required=True,
                    help="nCodCC da conta principal (default de --contas quando omitido)")
    ap.add_argument("--ofx", required=True, type=Path, nargs="+",
                    help="um ou mais extratos (varias contas no mesmo lote)")
    ap.add_argument("--contas", nargs="+", default=None,
                    help="nCodCC de cada --ofx, na MESMA ORDEM — obrigatorio "
                         "quando --ofx tem mais de um arquivo de contas diferentes "
                         "(ex.: transferencia entre contas da mesma empresa)")
    ap.add_argument("--banco", default=None)
    ap.add_argument("--titulos", required=True, type=Path)
    ap.add_argument("--regras", type=Path, default=Path("regras.json"))
    ap.add_argument("--estado", type=Path, default=Path("gravadas.json"),
                    help="chaves de idempotencia ja gravadas no ERP")
    ap.add_argument("--saida", type=Path, default=Path("fila.json"))
    ap.add_argument("--categoria-padrao", default="")
    ap.add_argument("--favorecido-lanc-direto", type=int, default=None,
                    help="codigo_cliente_omie do favorecido em lancamento direto "
                         "(IncluirLancCC) — ex.: o cadastro do proprio banco pra "
                         "tarifa/IOF. Sem isso o campo Favorecido/Cliente fica vazio.")
    ap.add_argument("--conta-investimento", default=None,
                    help="nCodCC da conta de aplicacao/resgate — sem isso, aplicacao/"
                         "resgate reconhecido ainda vira transferencia, so que em "
                         "revisao (operador informa a conta)")
    ap.add_argument("--conta-cartao", default=None,
                    help="nCodCC da conta do cartao de credito — mesma logica do "
                         "--conta-investimento, pra pagamento de fatura")
    ap.add_argument("--conta-garantida", default=None,
                    help="nCodCC da conta que representa a linha de credito rotativo "
                         "('conta garantida') — mesma logica do --conta-investimento")
    ap.add_argument("--corte-automatico", type=int, default=90)
    ap.add_argument("--corte-revisao", type=int, default=60)
    ap.add_argument("--dias-antes", type=int, default=Config().dias_antes,
                     help="quantos dias ANTES do vencimento uma linha ainda casa com o "
                          "titulo — clientes que antecipam pagamento (ex.: Proos) "
                          "precisam de um numero maior que o padrao")
    ap.add_argument("--dias-depois", type=int, default=Config().dias_depois,
                     help="quantos dias DEPOIS do vencimento uma linha ainda casa com o titulo")
    ap.add_argument("--decompor-boleto", action="store_true",
                     help="liga a decomposicao de credito consolidado de boleto: casa o "
                          "credito 'BOLETOS RECEBIDOS' com o conjunto de boletos de um dia "
                          "ja baixados no Omie (soma exata). So p/ quem recebe boleto DIRETO "
                          "na conta e em baixo volume (ex.: Proos) — em alto volume nao fecha.")
    ap.add_argument("--dias-credito-boleto", type=int, default=Config().dias_credito_boleto,
                     help="janela de defasagem de compensacao do boleto (dias)")
    ap.add_argument("--sem-recebimentos", action="store_true",
                     help="nao busca recebimentos ja baixados no Omie — desliga o casamento "
                          "de PIX QR sem contraparte e a decomposicao de boleto")
    ap.add_argument("--gravar", action="store_true",
                    help="grava no Omie a faixa automatica (padrao: dry-run)")
    ap.add_argument("--confirmo-escrita", default="",
                    help="repita o slug do cliente para liberar --gravar "
                         "(segunda confirmacao, evita gravar no cliente errado)")
    ap.add_argument("--max-gravacoes", type=int, default=200,
                    help="teto de gravacoes por rodada (freio contra lote errado)")
    ap.add_argument("--pendentes", type=Path, default=Path("pendentes_transferencia.json"),
                    help="memoria de transferencias 'parece transferencia, aguardando a "
                         "outra conta' entre rodadas — util quando as contas de uma "
                         "empresa sao processadas em dias diferentes")
    args = ap.parse_args()

    if args.contas:
        if len(args.contas) != len(args.ofx):
            print(f"ERRO: {len(args.ofx)} --ofx mas {len(args.contas)} --contas — "
                  "precisa ter a mesma quantidade, na mesma ordem.")
            return 2
        contas_por_arquivo = dict(zip(args.ofx, args.contas))
    else:
        contas_por_arquivo = {caminho: args.conta_omie for caminho in args.ofx}
    contas_do_lote = sorted(set(contas_por_arquivo.values()))

    if not asyncio.run(
        verificar_contas_omie_cash(args.cliente, set(contas_do_lote), exigir=False)
    ):
        return 2

    # ---- entrada ----
    linhas = []
    for caminho in args.ofx:
        conta = contas_por_arquivo[caminho]
        lidas = ofx.ler_arquivo(caminho, conta_id=conta, banco=args.banco)
        linhas.extend(lidas)
        saldo = ofx.saldo_final(caminho.read_text(encoding="latin-1", errors="replace"))
        print(f"{caminho.name}: {len(lidas)} linhas"
              + (f" | saldo {saldo[1]} em {saldo[0]}" if saldo else ""))
    linhas = ofx.renumerar_para_lote_multiconta(linhas)
    if len(contas_do_lote) > 1:
        print(f"Lote multi-conta: {len(contas_do_lote)} contas ({', '.join(contas_do_lote)}).")

    titulos = carregar_titulos(args.titulos)
    regras = (
        regras_de_json(json.loads(args.regras.read_text(encoding="utf-8")))
        if args.regras.exists() else []
    )
    print(f"\n{len(linhas)} linhas | {len(titulos)} titulos | {len(regras)} regras")

    linhas_ja_conciliadas = asyncio.run(
        buscar_linhas_ja_existentes(args.cliente, contas_do_lote, linhas)
    )

    # ---- recebimentos ja baixados no Omie (PIX QR sem contraparte + boleto) ----
    # O motor roda DEPOIS da baixa/CNAB: titulos ja recebidos no Omie servem
    # para (a) recuperar quem o banco escondeu num PIX QR e (b) decompor o
    # credito consolidado de boleto. Best-effort: se a Omie falhar, volta [] e
    # esses passos so nao rodam.
    recebimentos = []
    if not args.sem_recebimentos and linhas:
        datas = [l.data for l in linhas]
        recebimentos = asyncio.run(
            buscar_recebimentos(args.cliente, contas_do_lote, min(datas), max(datas))
        )

    # ---- memoria de transferencias aguardando a outra conta ----
    # Uma linha "parece transferencia, mas a outra conta ainda nao apareceu"
    # nao pode ser esquecida so porque essa conta foi processada num dia e a
    # outra so vai ser processada depois — guarda e tenta parear de novo a
    # cada rodada futura, de qualquer conta, ate resolver ou estourar o prazo
    # (Config.dias_espera_par).
    pendentes_brutos = (
        json.loads(args.pendentes.read_text(encoding="utf-8"))
        if args.pendentes.exists() else []
    )
    linhas_pendentes = [_linha_de_dict(p) for p in pendentes_brutos]
    ids_pendentes_antes = {l.id for l in linhas_pendentes}
    linhas_do_motor = linhas_pendentes + linhas

    # ---- motor ----
    cfg = Config(
        corte_automatico=args.corte_automatico,
        corte_revisao=args.corte_revisao,
        dias_antes=args.dias_antes,
        dias_depois=args.dias_depois,
        decompor_boleto_recebido=args.decompor_boleto,
        dias_credito_boleto=args.dias_credito_boleto,
    )
    contas_inv = (
        {args.conta_omie: args.conta_investimento}
        if args.conta_investimento else {}
    )
    contas_cartao = (
        {args.conta_omie: args.conta_cartao}
        if args.conta_cartao else {}
    )
    contas_garantidas = (
        {args.conta_omie: args.conta_garantida}
        if args.conta_garantida else {}
    )
    resultados = conciliar(
        Contexto(linhas=linhas_do_motor, titulos=titulos, regras=regras,
                 contas_investimento=contas_inv, contas_cartao=contas_cartao,
                 contas_garantidas=contas_garantidas,
                 linhas_ja_conciliadas=linhas_ja_conciliadas,
                 recebimentos=recebimentos),
        cfg,
    )

    ainda_pendentes, novas_aguardando = atualizar_pendentes(resultados, ids_pendentes_antes)
    pendentes_finais = ainda_pendentes + novas_aguardando
    args.pendentes.write_text(
        json.dumps([_serializar_linha(l) for l in pendentes_finais], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if linhas_pendentes:
        resolvidas = len(linhas_pendentes) - len(ainda_pendentes)
        print(f"\n{len(linhas_pendentes)} transferencia(s) pendente(s) da memoria "
              f"({args.pendentes}) — {resolvidas} resolvida(s) nesta rodada, "
              f"{len(ainda_pendentes)} continuam aguardando.")
    if novas_aguardando:
        print(f"{len(novas_aguardando)} linha(s) nova(s) parecem transferencia mas a "
              f"outra conta ainda nao apareceu — guardadas em {args.pendentes} "
              "para uma proxima rodada (de qualquer conta) tentar parear.")

    auto = sum(1 for r in resultados if r.faixa is Faixa.AUTOMATICO)
    rev = sum(1 for r in resultados if r.faixa is Faixa.REVISAO)
    exc = sum(1 for r in resultados if r.faixa is Faixa.EXCECAO)
    total = len(resultados) or 1
    print(f"\nautomatico {auto} ({auto/total:.0%}) | "
          f"revisao {rev} | excecao {exc}")

    tipos: dict[str, int] = {}
    for r in resultados:
        if r.tipo_excecao:
            tipos[r.tipo_excecao.value] = tipos.get(r.tipo_excecao.value, 0) + 1
    if tipos:
        print("\nexcecoes:")
        for t, n in sorted(tipos.items(), key=lambda x: -x[1]):
            print(f"  {t:<24} {n}")

    # ---- escrita ----
    cfg_escrita = eo.ConfigEscrita(
        conta_corrente_omie=args.conta_omie,
        codigo_categoria_padrao=args.categoria_padrao,
        conta_investimento_omie=args.conta_investimento,
        codigo_favorecido_lancamento_direto=args.favorecido_lanc_direto,
    )
    ja = set(
        json.loads(args.estado.read_text(encoding="utf-8"))
        if args.estado.exists() else []
    )

    if args.gravar:
        if args.confirmo_escrita != args.cliente:
            print("\nABORTADO: --gravar exige --confirmo-escrita <slug do cliente>.")
            return 3

        # Checagem FINAL e COMPLETA de Omie.CASH, fail-closed — cobre toda
        # conta que pode aparecer num payload de escrita, nao so as do
        # --contas/--conta-omie originais (achado real da revisao
        # adversarial do Codex, 2026-09-21: a checagem cedo nao pegava
        # --conta-investimento/--conta-cartao/--conta-garantida nem contas
        # vindas de linhas pendentes de rodadas anteriores).
        contas_a_verificar = set(contas_do_lote)
        contas_a_verificar.update(
            c for c in (args.conta_investimento, args.conta_cartao, args.conta_garantida)
            if c
        )
        contas_a_verificar.update(
            l.conta_id for l in linhas_pendentes if l.conta_id.isdigit()
        )
        if not asyncio.run(
            verificar_contas_omie_cash(args.cliente, contas_a_verificar, exigir=True)
        ):
            return 2

        # Lancamento direto sem favorecido/fornecedor fica incompleto no Omie
        # (achado real, Proos 2026-09-24: o primeiro lancamento gravado saiu
        # sem Favorecido/Cliente porque a flag nao existia ainda). Fail-closed
        # antes de gravar qualquer coisa, nao um skip silencioso por linha —
        # o operador precisa saber ANTES, nao descobrir nos "puladas" do
        # relatorio.
        tem_lanc_direto_automatico = any(
            r.faixa is Faixa.AUTOMATICO and r.desfecho is Desfecho.LANCAMENTO_DIRETO
            for r in resultados
        )
        if tem_lanc_direto_automatico and not args.favorecido_lanc_direto:
            print("\nABORTADO: ha lancamento(s) direto(s) na faixa automatica mas "
                  "--favorecido-lanc-direto nao foi informado — todo lancamento "
                  "direto precisa de Favorecido/Cliente (nCodCliente) no Omie. "
                  "Informe o codigo (ex.: o cadastro do proprio banco pra tarifa/IOF).")
            return 6

        planejadas = sum(1 for r in resultados if r.faixa is Faixa.AUTOMATICO
                         and r.desfecho is not Desfecho.FILA)
        if planejadas > args.max_gravacoes:
            print(f"\nABORTADO: {planejadas} gravacoes > teto {args.max_gravacoes}. "
                  "Revise o lote ou suba --max-gravacoes de proposito.")
            return 4
        trava = args.estado.with_suffix(".lock")
        if trava.exists():
            print(f"\nABORTADO: {trava} existe — outra rodada em andamento ou "
                  "abortada. Remova a trava so depois de conferir.")
            return 5
        trava.write_text(date.today().isoformat())
        from omie_mcp.client import OmieClient
        from omie_mcp.clients import ClientesConfigError, ClientesRegistry

        try:
            registry = ClientesRegistry.load()
            settings = registry.settings_for(args.cliente)
        except ClientesConfigError as exc:
            trava.unlink(missing_ok=True)
            print(f"\nABORTADO: {exc}")
            return 6

        async def _gravar_no_omie():
            async with OmieClient(settings) as client:
                return await eo.gravar(
                    resultados, cfg_escrita, client=client, executar=True,
                    ja_gravadas=ja,
                    # persiste a cada gravacao bem sucedida, nao so no final
                    # do lote — sem isso, uma queda no meio grava em
                    # duplicidade na proxima rodada (achado da validacao
                    # adversarial de 2026-09-20).
                    apos_gravar=lambda _chave: persistir_estado(args.estado, ja),
                )

        rel = asyncio.run(_gravar_no_omie())
        trava.unlink(missing_ok=True)
        # trilha de auditoria: o que foi gravado, com score e evidencias
        auditoria = args.saida.with_name(
            f"auditoria_{args.cliente}_{date.today().isoformat()}.json")
        auditoria.write_text(json.dumps(
            [g.to_dict() for g in rel.executadas + rel.falhas],
            ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nGRAVACAO NO OMIE — {rel.resumo()} | auditoria: {auditoria}")
        for g in rel.falhas:
            print(f"  falha {g.linha_id}: {g.erro}")
    else:
        # dry-run nao chama o client, mas gravar() e async — nao precisa de
        # loop de verdade, so uma forma de rodar a corrotina ate o fim.
        rel = asyncio.run(
            eo.gravar(resultados, cfg_escrita, executar=False, ja_gravadas=ja)
        )
        print(f"\nDRY-RUN — {len(rel.planejadas)} gravacoes seriam feitas "
              f"(nada foi enviado ao Omie)")
        for g in rel.planejadas[:5]:
            print(f"  {g.operacao:<20} linha {g.linha_id} score {g.score}")
        if len(rel.planejadas) > 5:
            print(f"  ... e mais {len(rel.planejadas)-5}")

    # ---- saida para a fila ----
    args.saida.write_text(
        json.dumps(
            {"resultados": [r.to_dict() for r in resultados]},
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    if regras:
        args.regras.write_text(
            json.dumps(regras_para_json(regras), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(f"\nFila gravada em {args.saida} — abra em fila_conciliacao.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
