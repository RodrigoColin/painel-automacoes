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
    Config, Contexto, Desfecho, Faixa, Titulo, conciliar,
    regras_de_json, regras_para_json,
)
from omie_mcp.conciliacao import escrita_omie as eo  # noqa: E402
from omie_mcp.conciliacao import ofx  # noqa: E402


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
    ap.add_argument("--conta-omie", required=True, help="nCodCC da conta")
    ap.add_argument("--ofx", required=True, type=Path, nargs="+",
                    help="um ou mais extratos (varias contas no mesmo lote)")
    ap.add_argument("--banco", default=None)
    ap.add_argument("--titulos", required=True, type=Path)
    ap.add_argument("--regras", type=Path, default=Path("regras.json"))
    ap.add_argument("--estado", type=Path, default=Path("gravadas.json"),
                    help="chaves de idempotencia ja gravadas no ERP")
    ap.add_argument("--saida", type=Path, default=Path("fila.json"))
    ap.add_argument("--categoria-padrao", default="")
    ap.add_argument("--conta-investimento", default=None)
    ap.add_argument("--corte-automatico", type=int, default=90)
    ap.add_argument("--corte-revisao", type=int, default=60)
    ap.add_argument("--dias-antes", type=int, default=Config().dias_antes,
                     help="quantos dias ANTES do vencimento uma linha ainda casa com o "
                          "titulo — clientes que antecipam pagamento (ex.: Proos) "
                          "precisam de um numero maior que o padrao")
    ap.add_argument("--dias-depois", type=int, default=Config().dias_depois,
                     help="quantos dias DEPOIS do vencimento uma linha ainda casa com o titulo")
    ap.add_argument("--gravar", action="store_true",
                    help="grava no Omie a faixa automatica (padrao: dry-run)")
    ap.add_argument("--confirmo-escrita", default="",
                    help="repita o slug do cliente para liberar --gravar "
                         "(segunda confirmacao, evita gravar no cliente errado)")
    ap.add_argument("--max-gravacoes", type=int, default=200,
                    help="teto de gravacoes por rodada (freio contra lote errado)")
    args = ap.parse_args()

    # ---- entrada ----
    linhas = []
    for caminho in args.ofx:
        conta = args.conta_omie if len(args.ofx) == 1 else caminho.stem
        lidas = ofx.ler_arquivo(caminho, conta_id=conta, banco=args.banco)
        linhas.extend(lidas)
        saldo = ofx.saldo_final(caminho.read_text(encoding="latin-1", errors="replace"))
        print(f"{caminho.name}: {len(lidas)} linhas"
              + (f" | saldo {saldo[1]} em {saldo[0]}" if saldo else ""))

    titulos = carregar_titulos(args.titulos)
    regras = (
        regras_de_json(json.loads(args.regras.read_text(encoding="utf-8")))
        if args.regras.exists() else []
    )
    print(f"\n{len(linhas)} linhas | {len(titulos)} titulos | {len(regras)} regras")

    # ---- motor ----
    cfg = Config(
        corte_automatico=args.corte_automatico,
        corte_revisao=args.corte_revisao,
        dias_antes=args.dias_antes,
        dias_depois=args.dias_depois,
    )
    contas_inv = (
        {args.conta_omie: args.conta_investimento}
        if args.conta_investimento else {}
    )
    resultados = conciliar(
        Contexto(linhas=linhas, titulos=titulos, regras=regras,
                 contas_investimento=contas_inv),
        cfg,
    )

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
    )
    ja = set(
        json.loads(args.estado.read_text(encoding="utf-8"))
        if args.estado.exists() else []
    )

    if args.gravar:
        if args.confirmo_escrita != args.cliente:
            print("\nABORTADO: --gravar exige --confirmo-escrita <slug do cliente>.")
            return 3
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
