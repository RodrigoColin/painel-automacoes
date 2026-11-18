"""
Fila de excedentes (`excedentes_lote`) — roda DENTRO do container de
conciliação (ver conciliacao_worker.main), sem container novo: a VPS tem
2 GB e os serviços existentes já ocupam ~1,5 GB.

Duas fases, como na conciliação:
  1. PLANEJAR (status 'na_fila'): lê a planilha do row, resolve tudo no
     Omie (SÓ leitura), grava uma linha por item em `excedentes_linha` e
     deixa o lote em 'aguardando_aprovacao'.
  2. CRIAR (status 'aprovado'): só depois que o analista aprovou na tela.
     Agrupa as linhas ok/resolvidas por cCodIntOS, cria as OSs no Omie em
     lotes de 4, na etapa 50 (Faturar) — NUNCA fatura. Idempotência por
     cCodIntOS (pré-checagem + recusa de duplicado tratada como
     'ja_existia').
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import traceback
from datetime import date
from decimal import Decimal

from omie_mcp import db, infisical
from omie_mcp.client import OmieClient
from omie_mcp.config import OmieSettings
from omie_mcp.excedentes import criacao, depara, planilha as planilha_mod, plano as plano_mod
from omie_mcp.excedentes.resolucao import FonteOmie
from omie_mcp.excedentes.vencimento import somar_dias_uteis

MAX_LOG = 30_000
# Backstop contra lote absurdo (o analista aprova o que viu na tela;
# novembro real tem ~60 OSs).
MAX_OS_POR_LOTE = 300


def _sql(conn, consulta: str, parametros: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(consulta, parametros)
        return cur.fetchone() if cur.description else None


def _sql_all(conn, consulta: str, parametros: tuple = ()):
    with conn.cursor() as cur:
        cur.execute(consulta, parametros)
        return cur.fetchall()


def marcar_interrompidas(conn) -> None:
    _sql(conn, """
        update public.excedentes_lote
        set status = 'erro', concluido_em = now(),
            erro = 'Processamento interrompido: o container reiniciou no meio.'
        where status in ('planejando', 'criando')
    """)


# ----------------------------- fase 1: planejar ---------------------------- #

def reivindicar_plano(conn):
    return _sql(conn, """
        update public.excedentes_lote
        set status = 'planejando', etapa = 'iniciando'
        where id = (
            select id from public.excedentes_lote
            where status = 'na_fila'
            order by id limit 1 for update skip locked
        )
        returning id, empresa_id::text, competencia, planilha_b64
    """)


async def _planejar(conn, empresa_id: str, competencia: str,
                    conteudo: bytes, etapa) -> plano_mod.Plano:
    lida = planilha_mod.ler(conteudo)
    if lida.erros_estrutura:
        raise ValueError("Planilha inválida: " + " ".join(lida.erros_estrutura))
    mapa = depara.carregar(conn, empresa_id)
    if not mapa:
        raise ValueError(
            "De/Para de serviços vazio para esta empresa — importe o "
            "De Para antes de processar a planilha.")
    chave, segredo = infisical.buscar_credenciais_omie(empresa_id)
    async with OmieClient(OmieSettings.for_cliente(chave, segredo)) as client:
        fonte = FonteOmie(client)
        return await plano_mod.montar(
            fonte, lida, mapa, competencia, etapa=etapa)


def _gravar_linhas(conn, lote_id: int, empresa_id: str,
                   plano: plano_mod.Plano) -> None:
    _sql(conn, "delete from public.excedentes_linha where lote_id = %s", (lote_id,))
    for l in plano.linhas:
        o = l.origem
        _sql(conn, """
            insert into public.excedentes_linha (
                lote_id, empresa_id, linha_planilha, cliente, cnpj, descricao,
                cod_recorrente, categoria_plan, liquido, franquia, consumo,
                excedentes, valor_unit, valor_total,
                n_cod_cli, numero_contrato, n_cod_ctr,
                cod_excedente, n_cod_serv, desc_excedente, categoria,
                n_cod_cc, cidade_prest, venc_contrato, venc_final, regra_venc,
                email_envio, status, avisos, excecao_motivo,
                c_cod_int_os, n_cod_os, numero_os,
                forma_faturamento, n_dia_fat, contrato_acao, contrato_valor_atual,
                contratos_candidatos
            ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                      %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                      %s,%s,%s,%s,%s)
        """, (
            lote_id, empresa_id, o.linha, o.cliente, o.cnpj, o.descricao,
            o.cod_servico, o.categoria, o.liquido, o.franquia, o.consumo,
            o.excedentes, o.valor_unit, o.valor_total,
            l.n_cod_cli, l.numero_contrato, l.n_cod_ctr,
            l.cod_excedente, l.n_cod_serv, l.desc_excedente, l.categoria,
            l.n_cod_cc, l.cidade_prest, l.venc_contrato, l.venc_final,
            l.regra_venc, l.email_envio, l.status,
            db.Json(l.avisos) if l.avisos else None, l.excecao_motivo,
            l.codigo_int_os, l.os_existente_n_cod, l.os_existente_numero,
            l.forma_faturamento, l.n_dia_fat, l.contrato_acao,
            l.contrato_valor_atual,
            db.Json(l.candidatos_detalhe) if l.candidatos_detalhe else None,
        ))


def processar_plano(conn, lote_id: int, empresa_id: str,
                    competencia: str, planilha_b64: str) -> None:
    log_linhas: list[str] = []

    def log(texto: str) -> None:
        print(texto, flush=True)
        log_linhas.append(texto)

    def etapa(nome: str) -> None:
        _sql(conn, "update public.excedentes_lote set etapa = %s where id = %s",
             (nome, lote_id))

    try:
        log(f"===== excedentes plano #{lote_id} · empresa {empresa_id} · {competencia} =====")
        conteudo = base64.b64decode(planilha_b64 or "")
        plano = asyncio.run(_planejar(conn, empresa_id, competencia, conteudo, etapa))
        _gravar_linhas(conn, lote_id, empresa_id, plano)
        resumo = plano.resumo()
        log(f"plano: {resumo}")
        _sql(conn, """
            update public.excedentes_lote
            set status = 'aguardando_aprovacao', etapa = null,
                planejado_em = now(), resumo = %s, log = %s, erro = null
            where id = %s
        """, (db.Json(resumo), "\n".join(log_linhas)[-MAX_LOG:], lote_id))
    except Exception as erro:  # a fila segue com os outros lotes
        log(traceback.format_exc())
        _sql(conn, """
            update public.excedentes_lote
            set status = 'erro', etapa = null, concluido_em = now(),
                erro = %s, log = %s
            where id = %s
        """, (str(erro)[:2000], "\n".join(log_linhas)[-MAX_LOG:], lote_id))


# ------------------------------ fase 2: criar ------------------------------ #

def reivindicar_criacao(conn):
    return _sql(conn, """
        update public.excedentes_lote
        set status = 'criando', etapa = 'iniciando'
        where id = (
            select id from public.excedentes_lote
            where status = 'aprovado'
            order by id limit 1 for update skip locked
        )
        returning id, empresa_id::text, competencia
    """)


def _normalizar_selecao(bruto) -> dict | None:
    """Seleção do analista gravada na aprovação (resumo->'selecao'):
    {"oss": [cCodIntOS...], "contratos": [nCodCtr...]}. Ausente ou malformada
    = criar tudo (lotes aprovados antes da tela de seleção). Lista vazia é
    seleção válida: nada daquela forma é criado."""
    if not isinstance(bruto, dict):
        return None

    def lista(chave, conv):
        v = bruto.get(chave)
        if not isinstance(v, list):
            return None
        try:
            return [conv(x) for x in v]
        except (TypeError, ValueError):
            return None

    return {"oss": lista("oss", str), "contratos": lista("contratos", int)}


def _carregar_selecao(conn, lote_id: int) -> dict | None:
    row = _sql(conn, """
        select resumo->'selecao' from public.excedentes_lote where id = %s
    """, (lote_id,))
    return _normalizar_selecao(row[0] if row else None)


def _dec(v) -> Decimal:
    return v if isinstance(v, Decimal) else Decimal(str(v))


async def _completar_lacunas(fonte: FonteOmie, linhas: list[list],
                             competencia: str, hoje: date, log) -> None:
    """Linha resolvida na fila de exceções pode ter saído do plano sem
    vencimento/e-mail (o plano pula os detalhes de quem era exceção).
    Completa ao vivo: contrato → ConsultarContrato; sem contrato →
    hoje+3 dias úteis e e-mail do cadastro do cliente."""
    from omie_mcp.excedentes import vencimento as venc_mod

    comp = (int(competencia[:4]), int(competencia[4:6]))
    for linha in linhas:
        n_cod_ctr, venc_final, email = linha[4], linha[9], linha[10]
        if venc_final and email:
            continue
        if n_cod_ctr:
            det = await fonte.consultar_contrato(int(n_cod_ctr))
            if not venc_final:
                linha[9] = venc_mod.calcular(
                    hoje, comp, venc_mod.regra_efetiva(det.regra_venc)).data
            if not email:
                linha[10] = det.email_envio or None
            log(f"   linha {linha[1]}: detalhes completados pelo contrato {linha[3]}")
        else:
            if not venc_final:
                linha[9] = somar_dias_uteis(hoje, 3)
            if not email and linha[2]:
                cliente = await fonte.consultar_cliente(int(linha[2]))
                linha[10] = cliente.email or None
            log(f"   linha {linha[1]}: sem contrato → venc hoje+3 úteis, e-mail do cliente")


def _montar_oss(linhas: list[list], hoje: date,
                n_cod_cc_padrao: int | None) -> list[criacao.OsParaCriar]:
    """Agrupa linhas ok/resolvidas por cCodIntOS. Linha sem contrato
    (resolvida pelo analista) usa hoje+3 dias úteis e o e-mail do cliente,
    já gravados na resolução, e o nCodCC padrão da empresa (o Omie exige
    nCodCC na inclusão e OS sem contrato não herda de lugar nenhum)."""
    grupos: dict[str, list[tuple]] = {}
    for linha in linhas:
        codigo = linha[14]  # c_cod_int_os
        if not codigo:
            raise ValueError(
                f"Linha {linha[0]} aprovada sem cCodIntOS — resolução incompleta.")
        grupos.setdefault(codigo, []).append(linha)

    oss: list[criacao.OsParaCriar] = []
    for codigo, grupo in grupos.items():
        (linha_id, _lp, n_cod_cli, numero_contrato, n_cod_ctr, n_cod_serv,
         categoria, n_cod_cc, cidade_prest, venc_final, email_envio,
         valor_total, _st, _res, _cod) = grupo[0]
        if not n_cod_cli:
            raise ValueError(f"Linha {linha_id} sem nCodCli — resolução incompleta.")
        venc = venc_final or somar_dias_uteis(hoje, 3)
        # nCodCC: do contrato quando há; senão o padrão da empresa. Sem nenhum
        # dos dois, o Omie recusa a inclusão — falha explícita e cedo.
        cc = int(n_cod_cc) if n_cod_cc else n_cod_cc_padrao
        if not cc:
            raise ValueError(
                f"Linha {linha_id} (OS {codigo}) sem nCodCC e sem conta padrão "
                "configurada para a empresa (excedentes_config.n_cod_cc_padrao). "
                "O Omie exige conta corrente na inclusão.")
        itens = []
        for g in grupo:
            if not g[5]:
                raise ValueError(f"Linha {g[0]} sem serviço excedente.")
            itens.append(criacao.ItemOS(
                linha_id=g[0], n_cod_servico=int(g[5]),
                valor_total=_dec(g[11]), categoria=g[6]))
        oss.append(criacao.OsParaCriar(
            c_cod_int_os=codigo,
            n_cod_cli=int(n_cod_cli),
            n_cod_ctr=int(n_cod_ctr) if n_cod_ctr else None,
            numero_contrato=numero_contrato if n_cod_ctr else None,
            categoria=categoria,
            n_cod_cc=cc,
            cidade_prest=cidade_prest,
            vencimento=venc,
            # dDtPrevisao = dia da criação (confirmado nas OSs reais de nov).
            previsao=hoje,
            email_envio=email_envio or None,
            itens=itens,
        ))
    return oss


async def _criar(empresa_id: str, linhas: list[list], competencia: str,
                 hoje: date, n_cod_cc_padrao: int | None,
                 log, ao_progresso=None) -> list[criacao.ResultadoCriacao]:
    chave, segredo = infisical.buscar_credenciais_omie(empresa_id)
    async with OmieClient(OmieSettings.for_cliente(chave, segredo)) as client:
        fonte = FonteOmie(client)
        await _completar_lacunas(fonte, linhas, competencia, hoje, log)
        oss = _montar_oss(linhas, hoje, n_cod_cc_padrao)
        if len(oss) > MAX_OS_POR_LOTE:
            raise ValueError(
                f"{len(oss)} OSs passam do teto de {MAX_OS_POR_LOTE} por lote.")
        # Inclusão é sequencial (o Omie não aceita inclusões concorrentes).
        log(f"== Criando {len(oss)} OS(s), uma a uma ==")
        return await criacao.criar(client, fonte, oss, log=log,
                                   ao_progresso=ao_progresso)


async def _reconciliar_contratos(empresa_id: str, competencia: str,
                                 por_contrato: dict, servs_excedente: set,
                                 log, ao_progresso=None) -> list:
    from omie_mcp.excedentes import contrato as contrato_mod
    chave, segredo = infisical.buscar_credenciais_omie(empresa_id)
    async with OmieClient(OmieSettings.for_cliente(chave, segredo)) as client:
        resultados = []
        # Sequencial: um contrato de cada vez (AlterarContrato não é lote).
        for idx, (n_cod_ctr, dados) in enumerate(por_contrato.items(), start=1):
            if ao_progresso:
                ao_progresso(idx, len(por_contrato))
            r = await contrato_mod.reconciliar(
                client, n_cod_ctr, dados["numero"], dados["itens"],
                servs_excedente, log=log)
            resultados.append(r)
        return resultados


def _contrato_sem_mudanca(acoes: list, tem_exclusao: bool) -> bool:
    """Nada a enviar ao Omie para este contrato: todos os itens da base já
    estão lá com o valor certo ('manter') e não há exclusão prevista — pula
    até o ConsultarContrato (zero chamadas de API)."""
    return (not tem_exclusao and bool(acoes)
            and all(a == "manter" for a in acoes))


def _contratos_varridos(exclusoes_previstas: list, ja_na_base: set,
                        selecao: dict | None) -> dict[int, str]:
    """Varredura total (regra Rodrigo 17/11): contratos dia-2 SEM linha na
    base do mês mas com item de excedente (entradas sem_base da prévia).
    Reconciliação com base vazia = só remove. Fora da seleção = intocado."""
    varridos: dict[int, str] = {}
    for e in exclusoes_previstas:
        if not e.get("sem_base"):
            continue
        n = int(e["n_cod_ctr"])
        if n in ja_na_base:
            continue
        if (selecao and selecao["contratos"] is not None
                and n not in selecao["contratos"]):
            continue
        varridos[n] = str(e.get("numero_contrato") or n)
    return varridos


def _processar_contratos(conn, lote_id: int, empresa_id: str,
                         competencia: str, log,
                         selecao: dict | None = None,
                         etapa=lambda nome: None) -> dict:
    from omie_mcp.excedentes.contrato import ItemExcedenteBase

    consulta = """
        select id, n_cod_ctr, numero_contrato, n_cod_serv, categoria,
               valor_total, contrato_acao
        from public.excedentes_linha
        where lote_id = %s and status in ('ok', 'resolvida')
          and forma_faturamento = 'contrato' and n_cod_ctr is not null
          and n_cod_serv is not null and criacao_status is null
    """
    parametros: list = [lote_id]
    if selecao and selecao["contratos"] is not None:
        # Contrato fora da seleção fica intocado: nem atualiza nem remove.
        consulta += " and n_cod_ctr = any(%s)"
        parametros.append(selecao["contratos"])
    linhas = _sql_all(conn, consulta + " order by id", tuple(parametros))

    # Exclusões previstas no plano: parciais (contrato na base com item a
    # menos) e totais (sem_base — varredura dos dia-2 fora da base do mês).
    row = _sql(conn, """
        select resumo->'exclusoes_contrato' from public.excedentes_lote
        where id = %s
    """, (lote_id,))
    exclusoes_previstas = [
        e for e in (row[0] if row else None) or []
        if isinstance(e, dict) and e.get("n_cod_ctr")
    ]
    ctrs_com_exclusao = {int(e["n_cod_ctr"]) for e in exclusoes_previstas}

    por_contrato: dict[int, dict] = {}
    for (lid, n_cod_ctr, numero, n_cod_serv, categoria, valor_total,
         contrato_acao) in linhas:
        d = por_contrato.setdefault(
            int(n_cod_ctr),
            {"numero": numero or str(n_cod_ctr), "itens": [], "acoes": []})
        d["acoes"].append(contrato_acao)
        d["itens"].append(ItemExcedenteBase(
            linha_id=lid, n_cod_serv=int(n_cod_serv), valor=_dec(valor_total),
            categoria=categoria,
            cod_int_item=f"EXC-{competencia}-{int(n_cod_serv)}"))

    varridos = _contratos_varridos(exclusoes_previstas, set(por_contrato),
                                   selecao)
    if not por_contrato and not varridos:
        return {"contratos": 0, "incluidos": 0, "atualizados": 0,
                "mantidos": 0, "excluidos": 0, "falhas": 0, "limpos": 0}

    # De/Para → conjunto de serviços de excedente (p/ identificar o que no
    # contrato é excedente e pode ser excluído).
    mapa = depara.carregar(conn, empresa_id)
    servs_excedente = {m.n_cod_serv_excedente for m in mapa.values()
                       if m.n_cod_serv_excedente}

    # Contratos já corretos (tudo 'manter', sem exclusão) saem direto como
    # mantidos, sem nenhuma chamada ao Omie.
    mantidos = 0
    reconciliar: dict[int, dict] = {}
    for n_cod_ctr, dados in por_contrato.items():
        if _contrato_sem_mudanca(dados["acoes"],
                                 n_cod_ctr in ctrs_com_exclusao):
            for item in dados["itens"]:
                mantidos += 1
                _sql(conn, """update public.excedentes_linha
                    set criacao_status = 'contrato_mantido', criada_em = now()
                    where id = %s""", (item.linha_id,))
            log(f"   contrato {dados['numero']}: já correto no Omie — nada enviado")
        else:
            reconciliar[n_cod_ctr] = dados

    # Varredura total: reconciliação com base VAZIA — só remove excedentes.
    for n_cod_ctr, numero in varridos.items():
        reconciliar[n_cod_ctr] = {"numero": numero, "itens": [], "acoes": []}
        log(f"   contrato {numero}: sem excedente na base do mês — "
            "itens de excedente serão removidos")

    resultados = []
    if reconciliar:
        log(f"== Reconciliando {len(reconciliar)} contrato(s) dia-2 "
            f"({len(varridos)} de varredura; "
            f"{len(por_contrato) + len(varridos) - len(reconciliar)} "
            "já correto(s), pulados) ==")
        resultados = asyncio.run(_reconciliar_contratos(
            empresa_id, competencia, reconciliar, servs_excedente, log,
            ao_progresso=lambda atual, total: etapa(f"contratos:{atual}/{total}")))
    else:
        log(f"== {len(por_contrato)} contrato(s) dia-2 já correto(s) — "
            "nenhuma chamada ao Omie ==")

    inc = atu = exc = falhas = limpos = 0
    for r in resultados:
        if not r.ok:
            falhas += 1
            for item in reconciliar[r.n_cod_ctr]["itens"]:
                _sql(conn, """
                    update public.excedentes_linha
                    set criacao_status = 'falha', criacao_erro = %s, criada_em = now()
                    where id = %s
                """, (r.erro, item.linha_id))
            continue
        if r.n_cod_ctr in varridos:
            limpos += 1
        exc += r.excluidos
        for lid in r.incluidos:
            inc += 1
            _sql(conn, """update public.excedentes_linha
                set criacao_status = 'contrato_incluido', criada_em = now()
                where id = %s""", (lid,))
        for lid in r.atualizados:
            atu += 1
            _sql(conn, """update public.excedentes_linha
                set criacao_status = 'contrato_atualizado', criada_em = now()
                where id = %s""", (lid,))
        # O reconciliador também pula valor igual (checado com dado fresco):
        # conta como mantido mesmo que o plano tivesse dito "atualizar".
        for lid in r.mantidos:
            mantidos += 1
            _sql(conn, """update public.excedentes_linha
                set criacao_status = 'contrato_mantido', criada_em = now()
                where id = %s""", (lid,))
    return {"contratos": len(por_contrato), "incluidos": inc,
            "atualizados": atu, "mantidos": mantidos,
            "excluidos": exc, "limpos": limpos, "falhas": falhas}


def processar_criacao(conn, lote_id: int, empresa_id: str,
                      competencia: str) -> None:
    log_linhas: list[str] = []

    def log(texto: str) -> None:
        print(texto, flush=True)
        log_linhas.append(texto)

    def etapa(nome: str) -> None:
        _sql(conn, "update public.excedentes_lote set etapa = %s where id = %s",
             (nome, lote_id))

    try:
        log(f"===== excedentes CRIAR #{lote_id} · empresa {empresa_id} =====")
        etapa("montando")
        selecao = _carregar_selecao(conn, lote_id)
        if selecao:
            log("Seleção do analista: "
                f"{'todas' if selecao['oss'] is None else len(selecao['oss'])} OS(s), "
                f"{'todos' if selecao['contratos'] is None else len(selecao['contratos'])} contrato(s)")
        consulta = """
            select id, linha_planilha, n_cod_cli, numero_contrato, n_cod_ctr,
                   n_cod_serv, categoria, n_cod_cc, cidade_prest, venc_final,
                   email_envio, valor_total, status, resolucao, c_cod_int_os
            from public.excedentes_linha
            where lote_id = %s and status in ('ok', 'resolvida')
              and forma_faturamento = 'os'
              and criacao_status is null
        """
        parametros: list = [lote_id]
        if selecao and selecao["oss"] is not None:
            consulta += " and c_cod_int_os = any(%s)"
            parametros.append(selecao["oss"])
        linhas = [list(l) for l in
                  _sql_all(conn, consulta + " order by id", tuple(parametros))]

        etapa("criando")
        cc_padrao = depara.n_cod_cc_padrao(conn, empresa_id)
        resultados = asyncio.run(
            _criar(empresa_id, linhas, competencia, date.today(), cc_padrao, log,
                   ao_progresso=lambda atual, total: etapa(f"criando:{atual}/{total}")))

        criadas = falhas = ja_existiam = 0
        valor_criado = Decimal(0)
        for r in resultados:
            if r.status == "criada":
                criadas += 1
                valor_criado += r.os.valor_total
            elif r.status == "ja_existia":
                ja_existiam += 1
            else:
                falhas += 1
                log(f"   falha {r.os.c_cod_int_os}: {r.erro}")
            for item in r.os.itens:
                _sql(conn, """
                    update public.excedentes_linha
                    set criacao_status = %s, n_cod_os = %s, numero_os = %s,
                        criacao_erro = %s, criada_em = now()
                    where id = %s
                """, (r.status, r.n_cod_os, r.numero_os, r.erro, item.linha_id))

        # Faturamento no contrato (clientes dia 2): reconcilia os itens de
        # excedente dentro de cada contrato. Só depois das OSs.
        etapa("contratos")
        contrato_res = _processar_contratos(conn, lote_id, empresa_id,
                                            competencia, log, selecao,
                                            etapa=etapa)
        falhas += contrato_res["falhas"]

        excecoes = _sql(conn, """
            select count(*) from public.excedentes_linha
            where lote_id = %s and status = 'excecao'
        """, (lote_id,))[0]

        resumo_final = {
            "os_criadas": criadas,
            "valor_criado": str(valor_criado),
            "ja_existiam": ja_existiam,
            "contrato": contrato_res,
            "falhas": falhas,
            "excecoes_pendentes": int(excecoes),
        }
        log(f"== {resumo_final} ==")
        _sql(conn, """
            update public.excedentes_lote
            set status = %s, etapa = null, concluido_em = now(),
                resumo = coalesce(resumo, '{}'::jsonb) || %s::jsonb,
                log = coalesce(log, '') || '\n\n' || %s
            where id = %s
        """, ("concluido" if falhas == 0 else "erro",
              db.Json({"criacao": resumo_final}),
              "\n".join(log_linhas)[-MAX_LOG:], lote_id))
    except Exception as erro:
        log(traceback.format_exc())
        _sql(conn, """
            update public.excedentes_lote
            set status = 'erro', etapa = null, concluido_em = now(),
                erro = %s, log = coalesce(log, '') || '\n\n' || %s
            where id = %s
        """, (str(erro)[:2000], "\n".join(log_linhas)[-MAX_LOG:], lote_id))


def rodar_uma_vez(conn) -> bool:
    """Atende no máximo UM pedido (criação tem prioridade: já foi aprovada).
    Devolve True se trabalhou — o chamador decide se dorme."""
    pedido = reivindicar_criacao(conn)
    if pedido is not None:
        processar_criacao(conn, pedido[0], pedido[1], pedido[2])
        return True
    pedido = reivindicar_plano(conn)
    if pedido is not None:
        processar_plano(conn, pedido[0], pedido[1], pedido[2], pedido[3])
        return True
    return False
