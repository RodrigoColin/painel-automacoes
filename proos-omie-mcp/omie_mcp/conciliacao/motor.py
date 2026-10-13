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
    AplicacaoTitulo,
    Candidato,
    Desfecho,
    Evidencia,
    Faixa,
    LinhaExtrato,
    Natureza,
    RecebimentoOmie,
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

    # passo CONCILIAR_RECEBIDO (credito que o Omie ja recebeu — PIX QR etc.):
    # janela entre a data de credito no extrato e a data em que o Omie recebeu
    # (compensacao: o banco credita no mesmo dia ou ate 2 dias depois da baixa).
    dias_recebimento_credito: int = 2

    # decomposicao de credito consolidado de boleto: casa o credito "BOLETOS
    # RECEBIDOS" com o conjunto de boletos que o Omie ja recebeu, quando a soma
    # das baixas de UM dia (dentro da janela) bate exatamente. OPT-IN por
    # cliente (decompor_boleto_recebido=True) — so vale pra quem recebe boleto
    # DIRETO na conta e em baixo volume (1 dia ≈ 1 credito, ex.: Proos). Em
    # alto volume (ex.: Oystr) o banco agrupa boletos atravessando dias e a
    # soma do dia nao bate — nesse caso fica off e cai em aguardando_retorno.
    decompor_boleto_recebido: bool = False
    dias_credito_boleto: int = 7


@dataclass
class Contexto:
    """Tudo que o motor precisa para decidir um lote de linhas."""

    linhas: Sequence[LinhaExtrato]
    titulos: Sequence[Titulo]
    regras: Sequence[RegraCliente] = field(default_factory=list)
    contas_investimento: dict[str, str] = field(default_factory=dict)
    # conta_corrente_id -> conta_investimento_id
    contas_cartao: dict[str, str] = field(default_factory=dict)
    # conta_corrente_id -> conta_cartao_id (pagamento de fatura). Mapeamento
    # simples 1:1 — se a conta corrente paga fatura de mais de um cartao,
    # nao da pra saber qual sem mais informacao; nesse caso so configure
    # o cartao mais frequente (ou nenhum) e deixe o resto cair em revisao.
    contas_garantidas: dict[str, str] = field(default_factory=dict)
    # conta_corrente_id -> conta que representa a linha de credito rotativo
    # ("conta garantida"/cheque especial contratado) — mesma nao teremos
    # extrato dela, mesma regra dos outros dois mapeamentos acima.
    linhas_ja_conciliadas: frozenset[str] = frozenset()
    hoje: Optional[date] = None
    documento_empresa: Optional[str] = None  # CNPJ do cliente (transferencias)
    # Titulos que o Omie JA recebeu/baixou no periodo (CR liquidado). Usados so
    # pelo passo CONCILIAR_RECEBIDO, para casar credito sem contraparte no
    # extrato (PIX QR) com o recebimento que ja existe. Vazio = passo nao roda
    # (comportamento historico preservado).
    recebimentos: Sequence[RecebimentoOmie] = field(default_factory=list)


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
            if len(resultado.candidato.cascata) >= 2:
                # cascata: atualiza o saldo de CADA titulo envolvido, nao so
                # o primeiro (que e so quem o Candidato.titulo aponta).
                for aplicacao in resultado.candidato.cascata:
                    consumido = (
                        saldo_consumido.get(aplicacao.titulo.id, Decimal("0"))
                        + aplicacao.valor
                    )
                    saldo_consumido[aplicacao.titulo.id] = consumido
                    if consumido >= aplicacao.titulo.valor:
                        usados.add(aplicacao.titulo.id)
            else:
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

def _transferencia_para_conta_relacionada(
    linha: LinhaExtrato,
    padrao,
    conta_destino: Optional[str],
    rotulo_conta: str,
) -> Resultado:
    """Aplicacao/resgate de investimento e pagamento de fatura de cartao
    seguem a mesma regra: sempre TRANSFERENCIA (nunca caem no limbo de
    "cadastro"), mas so automatica quando sabemos PRA QUAL conta relacionada
    — nao vamos esperar o extrato mensal dela pra decidir hoje (aplicacao/
    resgate: so um resumo na virada do mes; cartao: a fatura discriminada
    chega depois, e a baixa dos titulos que a compoe continua manual, feita
    a parte). Sem a conta configurada, o sistema nao sabe de onde saiu/pra
    onde foi o dinheiro — vai pra revisao pro operador informar qual e a
    conta, nunca decide as cegas. Decisao explicita do usuario, 2026-09-21.
    """
    if conta_destino is not None:
        return Resultado(
            linha=linha,
            desfecho=Desfecho.TRANSFERENCIA,
            faixa=Faixa.AUTOMATICO,
            score=92,
            linha_par_id=None,
            conta_destino_id=conta_destino,
            motivo=f"{padrao.tipo.value} — transferencia contra {rotulo_conta}.",
            evidencias=[Evidencia("dicionario_banco", 92, padrao.tipo.value)],
        )
    return Resultado(
        linha=linha,
        desfecho=Desfecho.TRANSFERENCIA,
        faixa=Faixa.REVISAO,
        score=70,
        linha_par_id=None,
        conta_destino_id=None,
        motivo=(
            f"{padrao.tipo.value} reconhecido, mas a {rotulo_conta} nao esta "
            "cadastrada — operador precisa informar qual conta."
        ),
        evidencias=[Evidencia("dicionario_banco", 70, padrao.tipo.value)],
    )


# Evidencias que provam que o candidato e REALMENTE a contraparte da linha
# (documento ou nome batendo), nao so uma coincidencia de valor/data. Usadas
# para nao deixar um titulo de valor parecido, mas de OUTRO parceiro, virar
# "ambiguidade" quando a linha ja diz quem e a contraparte.
_EVIDENCIAS_IDENTIDADE = frozenset(
    {
        "documento_na_descricao",
        "cnpj_contraparte",
        "nome_exato",
        "nome_parcial",
        "regra_parceiro",
        "regra_parceiro_lote",
    }
)


def _tem_identidade(cand: Candidato) -> bool:
    """True se o candidato casou por documento ou nome — nao so por valor/data."""
    return any(e.nome in _EVIDENCIAS_IDENTIDADE for e in cand.evidencias)


def _linha_identifica_contraparte(linha: LinhaExtrato) -> bool:
    """True quando a linha diz QUEM e a contraparte: documento/nome normalizado,
    ou um CNPJ/CPF cru na descricao (comum em PIX, ex.: 'PIX RECEBIDO POSITIVO
    EDUCACIONAL 02.343.359/0001-90'). Quando a linha NAO identifica ninguem
    (ex.: 'PIX QRS' seco), empate por valor entre titulos continua sendo
    ambiguidade legitima — o operador e quem sabe."""
    import re

    if linha.contraparte_documento or linha.contraparte_nome:
        return True
    return re.search(r"\d{2}\.?\d{3}\.?\d{3}/\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}", linha.descricao) is not None


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

    # 2a. regra "sempre revisao": o cliente reconhece o padrao mas nunca quer
    #     decisao automatica pra ele (ex.: PIX pro Rodrigo pode ser pro-labore,
    #     distribuicao de lucro ou outra coisa — so o operador sabe qual).
    #     Curto-circuito absoluto: nem titulo, nem transferencia, nem
    #     dicionario chegam a ser avaliados.
    if regra is not None and regra.sempre_revisao:
        return Resultado(
            linha=linha,
            desfecho=Desfecho.FILA,
            faixa=Faixa.EXCECAO,
            tipo_excecao=TipoExcecao.CONFIRMACAO_MANUAL,
            motivo=(
                f"Padrao '{regra.padrao}' sempre exige decisao manual do "
                "operador (regra do cliente)."
            ),
        )

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
    # "sem titulo", sao uma escolha que so o operador pode fazer.
    #
    # MAS: quando a linha ja diz QUEM e a contraparte (nome/CNPJ), um titulo de
    # valor parecido mas de OUTRO parceiro nao e uma alternativa real — e so
    # coincidencia de valor. Nesse caso so contam como candidatos de ambiguidade
    # os que casaram a identidade (documento/nome). Sem isso, um PIX recebido do
    # "POSITIVO EDUCACIONAL" (com CNPJ na linha) virava "ambiguidade" entre tres
    # escritorios de advocacia de ~R$ 6.500 em aberto, nenhum deles o POSITIVO
    # (Oystr, agosto/2026): a verdade e "sem titulo do POSITIVO em aberto", nao
    # uma escolha do operador. Quando a linha NAO identifica ninguem ('PIX QRS'
    # seco), empate por valor continua sendo ambiguidade legitima.
    if _linha_identifica_contraparte(linha):
        candidatos_amb = [c for c in candidatos if _tem_identidade(c)]
    else:
        candidatos_amb = candidatos
    melhor_amb = candidatos_amb[0] if candidatos_amb else None
    segundo_amb = candidatos_amb[1] if len(candidatos_amb) > 1 else None
    if (
        melhor_amb is not None
        and segundo_amb is not None
        and melhor_amb.score >= cfg.score_minimo_ambiguidade
        and melhor_amb.score - segundo_amb.score <= cfg.empate_maximo
    ):
        empatados = [
            c for c in candidatos_amb if melhor_amb.score - c.score <= cfg.empate_maximo
        ]
        return Resultado(
            linha=linha,
            desfecho=Desfecho.FILA,
            faixa=Faixa.EXCECAO,
            score=melhor_amb.score,
            candidato=melhor_amb,
            descartados=[c for c in candidatos if c is not melhor_amb][:3],
            tipo_excecao=TipoExcecao.AMBIGUIDADE,
            motivo=f"{len(empatados)} candidatos com score equivalente.",
        )

    # ambiguidade FORA da janela: um titulo MAIS ANTIGO do MESMO parceiro com
    # o MESMO valor exato ja em aberto, com vencimento fora da janela usada
    # em _avaliar_titulos — nesse caso ele nunca vira candidato nem entra no
    # empate acima, e o motor fecha contra o titulo "certo pela janela" sem
    # saber que existe um mais velho pendente que bate igualzinho. So' conta
    # como ambiguidade quando o gemeo e' MAIS ANTIGO que o escolhido: um
    # gemeo mais NOVO (parcela futura do mesmo valor, ainda nao vencida) e'
    # o padrao normal de cascata/parcelamento (ver _avaliar_cascata) e nao
    # deve virar fila. Errar a troca entre gemeos e' silencioso: os dois
    # titulos ficam com o mesmo saldo depois, nada acusa sozinho. Achado
    # real (Oystr, agosto/2026): pagamento em 27/08 fechou com a parcela da
    # Stefanini vencida em 28/08 (dentro da janela), mas o humano tinha
    # baixado contra uma parcela igual vencida em 30/07 (quase um mes mais
    # velha, fora da janela) — "quitar o mais antigo primeiro" e' a pratica
    # contabil padrao, e o motor nao tinha como saber disso so' pela janela.
    if melhor is not None and melhor.diferenca == 0:
        sc = saldo_consumido or {}
        gemeo = next(
            (
                t for t in titulos
                if t.id != melhor.titulo.id
                and t.id not in usados
                and t.natureza_esperada is linha.natureza
                and t.vencimento < melhor.titulo.vencimento
                and (t.valor - sc.get(t.id, Decimal("0"))) == linha.valor
                and dic._normalizar(t.parceiro_nome) == dic._normalizar(melhor.titulo.parceiro_nome)
            ),
            None,
        )
        if gemeo is not None:
            return Resultado(
                linha=linha,
                desfecho=Desfecho.FILA,
                faixa=Faixa.EXCECAO,
                score=melhor.score,
                candidato=melhor,
                descartados=[Candidato(titulo=gemeo), *candidatos[1:3]],
                tipo_excecao=TipoExcecao.AMBIGUIDADE,
                motivo=(
                    f"Titulo mais antigo do mesmo parceiro (vencido em "
                    f"{gemeo.vencimento.isoformat()}) com valor identico "
                    f"({melhor.titulo.valor}) tambem em aberto, fora da "
                    "janela de vencimento — nao da pra saber qual e a "
                    "baixa certa."
                ),
            )

    if melhor is not None and melhor.score >= cfg.corte_revisao:
        faixa = (
            Faixa.AUTOMATICO if melhor.score >= cfg.corte_automatico else Faixa.REVISAO
        )
        if getattr(melhor, "parcial", False):
            faixa = Faixa.REVISAO
        if getattr(melhor, "via_regra_lote", False):
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

    # 4a-bis. titulo com VALOR EXATO mas score baixo (falta nome/documento na
    # descricao) nunca pode ser silenciosamente substituido por lancamento
    # direto automatico do dicionario — o valor batendo exato com um titulo
    # aberto na janela de vencimento e coincidencia forte demais pra
    # descartar. Achado real: empresa que lanca tarifa/mensalidade bancaria
    # como Contas a Pagar em vez de lancamento direto — "TARIFA RENOVACAO
    # CADASTRO" bateu no dicionario com score 90 (automatico) enquanto o
    # titulo certo (mesmo valor, mesma data, nome do banco sem match textual)
    # ficava esquecido com score baixo (Scopo, 2026-09-21). Vai pra REVISAO,
    # nunca automatico — dá a mesma prioridade que "parcial" ja tem.
    if melhor is not None and melhor.diferenca == 0:
        return Resultado(
            linha=linha,
            desfecho=Desfecho.TITULO,
            faixa=Faixa.REVISAO,
            score=melhor.score,
            candidato=melhor,
            descartados=candidatos[1:4],
            categoria_sugerida=melhor.titulo.categoria,
            motivo=(
                "Valor bate exato com um titulo aberto na janela de vencimento, "
                "mas sem evidencia de nome/documento — revisao antes de decidir "
                "entre este titulo e um lancamento direto."
            ),
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

    # 4d. cascata de parceiro: pagamento parcelado que nao fechou com nenhum
    #     titulo individual, mas drena uma fila de titulos do mesmo
    #     parceiro+categoria (ex.: distribuicao de lucro paga aos poucos —
    #     quando o total ultrapassa o titulo aberto, o excedente drena o
    #     proximo, mais antigo primeiro). Nunca automatica: sempre revisao.
    cascata = _avaliar_cascata(linha, titulos, cfg, usados, saldo_consumido)
    if cascata is not None:
        return Resultado(
            linha=linha,
            desfecho=Desfecho.TITULO,
            faixa=Faixa.REVISAO,
            score=cascata.score,
            candidato=cascata,
            descartados=candidatos[:3],
            categoria_sugerida=cascata.titulo.categoria,
            motivo=(
                f"Pagamento parcelado — dreno de {len(cascata.cascata)} titulos "
                f"de {cascata.titulo.parceiro_nome}."
            ),
        )

    # 5. lancamento direto — so agora, sem titulo plausivel
    padrao = dic.identificar(linha)
    if padrao is not None:
        if padrao.tipo in (dic.TipoDireto.APLICACAO, dic.TipoDireto.RESGATE):
            return _transferencia_para_conta_relacionada(
                linha, padrao, ctx.contas_investimento.get(linha.conta_id),
                "conta de investimento",
            )
        if padrao.tipo is dic.TipoDireto.FATURA_CARTAO:
            return _transferencia_para_conta_relacionada(
                linha, padrao, ctx.contas_cartao.get(linha.conta_id),
                "conta do cartao",
            )
        if padrao.tipo is dic.TipoDireto.CONTA_GARANTIDA:
            return _transferencia_para_conta_relacionada(
                linha, padrao, ctx.contas_garantidas.get(linha.conta_id),
                "conta garantida",
            )
        if padrao.tipo is dic.TipoDireto.TRIBUTO_FEDERAL:
            # So chega aqui quando nenhum titulo bateu (passo 4 ja rodou —
            # se a guia estivesse cadastrada com o valor certo, o titulo
            # normal ja teria resolvido). Reconhece que E' tributo federal,
            # mas nunca decide sozinho qual guia/categoria: o valor muda todo
            # mes (Simples Nacional sobre faturamento) e so o operador sabe
            # qual guia e essa. Decisao explicita do usuario, 2026-09-21.
            return Resultado(
                linha=linha,
                desfecho=Desfecho.FILA,
                faixa=Faixa.EXCECAO,
                tipo_excecao=TipoExcecao.CONFIRMACAO_MANUAL,
                descartados=candidatos[:3],
                motivo=(
                    "Pagamento de tributo federal (Receita Federal) sem "
                    "titulo aberto compativel — o valor da guia muda todo "
                    "mes, operador confirma qual e."
                ),
            )
        if padrao.tipo is dic.TipoDireto.RECEBIMENTO_COBRANCA:
            # Decomposicao (opt-in por cliente, cfg.decompor_boleto_recebido):
            # quando o cliente recebe boleto direto na conta e em baixo volume,
            # o credito consolidado = a soma das baixas de boleto de um dia no
            # Omie (com defasagem de compensacao). Se um dia bate exato, amarra
            # o credito a esses titulos ja baixados. Senao, segue a regra
            # historica abaixo (aguardando o retorno). Decisao 2026-10-13.
            if cfg.decompor_boleto_recebido:
                decomposto = _decompor_boleto_consolidado(
                    linha, ctx.recebimentos, cfg
                )
                if decomposto is not None:
                    return decomposto
            # Fallback historico (decisao 2026-09-21): um credito de "BOLETOS
            # RECEBIDOS" pode representar 1 ou 50 boletos; sem a soma de um dia
            # batendo exato, decompor e trabalho do arquivo retorno (importado
            # no Omie), nao do motor. Vira pendencia sinalizada no Portal Proos,
            # nao uma excecao generica de "sem titulo".
            return Resultado(
                linha=linha,
                desfecho=Desfecho.FILA,
                faixa=Faixa.EXCECAO,
                tipo_excecao=TipoExcecao.AGUARDANDO_RETORNO_BOLETO,
                motivo=(
                    "Recebimento consolidado de boleto sem titulo individual "
                    "batendo — aguardando a importacao do arquivo retorno no "
                    "Omie antes de conciliar."
                ),
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

    # 5b. recebimento JA feito no Omie (PIX QR sem contraparte no extrato).
    #     O motor roda depois da baixa/CNAB: se o Omie ja recebeu um titulo de
    #     mesmo valor numa data compativel (compensacao) E o parceiro corrobora
    #     (documento ou nome parcial), amarra a linha a esse recebimento —
    #     recuperando QUEM pagou, que o banco escondeu. Nao cria baixa (ja
    #     existe); vai pra REVISAO (operador confirma com a contraparte pronta).
    recebido = _tentar_recebimento_recebido(linha, ctx.recebimentos, cfg)
    if recebido is not None:
        return recebido

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
            if regra.desfecho is not Desfecho.TITULO or not regra.casa(linha):
                continue
            if regra.valor_exato is not None and linha.valor != regra.valor_exato:
                continue
            if regra.valor_exceto is not None and linha.valor == regra.valor_exceto:
                continue
            if regra.categoria is not None and titulo.categoria != regra.categoria:
                continue
            if regra.parceiro_nome_esperado is not None:
                bate_parceiro = (
                    dic._normalizar(regra.parceiro_nome_esperado)
                    == dic._normalizar(titulo.parceiro_nome)
                )
            else:
                bate_parceiro = regra.padrao.upper() in dic._normalizar(titulo.parceiro_nome)
            if bate_parceiro:
                if regra.parceiro_nome_esperado is not None:
                    # unica evidencia de parceiro possivel numa descricao de
                    # lote sem nome nenhum — pontuacao mais alta que a regra
                    # generica (que ja tem o padrao aparecendo dentro do nome
                    # do titulo, uma segunda confirmacao textual que aqui nao
                    # existe). Nunca vira automatico mesmo assim: ver
                    # Candidato.via_regra_lote.
                    cand.somar("regra_parceiro_lote", 30, regra.padrao)
                    cand.via_regra_lote = True
                else:
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


def _chave_parceiro(titulo: Titulo) -> tuple[str, str]:
    return (dic._normalizar(titulo.parceiro_nome), titulo.categoria or "")


def _avaliar_cascata(
    linha: LinhaExtrato,
    titulos: Sequence[Titulo],
    cfg: Config,
    usados: set[str],
    saldo_consumido: dict[str, Decimal],
) -> Optional[Candidato]:
    """Pagamento parcelado que dreno uma fila de titulos do mesmo parceiro
    (nome+categoria — CNPJ nem sempre esta cadastrado no titulo de pessoa
    fisica) em vez de fechar exato contra um so. Confirmado com o caso real
    de distribuicao de lucro/pro-labore pago em varias parcelas no mes: cada
    parcela baixa o titulo mais antigo aberto ate zerar, e o excedente segue
    pro proximo da fila — o proprio Omie cria um titulo novo pra diferenca
    quando o pago ultrapassa o que estava lancado.
    """
    disponiveis = [
        t for t in titulos
        if t.id not in usados
        and t.natureza_esperada is linha.natureza
        and (t.valor - saldo_consumido.get(t.id, Decimal("0"))) > 0
    ]
    if len(disponiveis) < 2:
        return None

    grupos: dict[tuple[str, str], list[Titulo]] = {}
    for t in disponiveis:
        grupos.setdefault(_chave_parceiro(t), []).append(t)

    melhor: Optional[Candidato] = None
    for membros in grupos.values():
        if len(membros) < 2:
            continue  # cascata so faz sentido com fila de 2+ titulos abertos

        similaridade = _similaridade_nome(membros[0].parceiro_nome, linha)
        if similaridade < 0.6:
            continue

        restante = linha.valor
        aplicacoes: list[AplicacaoTitulo] = []
        for t in sorted(membros, key=lambda x: x.vencimento):
            if restante <= 0:
                break
            saldo_titulo = t.valor - saldo_consumido.get(t.id, Decimal("0"))
            aplicado = min(restante, saldo_titulo)
            aplicacoes.append(AplicacaoTitulo(titulo=t, valor=aplicado))
            restante -= aplicado

        # so e "cascata" de verdade se precisou de 2+ titulos pra explicar o
        # pagamento, e sobrou pouco ou nada sem titulo pra cobrir.
        if len(aplicacoes) < 2 or restante > cfg.tolerancia_absoluta:
            continue

        cand = Candidato(titulo=aplicacoes[0].titulo, cascata=aplicacoes)
        cand.diferenca = -restante
        cand.somar(
            "cascata_parceiro", 45,
            f"{len(aplicacoes)} titulos de {membros[0].parceiro_nome}",
        )
        if similaridade >= 0.9:
            cand.somar("nome_exato", 25, membros[0].parceiro_nome)
        else:
            cand.somar("nome_parcial", 12, membros[0].parceiro_nome)

        if melhor is None or cand.score > melhor.score:
            melhor = cand

    return melhor


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


# Termos que o banco escreve em credito de PIX/TED e que NAO identificam o
# pagador — descartados antes de procurar o fragmento de nome na descricao.
_RUIDO_FRAGMENTO = frozenset({
    "PIX", "QRS", "QRCODE", "RECEBIDO", "RECEBIMENTO", "ENVIADO", "TED", "DOC",
    "CREDITO", "TRANSF", "TRANSFERENCIA", "PAGTO", "PAGAMENTO", "DINHEIRO",
})


def _fragmento_corrobora(linha: LinhaExtrato, parceiro_nome: str) -> bool:
    """O banco trunca/omite a contraparte no PIX QR (ex.: 'PIX QRS MONTRONI
    AD10/09'). Corrobora se ALGUM pedaco de nome da descricao (4+ letras, nao
    ruido bancario) aparece no nome do parceiro do recebimento do Omie —
    direcao inversa a _similaridade_nome: o pouco que o banco deu tem que bater
    o cliente, nao o contrario (senao nome longo de escritorio nunca fecha).
    Tolera digito colado no nome (ex.: 'POSITIV03' -> 'POSITIV')."""
    import re
    nome = dic._normalizar(parceiro_nome or "")
    if not nome:
        return False
    for raw in re.split(r"[^A-Z]+", dic._normalizar(linha.descricao or "")):
        if len(raw) >= 4 and raw not in _RUIDO_FRAGMENTO and raw in nome:
            return True
    return False


def _tentar_recebimento_recebido(
    linha: LinhaExtrato,
    recebimentos: Sequence[RecebimentoOmie],
    cfg: Config,
) -> Optional[Resultado]:
    """Casa um CREDITO que nao achou titulo em aberto com um titulo que o Omie
    JA recebeu (ex.: PIX QR sem contraparte no extrato).

    So age quando: (a) e credito; (b) existe UM unico recebimento de mesmo
    valor numa janela de compensacao; (c) o parceiro corrobora — documento
    batendo OU nome parcial acima do corte. Sem corroboracao de QUEM pagou,
    devolve None e a linha segue pra fila (nao chuta por valor+data so).
    """
    if linha.natureza is not Natureza.CREDITO or not recebimentos:
        return None

    por_id: dict[str, RecebimentoOmie] = {}
    for r in recebimentos:
        if abs(r.valor - linha.valor) > Decimal("0.01"):
            continue
        dias = (linha.data - r.data).days
        if 0 <= dias <= cfg.dias_recebimento_credito:
            por_id.setdefault(str(r.id), r)
    if len(por_id) != 1:
        return None  # 0 = nada; 2+ = ambiguo -> deixa a fila tipificar

    receb = next(iter(por_id.values()))
    doc_ok = bool(
        receb.parceiro_documento
        and linha.contraparte_documento
        and _so_digitos(receb.parceiro_documento)
        and _so_digitos(receb.parceiro_documento) == _so_digitos(linha.contraparte_documento)
    )
    nome_ok = _fragmento_corrobora(linha, receb.parceiro_nome)
    if not doc_ok and not nome_ok:
        return None  # sem corroboracao de QUEM pagou -> fila

    titulo = Titulo(
        id=str(receb.id), tipo="CR", vencimento=receb.data, valor=receb.valor,
        parceiro_nome=receb.parceiro_nome, parceiro_documento=receb.parceiro_documento,
        conciliado=True,
    )
    cand = Candidato(titulo=titulo)
    cand.somar("recebimento_omie", 40, f"ja recebido no Omie em {receb.data.isoformat()}")
    if doc_ok:
        cand.somar("cnpj_contraparte", 35, receb.parceiro_documento or "")
    if nome_ok:
        cand.somar("nome_parcial", 12, receb.parceiro_nome)
    return Resultado(
        linha=linha,
        desfecho=Desfecho.CONCILIAR_RECEBIDO,
        faixa=Faixa.REVISAO,
        score=cand.score,
        candidato=cand,
        motivo=(
            f"Titulo ja recebido no Omie ({receb.parceiro_nome or 'cliente'}) "
            "casado por valor+data; contraparte recuperada do Omie (o extrato "
            "nao a traz)."
        ),
    )


def _titulo_de_recebimento(r: RecebimentoOmie) -> Titulo:
    """Titulo sintetico a partir de um recebimento ja feito no Omie (CR
    liquidado) — usado nos desfechos CONCILIAR_RECEBIDO (nao vira candidato na
    busca de titulo em aberto porque nasce conciliado=True)."""
    return Titulo(
        id=str(r.id), tipo="CR", vencimento=r.data, valor=r.valor,
        parceiro_nome=r.parceiro_nome, parceiro_documento=r.parceiro_documento,
        conciliado=True,
    )


def _decompor_boleto_consolidado(
    linha: LinhaExtrato,
    recebimentos: Sequence[RecebimentoOmie],
    cfg: Config,
) -> Optional[Resultado]:
    """Casa um credito consolidado de boletos com o conjunto de boletos que o
    Omie JA recebeu, quando a soma das baixas de UM dia (dentro da janela de
    compensacao) bate exatamente o valor do credito.

    So roda com cfg.decompor_boleto_recebido=True (opt-in por cliente). Vale
    pra quem recebe boleto DIRETO na conta e em baixo volume (1 dia ≈ 1
    credito, ex.: Proos). Nao cria baixa — os boletos ja estao baixados; so
    amarra o credito aos N titulos (desfecho CONCILIAR_RECEBIDO, revisao). Em
    alto volume (Oystr) nenhum dia soma exato e devolve None -> fallback
    aguardando_retorno_boleto. A exatidao da soma e a propria prova; sem ela,
    nao decompoe as cegas."""
    if not recebimentos:
        return None
    por_dia: dict[date, list[RecebimentoOmie]] = {}
    for r in recebimentos:
        if (r.tipo_documento or "").upper() != "BOL":
            continue
        # so soma boletos baixados NA MESMA conta da linha (quando sabido) —
        # nao misturar carteira/outra conta com o credito desta conta corrente.
        if r.conta_corrente_id and r.conta_corrente_id != linha.conta_id:
            continue
        por_dia.setdefault(r.data, []).append(r)
    for off in range(0, cfg.dias_credito_boleto + 1):
        d = linha.data - timedelta(days=off)
        grupo = por_dia.get(d)
        if not grupo:
            continue
        soma = sum((g.valor for g in grupo), Decimal("0"))
        if abs(soma - linha.valor) <= Decimal("0.01"):
            cascata = [
                AplicacaoTitulo(titulo=_titulo_de_recebimento(g), valor=g.valor)
                for g in grupo
            ]
            cand = Candidato(titulo=cascata[0].titulo, cascata=cascata)
            cand.somar(
                "boletos_do_dia", 50,
                f"{len(grupo)} boletos de {d.isoformat()} somam {soma}",
            )
            return Resultado(
                linha=linha,
                desfecho=Desfecho.CONCILIAR_RECEBIDO,
                faixa=Faixa.REVISAO,
                score=cand.score,
                candidato=cand,
                motivo=(
                    f"Credito consolidado = {len(grupo)} boleto(s) ja recebido(s) "
                    f"no Omie em {d.isoformat()} (soma exata). Conciliar o credito "
                    "contra esses titulos; nao cria baixa (ja baixados)."
                ),
            )
    return None


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
    # Alguns cadastros colam o CPF/CNPJ sem pontuacao no fim do nome (ex.:
    # "LETICIA DE OLIVEIRA TERRA 02607439175"). Um token so-digito nunca bate
    # contra a mesma descricao formatada com pontuacao ("026.074.391-75"),
    # rebaixando nome_exato pra nome_parcial por causa de um token que nem e
    # nome — o CNPJ/CPF ja tem comparacao propria, normalizada, em
    # cnpj_contraparte. Achado real: caso Leticia/Proos, 2026-09-21.
    tokens = [
        t for t in alvo.split() if len(t) > 2 and t not in ruido and not t.isdigit()
    ]
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
