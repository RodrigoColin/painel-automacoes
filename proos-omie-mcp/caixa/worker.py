"""
Processo do container `caixa`: consome a fila `caixa_execucao`.

O painel só insere pedidos 'na_fila' (cron das 10h e 16h para todas as
empresas com Omie configurado; botão "Atualizar agora" para uma). Aqui eles
são processados um de cada vez — a VPS tem 2 GB e cada rodada chama o Omie
por vários minutos.

    python -m caixa.worker
"""

from __future__ import annotations

import contextlib
import io
import sys
import time
import traceback
from datetime import date

from omie_mcp import db

from . import rodada

INTERVALO_S = 15
LIMPEZA_S = 3600
MAX_LOG = 30_000


class _Tee(io.TextIOBase):
    """Escreve no log do container e guarda o texto para caixa_execucao.log."""

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
    """Rodada 'em_andamento' na subida do processo morreu no meio."""
    _sql(conn, """
        update public.caixa_execucao
        set status = 'erro', concluida_em = now(),
            erro = 'Rodada interrompida: o container reiniciou no meio da execução.'
        where status = 'em_andamento'
    """)


def limpar(conn) -> None:
    _sql(conn, "delete from public.caixa_execucao where criada_em < now() - interval '90 days'")
    # Bases brutas só nos últimos 30 dias; a tela usa extrato/extra/checagem.
    _sql(conn, """
        update public.caixa_pacote_diario
        set recebimentos = '[]', pagamentos = '[]', receber_aberto = '[]', pagar_aberto = '[]',
            contratos_nao_faturados = '[]', os_nao_faturadas = '[]', status_contratos = '[]'
        where data < current_date - 30 and recebimentos <> '[]'::jsonb
    """)


def reivindicar(conn):
    return _sql(conn, """
        update public.caixa_execucao
        set status = 'em_andamento', iniciada_em = now(), etapa = 'iniciando'
        where id = (
            select id from public.caixa_execucao
            where status = 'na_fila'
            order by id
            limit 1
            for update skip locked
        )
        returning id, empresa_id::text
    """)


def processar(conn, execucao_id: int, empresa_id: str) -> None:
    tee = _Tee()

    def etapa(nome: str) -> None:
        _sql(conn, "update public.caixa_execucao set etapa = %s where id = %s", (nome, execucao_id))

    try:
        with contextlib.redirect_stdout(tee):
            print(f"===== rodada #{execucao_id} · empresa {empresa_id} =====")
            avisos = rodada.executar(conn, empresa_id, etapa=etapa, log=print)
        _sql(conn, """
            update public.caixa_execucao
            set status = 'sucesso', etapa = null, concluida_em = now(), avisos = %s, log = %s
            where id = %s
        """, (db.Json(avisos), tee.valor(), execucao_id))
    except Exception as erro:  # a fila segue com as outras empresas
        tee.write(traceback.format_exc())
        _sql(conn, """
            update public.caixa_execucao
            set status = 'erro', concluida_em = now(), erro = %s, log = %s
            where id = %s
        """, (str(erro)[:2000], tee.valor(), execucao_id))

    # Pedidos da mesma empresa que entraram enquanto esta rodava já estão cobertos.
    _sql(conn, """
        update public.caixa_execucao
        set status = 'sucesso', concluida_em = now(), etapa = null,
            log = 'Coberto pela rodada #' || %s::text
        where empresa_id = %s and status = 'na_fila'
          and criada_em <= (select iniciada_em from public.caixa_execucao where id = %s)
    """, (execucao_id, empresa_id, execucao_id))


def processar_variacoes(conn) -> None:
    """Variação (ponte) sob demanda: calcula os pedidos de caixa_variacao_dia.

    É barato (lê dois `extra` do banco e roda caixa/variacao.py — sem Omie),
    então roda a cada volta do loop. Limitação aceita: enquanto uma RODADA
    longa estiver em andamento, os pedidos esperam ela terminar (a UI avisa).
    """
    from caixa.variacao import variacao_para_refs

    for empresa_id, data_base in db.reivindicar_variacoes_dia(conn):
        try:
            atual = db.ler_extra_pacote_por_data(conn, empresa_id, date.max)
            if not atual:
                raise RuntimeError("Sem pacote atual para comparar.")
            data_pacote, extra_atual = atual
            base = db.ler_extra_pacote_por_data(conn, empresa_id, data_base)
            if not base or base[0] != data_base:
                raise RuntimeError(f"Sem pacote gravado em {data_base.isoformat()}.")
            mes_cur = (extra_atual.get("ref") or data_pacote.isoformat())[:7]
            out = variacao_para_refs(
                extra_atual, mes_cur,
                [{"rotulo": "livre", "data": data_base.isoformat(), "extra": base[1]}],
            ).get("livre")
            if not out:
                raise RuntimeError("Motor de variação não devolveu resultado.")
            db.gravar_variacao_dia(conn, empresa_id, data_base, "pronta",
                                   data_pacote=data_pacote, resultado=out)
            print(f"variação sob demanda: {empresa_id} desde {data_base} pronta.", flush=True)
        except Exception as erro:
            db.gravar_variacao_dia(conn, empresa_id, data_base, "erro", erro=str(erro)[:2000])
            print(f"variação sob demanda: {empresa_id} desde {data_base} ERRO: {erro}", flush=True)


def main() -> int:
    conn = db.conectar()
    marcar_interrompidas(conn)
    ultima_limpeza = 0.0
    print("caixa: aguardando pedidos na fila caixa_execucao", flush=True)
    while True:
        if time.monotonic() - ultima_limpeza > LIMPEZA_S:
            limpar(conn)
            ultima_limpeza = time.monotonic()
        processar_variacoes(conn)
        pedido = reivindicar(conn)
        if pedido is None:
            time.sleep(INTERVALO_S)
            continue
        processar(conn, pedido[0], pedido[1])


if __name__ == "__main__":
    raise SystemExit(main())
