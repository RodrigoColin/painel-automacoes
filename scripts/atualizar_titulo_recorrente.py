"""Ajusta o valor de um titulo recorrente que AINDA NAO venceu — pra quando
o valor real de uma guia muda todo mes (ex.: Simples Nacional/DAS, percentual
sobre faturamento) e o Omie ja pre-criou a parcela do mes seguinte com o
valor antigo (assim que uma "despesa recorrente" e configurada, o Omie cria
as parcelas futuras todas com o mesmo valor da configuracao original).

NAO existe hoje nenhuma fila conectada que avise quando o operador confirma
uma decisao — `fila_conciliacao.html` e so um visualizador estatico, sem
backend (ver investigacao de 2026-09-21). Por isso este e um comando manual,
explicito, rodado depois que o operador ja identificou visualmente qual
titulo era a guia real deste mes:

    python scripts/atualizar_titulo_recorrente.py --cliente proos \\
        --titulos sombra/titulos.json \\
        --titulo-referencia 123456 --valor-confirmado 3412.50 \\
        --motivo "DAS de setembro/2026, confirmado no extrato"

Por padrao e dry-run (so mostra o plano). Pra gravar de verdade:

    ... --gravar --confirmo-escrita proos

AlterarContaPagar/AlterarContaReceber e o campo de valor (`valor_documento`)
estao confirmados na doc oficial do Omie (2026-09-21). O que ainda NAO esta
confirmado e se a chamada faz merge (so muda o que foi enviado) ou
substituicao total do registro — ver o comentario no topo de
`omie_mcp/conciliacao/escrita_omie.py`. Recomendado testar `--gravar`
primeiro contra um titulo de baixo risco, nao direto no titulo real da
recorrencia, ate confirmar isso ao vivo.
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

from omie_mcp.conciliacao.modelos import Titulo  # noqa: E402
from omie_mcp.conciliacao.recorrencia import (  # noqa: E402
    AmbiguidadeRecorrencia, localizar_titulo_recorrente_seguinte,
)
from omie_mcp.conciliacao import escrita_omie as eo  # noqa: E402


def carregar_titulos(caminho: Path) -> list[Titulo]:
    """Mesmo formato/shape de scripts/conciliar.py::carregar_titulos —
    duplicado aqui de proposito (cada script deste repo e standalone, sem
    imports cruzados entre scripts/, ver modo_sombra.py pro mesmo padrao)."""
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


def _mes_de(texto: str) -> tuple[int, int]:
    ano, mes = texto.split("-")
    return int(ano), int(mes)


def _ler_auditoria(caminho: Path) -> list[dict]:
    if not caminho.exists():
        return []
    return json.loads(caminho.read_text(encoding="utf-8"))


def _gravar_auditoria(caminho: Path, registros: list[dict]) -> None:
    tmp = caminho.with_suffix(caminho.suffix + ".tmp")
    tmp.write_text(json.dumps(registros, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(caminho)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cliente", required=True)
    ap.add_argument("--titulos", type=Path, required=True)
    ap.add_argument("--titulo-referencia", required=True,
                     help="id do titulo que ancora a busca (o titulo deste mes, "
                          "batido ou nao — ver docstring do modulo)")
    ap.add_argument("--valor-confirmado", type=Decimal, required=True,
                     help="valor real da guia/extrato deste mes")
    ap.add_argument("--mes-alvo", default=None,
                     help="AAAA-MM do titulo a atualizar; padrao = mes seguinte "
                          "ao vencimento do --titulo-referencia")
    ap.add_argument("--titulo-destino", default=None,
                     help="pula a heuristica e aponta o titulo certo direto "
                          "(obrigatorio se a busca automatica achar ambiguidade)")
    ap.add_argument("--motivo", required=True, help="qual guia e por que, pra auditoria")
    ap.add_argument("--gravar", action="store_true")
    ap.add_argument("--confirmo-escrita", default="")
    ap.add_argument("--auditoria", type=Path, default=Path("auditoria_valor_recorrente.json"))
    args = ap.parse_args()

    titulos = carregar_titulos(args.titulos)
    por_id = {t.id: t for t in titulos}

    referencia = por_id.get(args.titulo_referencia)
    if referencia is None:
        print(f"\nABORTADO: titulo --titulo-referencia={args.titulo_referencia} "
              f"nao encontrado em {args.titulos}.")
        return 1

    if args.titulo_destino:
        destino = por_id.get(args.titulo_destino)
        if destino is None:
            print(f"\nABORTADO: --titulo-destino={args.titulo_destino} "
                  f"nao encontrado em {args.titulos}.")
            return 1
        if destino.conciliado:
            print(f"\nABORTADO: --titulo-destino={args.titulo_destino} ja esta conciliado.")
            return 1
    else:
        mes_alvo = _mes_de(args.mes_alvo) if args.mes_alvo else None
        try:
            destino = localizar_titulo_recorrente_seguinte(referencia, titulos, mes_alvo)
        except AmbiguidadeRecorrencia as exc:
            print(f"\nABORTADO: {exc}")
            return 2

    print(
        f"\nPLANO: titulo {destino.id} ({destino.parceiro_nome}, categoria "
        f"{destino.categoria}, vencimento {destino.vencimento.isoformat()})\n"
        f"  valor cadastrado hoje: {destino.valor}\n"
        f"  valor novo (confirmado): {args.valor_confirmado}\n"
        f"  motivo: {args.motivo}"
    )

    if not args.gravar:
        print("\nDRY-RUN — nada foi enviado ao Omie. Use --gravar --confirmo-escrita "
              f"{args.cliente} pra aplicar de verdade.")
        return 0

    if args.confirmo_escrita != args.cliente:
        print("\nABORTADO: --gravar exige --confirmo-escrita <slug do cliente>.")
        return 3

    auditoria = _ler_auditoria(args.auditoria)
    ja_feito = [
        a for a in auditoria
        if a.get("titulo_id") == destino.id and a.get("valor_depois") == str(args.valor_confirmado)
    ]
    if ja_feito:
        print(f"\nABORTADO: ja existe um registro de auditoria pra titulo {destino.id} "
              f"com esse mesmo valor novo ({args.valor_confirmado}) — provavel repeticao "
              "acidental do comando. Apague o registro em --auditoria se a intencao "
              "e mesmo repetir.")
        return 4

    from omie_mcp.client import OmieClient
    from omie_mcp.clients import ClientesConfigError, ClientesRegistry
    from omie_mcp.tools import contas_pagar, contas_receber

    try:
        registry = ClientesRegistry.load()
        settings = registry.settings_for(args.cliente)
    except ClientesConfigError as exc:
        print(f"\nABORTADO: {exc}")
        return 5

    async def _rodar():
        async with OmieClient(settings) as client:
            if destino.tipo == "CP":
                registro = await contas_pagar.consultar_conta_pagar(client, int(destino.id))
            else:
                registro = await contas_receber.consultar_conta_receber(client, int(destino.id))
            registro = dict(registro)
            registro["tipo_registro"] = destino.tipo

            valor_ao_vivo = registro.get("valor_documento") or registro.get("nValorTitulo")
            if valor_ao_vivo is not None and Decimal(str(valor_ao_vivo)) != destino.valor:
                raise RuntimeError(
                    f"snapshot desatualizado: {args.titulos} diz valor {destino.valor}, "
                    f"mas o Omie ao vivo diz {valor_ao_vivo}. Rode "
                    "scripts/exportar_base_sombra.py de novo antes de continuar."
                )

            plano = eo.planejar_atualizacao_valor_titulo(
                registro, args.valor_confirmado, args.motivo
            )
            return await eo.executar_atualizacao_valor(plano, client, executar=True)

    try:
        resultado = asyncio.run(_rodar())
    except Exception as exc:  # noqa: BLE001 — precisa aparecer pro operador, nao sumir
        print(f"\nABORTADO: {exc}")
        return 6

    auditoria.append(resultado.to_dict())
    _gravar_auditoria(args.auditoria, auditoria)

    if resultado.erro:
        print(f"\nFALHA: {resultado.erro}")
        return 7

    print(f"\nOK — titulo {resultado.titulo_id}: {resultado.valor_antes} -> "
          f"{resultado.valor_depois} (id_omie={resultado.id_omie}). "
          f"Auditoria: {args.auditoria}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
