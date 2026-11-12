"""
Processo do container de conciliacao: consome a fila `conciliacao_execucao`.

Duas fases, ambas aqui:
  1. CONCILIACAO (status 'na_fila'): le o OFX, resolve conta, busca titulos e
     recebimentos ao vivo no Omie, roda o motor e grava o RESULTADO no row.
     So leitura — nao toca no Omie.
  2. GRAVACAO (gravacao_status 'na_fila'): so depois que o operador confirma na
     tela. Reroda o motor (estado fresco) e EXECUTA as baixas da faixa
     AUTOMATICA no Omie (LancarRecebimento etc.). Freios: so faixa automatica;
     guarda Omie.CASH fail-closed; teto por rodada; idempotencia pela checagem
     de duplicidade (linha ja conciliada no Omie reroda como duplicidade e e
     pulada); auditoria do que foi escrito no row. Reversivel (desconciliar no
     Omie). Decisao: Rodrigo, 2026-10-20.

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
    ConfigEscrita, Contexto, Desfecho, Faixa, coletar_linhas_ja_existentes,
    coletar_recebimentos, coletar_titulos_abertos, conciliar, gravar as eo_gravar,
    ofx, resumir,
)
from omie_mcp.tools.contas_correntes import (
    ContaBancariaAmbigua, contas_omie_cash, listar_contas_correntes,
    resolver_conta_por_extrato,
)

from . import conciliacao_config, excedentes_worker

INTERVALO_S = 15
LIMPEZA_S = 3600
MAX_LOG = 30_000
# Teto de gravacoes por rodada — freio contra um lote errado. O operador
# confirma um lote que viu; isto e um backstop, nao o limite esperado.
MAX_GRAVACOES = 200


class _Tee(io.TextIOBase):
    """Escreve no log do container e guarda o texto para o row."""

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
    _sql(conn, """
        update public.conciliacao_execucao
        set gravacao_status = 'erro', gravacao_concluida_em = now(),
            gravacao_log = coalesce(gravacao_log, '') ||
                '\nGravacao interrompida: o container reiniciou no meio.'
        where gravacao_status = 'em_andamento'
    """)


def limpar(conn) -> None:
    _sql(conn, "delete from public.conciliacao_execucao where criada_em < now() - interval '90 days'")


# --------------------------- fase 1: conciliacao --------------------------- #

def reivindicar(conn):
    return _sql(conn, """
        update public.conciliacao_execucao
        set status = 'em_andamento', iniciada_em = now(), etapa = 'iniciando'
        where id = (
            select id from public.conciliacao_execucao
            where status = 'na_fila'
            order by id limit 1 for update skip locked
        )
        returning id, empresa_id::text, conta_omie, ofx_b64
    """)


async def _rodar_motor(client, empresa_id, conta_override, texto_ofx, etapa, log):
    """Fetch (conta + titulos + recebimentos + duplicidade) ao vivo e roda o
    motor. Recebe um OmieClient JA aberto. Devolve (resultados, conta_omie,
    titulos). Compartilhado pela conciliacao (leitura) e pela gravacao."""
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
        Contexto(linhas=linhas, titulos=titulos,
                 regras=conciliacao_config.regras_para(empresa_id),
                 hoje=date.today(), recebimentos=recebimentos,
                 linhas_ja_conciliadas=ja_conciliadas),
        conciliacao_config.montar_config(empresa_id),
    )
    return resultados, str(conta_omie), titulos


async def _conciliar(empresa_id, conta_override, texto_ofx, etapa, log) -> dict:
    """Roda o motor (so leitura) e devolve o dict de saida (resultados+resumo)."""
    chave, segredo = infisical.buscar_credenciais_omie(empresa_id)
    async with OmieClient(OmieSettings.for_cliente(chave, segredo)) as client:
        resultados, conta_omie, titulos = await _rodar_motor(
            client, empresa_id, conta_override, texto_ofx, etapa, log)
    resumo = resumir(resultados)
    return {
        "cliente_slug": conciliacao_config.para_empresa(empresa_id)["slug"] or "",
        "regras_carregadas": len(conciliacao_config.regras_para(empresa_id)),
        "conta_omie": conta_omie,
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


def processar(conn, execucao_id, empresa_id, conta_omie, ofx_b64) -> None:
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
                conta_omie = %s, resultado = %s, log = %s where id = %s
        """, (saida.get("conta_omie"), db.Json(saida), tee.valor(), execucao_id))
    except Exception as erro:  # a fila segue com os outros pedidos
        # ContaBancariaAmbigua ja tem mensagem legivel; o resto leva o traceback.
        tee.write(str(erro) if isinstance(erro, ContaBancariaAmbigua) else traceback.format_exc())
        _sql(conn, """
            update public.conciliacao_execucao
            set status = 'erro', concluida_em = now(), erro = %s, log = %s where id = %s
        """, (str(erro)[:2000], tee.valor(), execucao_id))


# ---------------------------- fase 2: gravacao ----------------------------- #

def reivindicar_gravacao(conn):
    return _sql(conn, """
        update public.conciliacao_execucao
        set gravacao_status = 'em_andamento'
        where id = (
            select id from public.conciliacao_execucao
            where gravacao_status = 'na_fila'
            order by id limit 1 for update skip locked
        )
        returning id, empresa_id::text, conta_omie, ofx_b64
    """)


async def _gravar(empresa_id, conta_override, texto_ofx, etapa, log) -> dict:
    """Reroda o motor e EXECUTA as baixas da faixa automatica no Omie."""
    chave, segredo = infisical.buscar_credenciais_omie(empresa_id)
    async with OmieClient(OmieSettings.for_cliente(chave, segredo)) as client:
        resultados, conta_omie, _ = await _rodar_motor(
            client, empresa_id, conta_override, texto_ofx, etapa, log)

        # Guarda Omie.CASH fail-closed: conta conciliada pelo proprio Omie
        # nunca deve receber baixa nossa.
        etapa("conferindo conta")
        cash = await contas_omie_cash(client)
        if conta_omie.isdigit() and int(conta_omie) in cash:
            raise ValueError(
                f"Conta {conta_omie} e Omie.CASH (conciliada pelo proprio Omie) "
                "— gravacao bloqueada.")

        planejadas = sum(
            1 for r in resultados
            if r.faixa is Faixa.AUTOMATICO and r.desfecho is not Desfecho.FILA
        )
        if planejadas > MAX_GRAVACOES:
            raise ValueError(
                f"{planejadas} gravacoes passam do teto de {MAX_GRAVACOES} por "
                "rodada — revise o lote.")

        etapa("gravando")
        log(f"== Gravando {planejadas} lancamento(s) da faixa automatica ==")
        cfg_escrita = ConfigEscrita(conta_corrente_omie=conta_omie)
        rel = await eo_gravar(
            resultados, cfg_escrita, client=client, executar=True,
            apenas_automaticas=True,
        )
        log(f"== {rel.resumo()} ==")
        for g in rel.falhas:
            log(f"   falha {g.linha_id}: {g.erro}")

    return {
        "conta_omie": conta_omie,
        "planejadas": len(rel.planejadas),
        "executadas": len(rel.executadas),
        "puladas": len(rel.puladas),
        "falhas": len(rel.falhas),
        "itens": [g.to_dict() for g in rel.executadas + rel.falhas],
    }


def processar_gravacao(conn, execucao_id, empresa_id, conta_omie, ofx_b64) -> None:
    tee = _Tee()

    def etapa(nome: str) -> None:
        _sql(conn, "update public.conciliacao_execucao set etapa = %s where id = %s",
             (f"gravacao: {nome}", execucao_id))

    try:
        texto = base64.b64decode(ofx_b64 or "").decode("latin-1", errors="replace")
        with contextlib.redirect_stdout(tee):
            print(f"===== GRAVACAO #{execucao_id} · empresa {empresa_id} =====")
            audit = asyncio.run(_gravar(empresa_id, conta_omie, texto, etapa, print))
        _sql(conn, """
            update public.conciliacao_execucao
            set gravacao_status = 'sucesso', etapa = null, gravacao_concluida_em = now(),
                gravacao_resultado = %s, gravacao_log = %s where id = %s
        """, (db.Json(audit), tee.valor(), execucao_id))
    except Exception as erro:
        tee.write(traceback.format_exc())
        _sql(conn, """
            update public.conciliacao_execucao
            set gravacao_status = 'erro', gravacao_concluida_em = now(),
                gravacao_log = %s where id = %s
        """, (str(erro)[:2000] + "\n\n" + tee.valor(), execucao_id))


def main() -> int:
    conn = db.conectar()
    marcar_interrompidas(conn)
    excedentes_worker.marcar_interrompidas(conn)
    ultima_limpeza = 0.0
    print("conciliacao: aguardando pedidos (conciliacao, gravacao e excedentes)", flush=True)
    while True:
        if time.monotonic() - ultima_limpeza > LIMPEZA_S:
            limpar(conn)
            ultima_limpeza = time.monotonic()
        # Gravacao tem prioridade: e uma acao que o operador ja confirmou.
        pedido_g = reivindicar_gravacao(conn)
        if pedido_g is not None:
            processar_gravacao(conn, pedido_g[0], pedido_g[1], pedido_g[2], pedido_g[3])
            continue
        pedido = reivindicar(conn)
        if pedido is not None:
            processar(conn, pedido[0], pedido[1], pedido[2], pedido[3])
            continue
        # Excedentes (plano e criacao) dividem este container de proposito:
        # a VPS nao tem folga de memoria para mais um servico.
        if excedentes_worker.rodar_uma_vez(conn):
            continue
        time.sleep(INTERVALO_S)


if __name__ == "__main__":
    raise SystemExit(main())
