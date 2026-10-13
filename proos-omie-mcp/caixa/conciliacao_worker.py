"""
Processo do container de conciliacao: consome a fila `conciliacao_execucao`.

O painel insere um pedido 'na_fila' quando o operador sobe um OFX na tela de
Conciliacao Bancaria (o OFX vai em base64 no proprio row). Aqui ele e
processado um de cada vez — resolve credenciais pelo Infisical (empresa_id),
busca titulos e recebimentos ao vivo no Omie (na VPS nao ha snapshots
sombra/{slug}/*.json), roda o motor e grava o resultado no row.

    python -m caixa.conciliacao_worker
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import sys
import time
import traceback
from datetime import date

from omie_mcp import db, infisical
from omie_mcp.client import OmieClient
from omie_mcp.config import OmieSettings
from omie_mcp.conciliacao import (
    Contexto, coletar_linhas_ja_existentes, coletar_recebimentos,
    coletar_titulos_abertos, conciliar, ofx, resumir,
)
from omie_mcp.tools.contas_correntes import (
    ContaBancariaAmbigua, listar_contas_correntes, resolver_conta_por_extrato,
)

from . import conciliacao_config

INTERVALO_S = 15
LIMPEZA_S = 3600
MAX_LOG = 30_000


class _Tee(io.TextIOBase):
    """Escreve no log do container e guarda o texto para conciliacao_execucao.log."""

    def __init__(self) -> None:
        self.buffer_texto = io.StringIO()

    def write(self, texto: str) -> int:
        sys.__stdout__.write(texto)
        sys.__stdout__.flush()
        self.buffer_texto.write(texto)
        return len(texto)

    def valor(self) -> str:
        texto = self.buffer_texto.getvalue()
        return texto if len(texto) <= MAX_LOG else "…\n" + texto[-MAX_LOG:]


def _sql(conn, consulta: str, parametros: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(consulta, parametros)
        return cur.fetchone() if cur.description else None


def marcar_interrompidas(conn) -> None:
    _sql(conn, """
        update public.conciliacao_execucao
        set status = 'erro', concluida_em = now(),
            erro = 'Conciliacao interrompida: o container reiniciou no meio da execucao.'
        where status = 'em_andamento'
    """)


def limpar(conn) -> None:
    _sql(conn, "delete from public.conciliacao_execucao where criada_em < now() - interval '90 days'")


def reivindicar(conn):
    return _sql(conn, """
        update public.conciliacao_execucao
        set status = 'em_andamento', iniciada_em = now(), etapa = 'iniciando'
        where id = (
            select id from public.conciliacao_execucao
            where status = 'na_fila'
            order by id
            limit 1
            for update skip locked
        )
        returning id, empresa_id::text, conta_omie, ofx_b64
    """)


async def _conciliar(empresa_id: str, conta_override: str | None, texto_ofx: str,
                     etapa, log) -> dict:
    """Roda o motor para um extrato e devolve o dict de saida (resultados +
    resumo), no mesmo contrato de conciliar_extrato_painel.py."""
    chave, segredo = infisical.buscar_credenciais_omie(empresa_id)
    settings = OmieSettings.for_cliente(chave, segredo)
    cfg = conciliacao_config.montar_config(empresa_id)
    regras = conciliacao_config.regras_para(empresa_id)

    async with OmieClient(settings) as client:
        etapa("conta")
        if conta_override:
            conta_omie = str(conta_override)
        else:
            bankid, acctid = ofx.identificar_conta_bancaria(texto_ofx)
            contas = await listar_contas_correntes(client)
            conta_omie = resolver_conta_por_extrato(contas, bankid, acctid)

        linhas = ofx.ler_texto(texto_ofx, conta_id=str(conta_omie))
        if not linhas:
            raise ValueError("Nenhuma linha lida do extrato OFX.")
        datas = [l.data for l in linhas]
        desde, ate = min(datas), max(datas)

        etapa("titulos")
        log(f"== Titulos em aberto (CP+CR), {desde} a {ate} ==")
        titulos = await coletar_titulos_abertos(client, desde, ate)
        log(f"   {len(titulos)} titulos")

        etapa("recebimentos")
        recebimentos = await coletar_recebimentos(client, desde, ate)
        log(f"   {len(recebimentos)} recebimentos ja baixados")

        etapa("duplicidade")
        ja_conciliadas = await coletar_linhas_ja_existentes(client, [str(conta_omie)], linhas)

    etapa("motor")
    resultados = conciliar(
        Contexto(linhas=linhas, titulos=titulos, regras=regras,
                 hoje=date.today(), recebimentos=recebimentos,
                 linhas_ja_conciliadas=ja_conciliadas),
        cfg,
    )
    resumo = resumir(resultados)
    return {
        "cliente_slug": conciliacao_config.para_empresa(empresa_id)["slug"] or "",
        "regras_carregadas": len(regras),
        "conta_omie": str(conta_omie),
        "conta_omie_resolvida_automaticamente": not bool(conta_override),
        "titulos_carregados": [
            {"id": t.id, "tipo": t.tipo, "parceiro_nome": t.parceiro_nome,
             "valor": str(t.valor), "vencimento": t.vencimento.isoformat(),
             "numero_documento": t.numero_documento}
            for t in titulos if not t.conciliado
        ],
        "resultados": [r.to_dict() for r in resultados],
        **resumo,
    }


def processar(conn, execucao_id: int, empresa_id: str, conta_omie, ofx_b64: str) -> None:
    tee = _Tee()

    def etapa(nome: str) -> None:
        _sql(conn, "update public.conciliacao_execucao set etapa = %s where id = %s",
             (nome, execucao_id))

    try:
        texto = base64.b64decode(ofx_b64 or "").decode("latin-1", errors="replace")
        with contextlib.redirect_stdout(tee):
            print(f"===== conciliacao #{execucao_id} · empresa {empresa_id} =====")
            saida = asyncio.run(_conciliar(empresa_id, conta_omie, texto, etapa, print))
        _sql(conn, """
            update public.conciliacao_execucao
            set status = 'sucesso', etapa = null, concluida_em = now(),
                conta_omie = %s, resultado = %s, log = %s
            where id = %s
        """, (saida.get("conta_omie"), db.Json(saida), tee.valor(), execucao_id))
    except ContaBancariaAmbigua as erro:
        tee.write(str(erro))
        _sql(conn, """
            update public.conciliacao_execucao
            set status = 'erro', concluida_em = now(), erro = %s, log = %s where id = %s
        """, (str(erro)[:2000], tee.valor(), execucao_id))
    except Exception as erro:  # a fila segue com os outros pedidos
        tee.write(traceback.format_exc())
        _sql(conn, """
            update public.conciliacao_execucao
            set status = 'erro', concluida_em = now(), erro = %s, log = %s where id = %s
        """, (str(erro)[:2000], tee.valor(), execucao_id))


def main() -> int:
    conn = db.conectar()
    marcar_interrompidas(conn)
    ultima_limpeza = 0.0
    print("conciliacao: aguardando pedidos na fila conciliacao_execucao", flush=True)
    while True:
        if time.monotonic() - ultima_limpeza > LIMPEZA_S:
            limpar(conn)
            ultima_limpeza = time.monotonic()
        pedido = reivindicar(conn)
        if pedido is None:
            time.sleep(INTERVALO_S)
            continue
        processar(conn, pedido[0], pedido[1], pedido[2], pedido[3])


if __name__ == "__main__":
    raise SystemExit(main())
