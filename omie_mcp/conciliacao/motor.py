"""Motor de conciliacao bancaria da Proos.

Ordem de avaliacao (deliberada — ver racional do projeto):

  1. DUPLICIDADE   — linha ja conciliada antes nao e reprocessada.
  2. REGRA CLIENTE — o que o operador ja confirmou antes decide primeiro.
  3. TRANSFERENCIA — testada ANTES de titulo. Uma saida de 50k com entrada de
                     50k em outra conta do mesmo cliente nunca pode chegar na
                     camada de titulo: o fuzzy acharia um fornecedor parecido e
                     erraria com confianca alta.
  4. TITULO        — deterministico, depois fuzzy com regras financeiras.
  5. DIRETO        — tarifa/rendimento/IOF, SO se nenhum titulo plausivel.
  6. FILA          — o residuo, ja tipificado.

Python puro, sem rede: da pra testar com dados sinteticos e rodar contra dados
reais no terminal do Rodrigo.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable, Optional, Sequence

from . import dicionario_banco as dic
from .modelos import (
    Candidato,
    Desfecho,
    Evidencia,
    Faixa,
    LinhaExtrato,
    Natureza,
    RegraCliente,
    Resultado,
    Titulo,
    TipoExcecao,
)


@dataclass
class Config:
    """Cortes e tolerancias — por cliente, ajustados conforme o retrabalho cai."""

    corte_automatico: int = 90
    corte_revisao: int = 60

    # janela de datas aceita entre vencimento e movimento bancario
    dias_antes: int = 3
    dias_depois: int = 7

    # transferencia
    dias_par_transferencia: int = 1
    dias_espera_par: int = 2  # antes de abrir excecao por par ausente

    # diferenca de valor aceita como explicavel (percentual sobre o titulo)
    tolerancia_percentual: Decimal = Decimal("0.10")
    tolerancia_absoluta: Decimal = Decimal("50.00")
    # teto: o piso absoluto (acima) nao pode virar um percentual desproporcional
    # em titulos pequenos — sem isso, um titulo de R$100 aceitava R$50 (50%)
    # como "explicavel". Ate a retencao ser validada por aliquota real (ver
    # VALIDACAO-2026-09-20.md), este teto e o unico freio.
    tolerancia_percentual_maxima: Decimal = Decimal("0.25")

    # tarifa embutida em transferencia
    tarifa_max_transferencia: Decimal = Decimal("50.00")

    confirmacoes_para_regra_automatica: int = 3

    # pagamento parcial: linha menor que o titulo, mas ao menos esta fracao
    parcial_minimo: Decimal = Decimal("0.20")

    # ambiguidade: dois candidatos dentro de `empate_maximo` pontos, desde que
    # o melhor tenha ao menos `score_minimo_ambiguidade`
    empate_maximo: int = 5
    score_minimo_ambiguidade: int = 40


@dataclass
class Contexto:
    """Tudo que o motor precisa para decidir um lote de linhas."""

    linhas: Sequence[LinhaExtrato]
    titulos: Sequence[Titulo]
    regras: Sequence[RegraCliente] = field(default_factory=list)
    contas_investimento: dict[str, str] = field(default_factory=dict)
    # conta_corrente_id -> conta_investimento_id
    linhas_ja_conciliadas: frozenset[str] = frozenset()
    hoje: Optional[date] = None
    documento_empresa: Optional[str] = None  # CNPJ do cliente (transferencias)


def conciliar(ctx: Contexto, cfg: Optional[Config] = None) -> list[Resultado]:
    """Avalia todas as linhas do lote e devolve um Resultado por linha."""
    cfg = cfg or Config()
    hoje = ctx.hoje or date.today()

    titulos_disponiveis = [t for t in ctx.titulos if not t.conciliado]
    usados: set[str] = set()          # titulos ja comprometidos neste lote
    pares_usados: set[str] = set()    # linhas ja casadas como transferencia
    par_original: dict[str, Resultado] = {}  # linha_id da outra ponta -> resultado original
    finalizados_nao_transferencia: set[str] = set()  # linhas ja fechadas como titulo/direto
    saldo_consumido: dict[str, Decimal] = {}  # titulo_id -> total ja casado neste lote
    resultados: list[Resultado] = []

    for linha in ctx.linhas:
        # a outra ponta de uma transferencia ja resolvida nao pode ser
        # reavaliada do zero — senao ela pode "virar" titulo ou lancamento
        # direto por coincidencia, e as duas classificacoes ficam de pe.
        if linha.id in pares_usados and linha.id in par_original:
            original = par_original[linha.id]
            resultado = Resultado(
                linha=linha,
                desfecho=Desfecho.TRANSFERENCIA,
                faixa=original.faixa,
                score=original.score,
                linha_par_id=original.linha.id,
                conta_destino_id=original.linha.conta_id,
                valor_tarifa=original.valor_tarifa,
                motivo=f"Outra ponta da transferencia (par da linha {original.linha.id}).",
            )
            resultados.append(resultado)
            continue

        resultado = _avaliar(
            linha, ctx, cfg, hoje, titulos_disponiveis, usados, pares_usados,
            frozenset(finalizados_nao_transferencia), saldo_consumido,
        )

        if resultado.candidato is not None and resultado.desfecho is Desfecho.TITULO:
            titulo_id = resultado.candidato.titulo.id
            if getattr(resultado.candidato, "parcial", False):
                consumido = saldo_consumido.get(titulo_id, Decimal("0")) + linha.valor
                saldo_consumido[titulo_id] = consumido
                if consumido >= resultado.candidato.titulo.valor:
                    usados.add(titulo_id)  # saldo esgotado nesta rodada
            else:
                usados.add(titulo_id)  # automatico OU revisao

        if resultado.desfecho in (Desfecho.TITULO, Desfecho.LANCAMENTO_DIRETO):
            finalizados_nao_transferencia.add(linha.id)

        if resultado.linha_par_id:
            pares_usados.add(resultado.linha_par_id)
            pares_usados.add(linha.id)
            par_original[resultado.linha_par_id] = resultado

        resultados.append(resultado)

    return resultados


# --------------------------------------------------------------------------
# avaliacao de uma linha
# --------------------------------------------------------------------------

def _avaliar(
    linha: LinhaExtrato,
    ctx: Contexto,
    cfg: Config,
    hoje: date,
    titulos: Sequence[Titulo],
    usados: set[str],
    pares_usados: set[str],
    finalizados_nao_transferencia: frozenset[str] = frozenset(),
    saldo_consumido: Optional[dict[str, Decimal]] = None,
) -> Resultado:

    # 1. duplicidade
    if linha.id in ctx.linhas_ja_conciliadas:
        return Resultado(
            linha=linha,
            desfecho=Desfecho.FILA,
            faixa=Faixa.EXCECAO,
            tipo_excecao=TipoExcecao.DUPLICIDADE,
            motivo="Linha ja conciliada anteriormente (mesmo id de origem).",
        )

    # 2. regra aprendida do cliente — NAO e mais curto-circuito absoluto:
    #    uma regra de classificacao (direto/transferencia) so vale se nao
    #    houver titulo plausivel; senao a despesa entra duas vezes (o CP fica
    #    em aberto e ainda nasce um lancamento direto). Regras de TITULO nunca
    #    decidem sozinhas: viram bonus de parceiro dentro de _avaliar_titulos.
    regra = _regra_que_casa(linha, ctx.regras)

    # 3. transferencia COM indicio textual — antes de titulo (a saida de 50k
    #    com entrada de 50k noutra conta nunca deve chegar na camada de titulo).
    #    Transferencia SEM indicio (so valor/data batendo) e avaliada depois de
    #    titulo, e nunca sozinha: duas contrapartes diferentes com o mesmo
    #    valor no mesmo dia e coincidencia comum demais.
    transferencia = _tentar_transferencia(
        linha, ctx, cfg, hoje, pares_usados, finalizados_nao_transferencia,
        exigir_indicio=True,
    )
    if transferencia is not None:
        return transferencia

    # 4. titulo
    candidatos = _avaliar_titulos(linha, titulos, cfg, usados, ctx.regras, saldo_consumido)
    melhor = candidatos[0] if candidatos else None
    segundo = candidatos[1] if len(candidatos) > 1 else None

    # ambiguidade e avaliada ANTES do corte: dois titulos empatados nao sao
    # "sem titulo", sao uma escolha que so o operador pode fazer
    if (
        melhor is not None
        and segundo is not None
        and melhor.score >= cfg.score_minimo_ambiguidade
        and melhor.score - segundo.score <= cfg.empate_maximo
    ):
        empatados = [
            c for c in candidatos if melhor.score - c.score <= cfg.empate_maximo
        ]
        return Resultado(
            linha=linha,
            desfecho=Desfecho.FILA,
            faixa=Faixa.EXCECAO,
            score=melhor.score,
            candidato=melhor,
            descartados=candidatos[1:4],
            tipo_excecao=TipoExcecao.AMBIGUIDADE,
            motivo=f"{len(empatados)} candidatos com score equivalente.",
        )

    if melhor is not None and melhor.score >= cfg.corte_revisao:
        faixa = (
            Faixa.AUTOMATICO if melhor.score >= cfg.corte_automatico else Faixa.REVISAO
        )
        if getattr(melhor, "parcial", False):
            faixa = Faixa.REVISAO

        # diferenca de valor nao explicada derruba para excecao
        if melhor.diferenca != 0 and melhor.explicacao_diferenca is None:
            return Resultado(
                linha=linha,
                desfecho=Desfecho.FILA,
                faixa=Faixa.EXCECAO,
                score=melhor.score,
                candidato=melhor,
                descartados=candidatos[1:4],
                tipo_excecao=TipoExcecao.DIVERGENCIA_VALOR,
                motivo=f"Diferenca de {melhor.diferenca} sem explicacao.",
            )

        return Resultado(
            linha=linha,
            desfecho=Desfecho.TITULO,
            faixa=faixa,
            score=melhor.score,
            candidato=melhor,
            descartados=candidatos[1:4],
            categoria_sugerida=melhor.titulo.categoria,
            motivo=melhor.explicacao_diferenca or "",
        )

    # 4b. sem titulo plausivel: agora a regra do cliente pode decidir
    if regra is not None and regra.desfecho in (
        Desfecho.LANCAMENTO_DIRETO, Desfecho.TRANSFERENCIA
    ):
        automatica = regra.confirmacoes >= cfg.confirmacoes_para_regra_automatica
        return Resultado(
            linha=linha,
            desfecho=regra.desfecho,
            faixa=Faixa.AUTOMATICO if automatica else Faixa.REVISAO,
            score=100 if automatica else 75,
            categoria_sugerida=regra.categoria,
            linha_par_id=None,
            conta_destino_id=regra.conta_destino_id,
            descartados=candidatos[:3],
            motivo=f"Regra do cliente ({regra.confirmacoes} confirmacoes): {regra.padrao}",
            evidencias=[Evidencia("regra_cliente", 100, regra.padrao)],
        )

    # 4c. transferencia sem indicio textual: so valor+data batendo em outra
    #     conta. Vai para REVISAO, nunca automatica.
    transferencia = _tentar_transferencia(
        linha, ctx, cfg, hoje, pares_usados, finalizados_nao_transferencia,
        exigir_indicio=False,
    )
    if transferencia is not None:
        transferencia.faixa = Faixa.REVISAO
        transferencia.score = min(transferencia.score, 70)
        transferencia.motivo += " Sem indicio na descricao — confirmar."
        transferencia.descartados = candidatos[:3]
        return transferencia

    # 5. lancamento direto — so agora, sem titulo plausivel
    padrao = dic.identificar(linha)
    if padrao is not None:
        if padrao.tipo in (dic.TipoDireto.APLICACAO, dic.TipoDireto.RESGATE):
            conta_inv = ctx.contas_investimento.get(linha.conta_id)
            if conta_inv is None:
                return Resultado(
                    linha=linha,
                    desfecho=Desfecho.FILA,
                    faixa=Faixa.EXCECAO,
                    tipo_excecao=TipoExcecao.CADASTRO,
                    motivo=(
                        "Aplicacao/resgate detectado, mas a conta de investimento "
                        "nao esta cadastrada para esta conta corrente."
                    ),
                )
            return Resultado(
                linha=linha,
                desfecho=Desfecho.TRANSFERENCIA,
                faixa=Faixa.AUTOMATICO,
                score=92,
                linha_par_id=None,
                conta_destino_id=conta_inv,
                motivo=f"{padrao.tipo.value} — transferencia contra conta de investimento.",
                evidencias=[Evidencia("dicionario_banco", 92, padrao.tipo.value)],
            )

        return Resultado(
            linha=linha,
            desfecho=Desfecho.LANCAMENTO_DIRETO,
            faixa=Faixa.AUTOMATICO,
            score=90,
            categoria_sugerida=padrao.categoria_padrao,
            motivo=f"{padrao.tipo.value} reconhecido pelo dicionario do banco.",
            evidencias=[Evidencia("dicionario_banco", 90, padrao.tipo.value)],
        )

    # 6. fila
    tipo = (
        TipoExcecao.SEM_TITULO_SAIDA
        if linha.natureza is Natureza.DEBITO
        else TipoExcecao.SEM_TITULO_ENTRADA
    )
    return Resultado(
        linha=linha,
        desfecho=Desfecho.FILA,
        faixa=Faixa.EXCECAO,
        score=melhor.score if melhor else 0,
        candidato=None,
        descartados=candidatos[:3],
        tipo_excecao=tipo,
        motivo="Nenhum titulo em aberto compativel e nenhum padrao de lancamento direto.",
    )


# --------------------------------------------------------------------------
# transferencia
# --------------------------------------------------------------------------

def _tentar_transferencia(
    linha: LinhaExtrato,
    ctx: Contexto,
    cfg: Config,
    hoje: date,
    pares_usados: set[str],
    finalizados_nao_transferencia: frozenset[str] = frozenset(),
    exigir_indicio: bool = True,
) -> Optional[Resultado]:
    """Procura o par de sinal oposto em outra conta do mesmo cliente.

    Com `exigir_indicio=True`, so considera par se a descricao de UMA das
    pontas indicar transferencia (ou se a contraparte for a propria empresa).
    Tarifa embutida so e aceita com indicio e quando a SAIDA e maior que a
    entrada — o contrario nao e tarifa, e outra coisa.
    """
    if linha.id in pares_usados:
        return None

    indicio_linha = _parece_transferencia(linha) or _contraparte_e_a_empresa(linha, ctx)
    melhor_par: Optional[LinhaExtrato] = None
    tarifa = Decimal("0")

    for outra in ctx.linhas:
        if outra.id == linha.id or outra.id in pares_usados:
            continue
        # linha ja fechada como titulo/lancamento direto neste lote nao pode
        # ser "roubada" de volta como perna de transferencia.
        if outra.id in finalizados_nao_transferencia:
            continue
        if outra.conta_id == linha.conta_id or outra.natureza is linha.natureza:
            continue
        if abs((outra.data - linha.data).days) > cfg.dias_par_transferencia:
            continue

        indicio = indicio_linha or _parece_transferencia(outra) \
            or _contraparte_e_a_empresa(outra, ctx)
        if exigir_indicio and not indicio:
            continue

        diferenca = abs(outra.valor - linha.valor)
        if diferenca == 0:
            melhor_par, tarifa = outra, Decimal("0")
            break
        if not indicio or diferenca > cfg.tarifa_max_transferencia:
            continue
        # tarifa: o debito (quem enviou) e maior que o credito (quem recebeu)
        debito = linha if linha.natureza is Natureza.DEBITO else outra
        credito = outra if debito is linha else linha
        if debito.valor > credito.valor and melhor_par is None:
            melhor_par, tarifa = outra, diferenca

    if melhor_par is not None:
        motivo = "Par encontrado em outra conta da empresa."
        # A escrita hoje manda o valor da linha inteiro numa unica operacao —
        # nao decompoe a tarifa em dois lancamentos. Com tarifa embutida,
        # automatizar seria gravar valor errado num dos dois lados; melhor
        # forcar revisao ate a escrita saber separar as duas pernas.
        faixa = Faixa.AUTOMATICO
        score = 95
        if tarifa:
            motivo += (
                f" Diferenca de {tarifa} e provavelmente tarifa embutida — "
                "revisao necessaria (a escrita ainda nao decompoe automatico)."
            )
            faixa = Faixa.REVISAO
            score = 70
        return Resultado(
            linha=linha,
            desfecho=Desfecho.TRANSFERENCIA,
            faixa=faixa,
            score=score,
            linha_par_id=melhor_par.id,
            conta_destino_id=melhor_par.conta_id,
            valor_tarifa=tarifa,
            motivo=motivo,
            evidencias=[Evidencia("par_transferencia", score, f"linha {melhor_par.id}")],
        )

    if not exigir_indicio or not indicio_linha:
        return None

    # com indicio e sem par: espera a outra conta sincronizar antes de abrir excecao
    if (hoje - linha.data).days < cfg.dias_espera_par:
        return Resultado(
            linha=linha, desfecho=Desfecho.FILA, faixa=Faixa.REVISAO,
            motivo=("Parece transferencia; aguardando sincronizacao da outra "
                    f"conta (ate {cfg.dias_espera_par} dias uteis)."),
        )
    return Resultado(
        linha=linha, desfecho=Desfecho.FILA, faixa=Faixa.EXCECAO,
        tipo_excecao=TipoExcecao.TRANSFERENCIA_SEM_PAR,
        motivo="Descricao indica transferencia, mas a outra ponta nao apareceu.",
    )


def _contraparte_e_a_empresa(linha: LinhaExtrato, ctx: Contexto) -> bool:
    """A contraparte da linha e o proprio cliente (mesmo CNPJ)."""
    if not ctx.documento_empresa or not linha.contraparte_documento:
        return False
    return _so_digitos(linha.contraparte_documento) == _so_digitos(ctx.documento_empresa)


def _parece_transferencia(linha: LinhaExtrato) -> bool:
    descricao = dic._normalizar(linha.descricao)
    termos = (
        "TRANSF ENTRE CONTAS", "TRANSFERENCIA ENTRE CONTAS", "TRANSF C/C",
        "TED MESMA TITULARIDADE", "PIX MESMA TITULARIDADE", "TRANSF PROPRIA",
    )
    return any(t in descricao for t in termos)


# --------------------------------------------------------------------------
# titulos: deterministico + fuzzy
# --------------------------------------------------------------------------

def _avaliar_titulos(
    linha: LinhaExtrato,
    titulos: Sequence[Titulo],
    cfg: Config,
    usados: set[str],
    regras: Sequence[RegraCliente] = (),
    saldo_consumido: Optional[dict[str, Decimal]] = None,
) -> list[Candidato]:
    candidatos: list[Candidato] = []
    saldo_consumido = saldo_consumido if saldo_consumido is not None else {}

    for titulo in titulos:
        if titulo.id in usados:
            continue
        if titulo.natureza_esperada is not linha.natureza:
            continue

        dias = (linha.data - titulo.vencimento).days
        if dias < -cfg.dias_antes or dias > cfg.dias_depois:
            continue

        # saldo restante do titulo NESTE lote — sem isso, um segundo pagamento
        # parcial (ou uma segunda linha coincidente) seria avaliado contra o
        # valor cheio de novo, permitindo baixa em duplicidade acima do total.
        saldo = titulo.valor - saldo_consumido.get(titulo.id, Decimal("0"))
        if saldo <= 0:
            continue

        cand = Candidato(titulo=titulo)

        # --- valor (a evidencia mais forte depois do identificador) ---
        diferenca = linha.valor - saldo
        cand.diferenca = diferenca
        if diferenca == 0:
            cand.somar("valor_exato", 45, str(saldo))
        else:
            limite_base = max(saldo * cfg.tolerancia_percentual, cfg.tolerancia_absoluta)
            limite = min(limite_base, saldo * cfg.tolerancia_percentual_maxima)
            if abs(diferenca) <= limite:
                # dentro da tolerancia: juros, desconto, retencao...
                explicacao = _explicar_diferenca(diferenca, linha, dias)
                if explicacao:
                    cand.explicacao_diferenca = explicacao
                    cand.somar("valor_explicado", 40, explicacao)
                else:
                    # Score suficiente pra, somado a nome/data, cruzar
                    # corte_revisao — sem isso a diferenca nao-explicada some
                    # no balde generico "sem titulo" em vez de virar
                    # DIVERGENCIA_VALOR com o candidato anexado (pior pro
                    # operador: perde a pista de qual titulo provavelmente e).
                    cand.somar("valor_proximo", 20, f"diferenca {diferenca}")
            elif diferenca < 0 and linha.valor >= saldo * cfg.parcial_minimo:
                # fora da tolerancia, mas linha menor e nao irrisoria:
                # pagamento parcial. Nunca automatico — operador confirma e o
                # titulo fica em aberto pelo saldo.
                cand.somar("valor_parcial", 20, f"parcial {linha.valor} de {saldo}")
                cand.explicacao_diferenca = "pagamento parcial"
                cand.parcial = True
            else:
                continue  # fora de tolerancia: nem e candidato

        # --- identificador forte ---
        if titulo.numero_documento and titulo.numero_documento in linha.descricao:
            cand.somar("documento_na_descricao", 35, titulo.numero_documento)

        if (
            titulo.parceiro_documento
            and linha.contraparte_documento
            and _so_digitos(titulo.parceiro_documento)
            == _so_digitos(linha.contraparte_documento)
        ):
            cand.somar("cnpj_contraparte", 35, titulo.parceiro_documento)

        # --- nome do parceiro ---
        similaridade = _similaridade_nome(titulo.parceiro_nome, linha)
        if similaridade >= 0.9:
            cand.somar("nome_exato", 25, titulo.parceiro_nome)
        elif similaridade >= 0.6:
            cand.somar("nome_parcial", 12, titulo.parceiro_nome)

        # --- regra aprendida: descricao -> este parceiro ---
        for regra in regras:
            if regra.desfecho is Desfecho.TITULO and regra.casa(linha) and \
                    regra.padrao.upper() in dic._normalizar(titulo.parceiro_nome):
                cand.somar("regra_parceiro", 15, regra.padrao)
                break

        # --- data ---
        if dias == 0:
            cand.somar("data_exata", 10)
        elif abs(dias) <= 2:
            cand.somar("data_proxima", 6, f"{dias:+d} dias")
        else:
            cand.somar("data_na_janela", 2, f"{dias:+d} dias")

        candidatos.append(cand)

    candidatos.sort(key=lambda c: c.score, reverse=True)
    if len(candidatos) == 1:
        # nao ha concorrente na janela — ausencia de ambiguidade conta a favor
        candidatos[0].somar("candidato_unico", 10)
    return candidatos


def _termo_presente(descricao: str, termo: str) -> bool:
    """Casa `termo` como palavra inteira — 'ISS' nao pode casar 'COMISSAO'."""
    import re

    return re.search(r"(?<![A-Z0-9])" + re.escape(termo) + r"(?![A-Z0-9])", descricao) is not None


def _explicar_diferenca(
    diferenca: Decimal, linha: LinhaExtrato, dias: int
) -> Optional[str]:
    """Tenta justificar a diferenca de valor com uma regra financeira.

    So aceita o que a propria descricao declara — nao ha mais heuristica
    "sem atraso e menor = desconto por antecipacao": isso classificava
    divergencia de valor sem nenhuma evidencia textual como explicada,
    quando deveria cair em revisao humana (ver VALIDACAO-2026-09-20.md).
    A heuristica de juros por atraso fica, por ser dificil de estar errada:
    pagar A MAIS e em atraso e virtualmente sempre juros/multa.
    """
    descricao = dic._normalizar(linha.descricao)

    if diferenca < 0 and any(
        _termo_presente(descricao, t)
        for t in ("ISS", "IRRF", "INSS", "PCC", "CSLL", "RETENCAO", "RETIDO")
    ):
        return "retencao de imposto na fonte"
    if diferenca < 0 and any(_termo_presente(descricao, t) for t in ("DESCONTO", "ABATIMENTO")):
        return "desconto informado na descricao"
    if diferenca > 0 and any(_termo_presente(descricao, t) for t in ("JUROS", "MULTA", "MORA")):
        return "juros/multa informados na descricao"

    if diferenca > 0 and dias > 0:
        return f"juros/multa por atraso de {dias} dias"
    return None


def _regra_que_casa(
    linha: LinhaExtrato, regras: Iterable[RegraCliente]
) -> Optional[RegraCliente]:
    casadas = [r for r in regras if r.casa(linha)]
    if not casadas:
        return None
    return max(casadas, key=lambda r: (r.confirmacoes, len(r.padrao)))


def _so_digitos(texto: str) -> str:
    return "".join(c for c in texto if c.isdigit())


def _similaridade_nome(nome_titulo: str, linha: LinhaExtrato) -> float:
    """Similaridade por tokens significativos do nome dentro da descricao."""
    alvo = dic._normalizar(nome_titulo)
    texto = dic._normalizar(
        f"{linha.descricao} {linha.contraparte_nome or ''}"
    )

    ruido = {
        "LTDA", "ME", "EIRELI", "SA", "S/A", "EPP", "MEI", "DE", "DA", "DO",
        "DOS", "DAS", "E", "COMERCIO", "SERVICOS", "INDUSTRIA",
    }
    tokens = [t for t in alvo.split() if len(t) > 2 and t not in ruido]
    if not tokens:
        return 0.0

    encontrados = sum(1 for t in tokens if t in texto)
    return encontrados / len(tokens)


# --------------------------------------------------------------------------
# resumo do lote
# --------------------------------------------------------------------------

def resumir(resultados: Sequence[Resultado]) -> dict[str, int]:
    """Contagem por desfecho e faixa — base das metricas do piloto."""
    resumo: dict[str, int] = {"total": len(resultados)}
    for r in resultados:
        resumo[f"desfecho_{r.desfecho.value}"] = (
            resumo.get(f"desfecho_{r.desfecho.value}", 0) + 1
        )
        resumo[f"faixa_{r.faixa.value}"] = resumo.get(f"faixa_{r.faixa.value}", 0) + 1
        if r.tipo_excecao:
            chave = f"excecao_{r.tipo_excecao.value}"
            resumo[chave] = resumo.get(chave, 0) + 1
    return resumo
