"""Escrita no ERP — traduz um Resultado do motor em chamadas ao Omie.

Principios inegociaveis desta camada:

1. **Dry-run e o padrao.** Nada grava sem `executar=True` explicito. O modo
   sombra nunca deve gravar por acidente.
2. **Idempotencia.** Toda gravacao passa por uma chave de idempotencia
   (`conta + linha_id`). Se a linha ja foi gravada, nao grava de novo — o
   risco real aqui nao e falhar, e lancar em duplicidade.
3. **So a faixa automatica grava sozinha.** Revisao e excecao esperam a
   decisao do operador virar uma `Decisao` explicita.
4. **Trilha de auditoria.** Toda gravacao registra o que o motor decidiu, com
   que score, sobre quais evidencias, e qual id o Omie devolveu.

O `client` esperado e o `OmieClient` do proos-omie-mcp (metodo assincrono
`call(endpoint, call, param)`), mas qualquer objeto com essa assinatura
serve — por isso da pra testar com um cliente falso, sem rede. `gravar()` e
async por causa disso; chame com `await` (ou `asyncio.run(...)` fora de um
loop ja rodando).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, Optional, Protocol, Sequence

from .modelos import Candidato, Desfecho, Faixa, Natureza, Resultado


class ClienteOmie(Protocol):
    # O OmieClient real (omie_mcp/client.py) e assincrono — se este protocolo
    # ficar sincrono, gravar() chama client.call(...) sem await e recebe uma
    # corrotina nao executada de volta, quebrando toda gravacao real (nao so
    # transferencia). Bug encontrado nesta validacao, sem teste antigo que
    # cobrisse cliente async — ClienteFalso tambem virou async por causa disso.
    async def call(self, endpoint: str, call: str, param: dict) -> dict: ...


# ---------------------------------------------------------------------------

@dataclass
class Gravacao:
    """Uma operacao de escrita — planejada ou executada."""

    linha_id: str
    operacao: str                 # LancarPagamento, IncluirLancCC, ...
    endpoint: str
    payload: dict
    executada: bool = False
    id_omie: Optional[str] = None
    erro: Optional[str] = None
    # auditoria
    desfecho: Optional[str] = None
    score: int = 0
    evidencias: list[dict] = field(default_factory=list)
    quando: Optional[datetime] = None
    origem: str = "motor"         # motor | operador

    def to_dict(self) -> dict[str, Any]:
        return {
            "linha_id": self.linha_id,
            "operacao": self.operacao,
            "endpoint": self.endpoint,
            "payload": self.payload,
            "executada": self.executada,
            "id_omie": self.id_omie,
            "erro": self.erro,
            "desfecho": self.desfecho,
            "score": self.score,
            "evidencias": self.evidencias,
            "quando": self.quando.isoformat() if self.quando else None,
            "origem": self.origem,
        }


@dataclass
class ConfigEscrita:
    conta_corrente_omie: str           # nCodCC
    codigo_categoria_padrao: str = ""
    codigo_tipo_documento: str = ""    # cCodTipoDoc de LancarPagamento/Recebimento — NAO confirmado ainda
    # "Tipo de Documento" da IncluirLancCC (detalhes.cTipo) — campo diferente
    # do de cima, nome parecido mas endpoint diferente. Nao e D/C, e um codigo
    # de forma de pagamento (boleto, pix, dinheiro...). "99999" (Outros)
    # confirmado ao vivo contra a Proos em 2026-09-21 — o proprio usuario
    # checou na tela do Omie qual tipo ficava selecionado pra um lancamento
    # deste tipo.
    tipo_documento_lancamento_direto: str = "99999"
    # nCodCliente (Favorecido) do lancamento direto — pra tarifa/IOF/juros de
    # conta, normalmente e o proprio banco. Precisa do codigo_cliente_omie do
    # cadastro (ListarClientes) daquele banco especifico nesta empresa —
    # varia por cliente, nao tem valor generico. Sem isso, fica sem
    # favorecido (aceito pela API, so fica incompleto).
    codigo_favorecido_lancamento_direto: Optional[int] = None
    conta_investimento_omie: Optional[str] = None
    # Baixa de titulo (LancarPagamento/LancarRecebimento) SIM marca
    # conciliacao de verdade — via campo top-level "conciliar_documento"
    # (S/N), confirmado na doc oficial (developer.omie.com.br,
    # financas/contapagar e financas/contareceber, 2026-09-21) depois que o
    # suporte da Omie apontou o metodo ConciliarRecebimento/codigo_baixa
    # como alternativa; "conciliar_documento" direto na propria baixa e mais
    # simples (um campo a mais no mesmo payload, sem chamada extra).
    #
    # Lancamento direto (IncluirLancCC — tarifa/IOF/rendimento) e
    # transferencia (TransferirEntreContas) NAO tem esse campo nem
    # equivalente — confirmado na doc oficial: o modulo
    # financas/contacorrentelancamentos so expoe dDtConc/cHrConc/cUsConc no
    # bloco de RESPOSTA "diversos" (ConsultaLancCC/ListarLancCC), nunca no
    # schema de requisicao de IncluirLancCC/AlterarLancCC. Testado tambem ao
    # vivo (Proos, lancamento real 2549263306): AlterarLancCC rejeita
    # dDtConc/cConciliado, e ConciliarLancCC/ConciliaLancCC/
    # IncluirConciliacao/AlterarConciliacaoLancCC nao existem. Confirmado
    # tambem pelo proprio suporte da Omie (2026-09-21): o modulo
    # ContaCorrenteLancamentos nao tem parametro equivalente a
    # conciliar_documento — conciliacao desses dois desfechos so acontece na
    # tela de conciliacao bancaria do sistema. Pra esses dois desfechos,
    # conciliacao continua acao exclusiva da interface do Omie
    # (match manual, "Atualizacao em Lote" na tela de conciliacao, ou a
    # integracao bancaria automatica do proprio Omie) — nenhum workaround de
    # API encontrado.
    conciliar_titulo: bool = True
    observacao_prefixo: str = "Conciliado pelo Portal Proos"


# ---------------------------------------------------------------------------

def _br(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _num(v: Decimal) -> float:
    return float(round(v, 2))


def _conta_da_linha(linha, cfg: ConfigEscrita) -> str:
    """Conta corrente que esta operacao pertence.

    Uso multi-conta (lote com --ofx de contas diferentes): `linha.conta_id`
    passa a SER o nCodCC real (nao mais um rotulo tipo "cc-itau"), entao usa
    ele direto — cada linha grava na sua propria conta, nao numa fixa pra
    todo o lote. So cai no default (`cfg.conta_corrente_omie`) quando
    conta_id nao e um nCodCC valido — uso single-conta legado, onde
    conta_id ainda e so um rotulo interno.

    Bug corrigido em 2026-09-21: antes de existir suporte multi-conta,
    TODAS as linhas do lote gravavam usando cfg.conta_corrente_omie — uma
    unica conta fixa. Um lote com --ofx de duas contas diferentes gravaria
    a segunda conta inteira na conta errada.
    """
    return linha.conta_id if linha.conta_id.isdigit() else cfg.conta_corrente_omie


def planejar(
    resultado: Resultado,
    cfg: ConfigEscrita,
    origem: str = "motor",
) -> Optional[Gravacao]:
    """Traduz um Resultado na chamada Omie correspondente. Nao executa nada."""
    linha = resultado.linha
    obs = f"{cfg.observacao_prefixo} — {linha.descricao[:80]}"
    evidencias = [
        {"nome": e.nome, "pontos": e.pontos, "detalhe": e.detalhe}
        for e in (
            resultado.candidato.evidencias
            if resultado.candidato else resultado.evidencias
        )
    ]

    def montar(operacao: str, endpoint: str, payload: dict) -> Gravacao:
        return Gravacao(
            linha_id=linha.id, operacao=operacao, endpoint=endpoint,
            payload=payload, desfecho=resultado.desfecho.value,
            score=resultado.score, evidencias=evidencias, origem=origem,
        )

    # --- baixa de titulo ---
    if resultado.desfecho is Desfecho.TITULO and resultado.candidato:
        titulo = resultado.candidato.titulo
        diferenca = resultado.candidato.diferenca
        juros = _num(diferenca) if diferenca > 0 else 0.0
        desconto = _num(-diferenca) if diferenca < 0 else 0.0

        payload = {
            "codigo_lancamento": int(titulo.id) if titulo.id.isdigit() else titulo.id,
            "codigo_conta_corrente": int(_conta_da_linha(linha, cfg)),
            "valor": _num(linha.valor),
            "data": _br(linha.data),
            "observacao": obs,
        }
        if juros:
            payload["juros"] = juros
        if desconto:
            payload["desconto"] = desconto
        if cfg.codigo_tipo_documento:
            payload["codigo_tipo_documento"] = cfg.codigo_tipo_documento
        if cfg.conciliar_titulo:
            # Campo top-level de LancarPagamento/LancarRecebimento (S/N) —
            # unico ponto do Omie onde a escrita marca conciliacao bancaria
            # de verdade (ver ConfigEscrita.conciliar_titulo).
            payload["conciliar_documento"] = "S"

        if titulo.tipo == "CP":
            return montar("LancarPagamento", "financas/contapagar/", payload)
        return montar("LancarRecebimento", "financas/contareceber/", payload)

    # --- lancamento direto em conta corrente ---
    if resultado.desfecho is Desfecho.LANCAMENTO_DIRETO:
        # Estrutura confirmada ao vivo contra a Proos em 2026-09-21 (as duas
        # primeiras tentativas, com cTipo/cObs dentro de cabecalho, foram
        # rejeitadas pela API antes de gravar qualquer coisa). O sentido
        # debito/credito NAO vem de um campo — vem do tipo da categoria
        # (despesa = saida, receita = entrada); por isso nValorLanc e sempre
        # positivo e nao ha campo de natureza aqui.
        payload = {
            "cabecalho": {
                "nCodCC": int(_conta_da_linha(linha, cfg)),
                "dDtLanc": _br(linha.data),
                "nValorLanc": _num(linha.valor),
            },
            "detalhes": {
                "cCodCateg": (
                    resultado.categoria_sugerida or cfg.codigo_categoria_padrao
                ),
                "cTipo": cfg.tipo_documento_lancamento_direto,
                "cObs": obs,
                # Numero do Documento: o FITID do OFX (referencia do proprio
                # banco pra esta transacao) — confirmado ao vivo em
                # 2026-09-21 usando o CHECKNUM/FITID real de uma tarifa.
                "cNumDoc": linha.id,
            },
        }
        if cfg.codigo_favorecido_lancamento_direto:
            payload["detalhes"]["nCodCliente"] = cfg.codigo_favorecido_lancamento_direto
        return montar(
            "IncluirLancCC", "financas/contacorrentelancamentos/", payload
        )

    # --- transferencia entre contas da empresa ---
    if resultado.desfecho is Desfecho.TRANSFERENCIA:
        # `conta_destino_id` e o id de CONTA da outra ponta — `linha_par_id`
        # e o id da LINHA do extrato e nunca deve ir num campo nCodCC (bug
        # confirmado na validacao adversarial: gravaria transferencia com
        # conta de destino errada).
        destino = resultado.conta_destino_id or cfg.conta_investimento_omie
        if destino is None:
            return None  # sem destino conhecido, nao ha o que gravar

        origem_cc = _conta_da_linha(linha, cfg)
        # a saida sai da conta da linha; a entrada vai para o destino
        de, para = (
            (origem_cc, destino)
            if linha.natureza is Natureza.DEBITO
            else (destino, origem_cc)
        )
        payload = {
            "nCodCCOrigem": de,
            "nCodCCDestino": para,
            "dDtLanc": _br(linha.data),
            "nValorLanc": _num(linha.valor),
            "cObs": obs,
        }
        return montar(
            "TransferirEntreContas", "financas/contacorrentelancamentos/", payload
        )

    return None  # FILA nao grava nada


def planejar_multiplas(
    resultado: Resultado,
    cfg: ConfigEscrita,
    origem: str = "motor",
) -> list[Gravacao]:
    """Como `planejar()`, mas devolve uma Gravacao POR TITULO quando o
    resultado veio de uma cascata (pagamento parcelado drenando 2+ titulos do
    mesmo parceiro em sequencia — ver motor._avaliar_cascata). Uma unica
    LancarPagamento com o valor da linha inteira baixaria o primeiro titulo
    por mais do que ele vale; precisa de uma baixa por titulo, cada uma com o
    valor efetivamente aplicado a ele.

    Fora do caso de cascata, e so `planejar()` devolvido numa lista de 0 ou 1
    item — use esta funcao em vez de `planejar()` em qualquer lugar que
    execute a gravacao de verdade.
    """
    if (
        resultado.desfecho is not Desfecho.TITULO
        or resultado.candidato is None
        or len(resultado.candidato.cascata) < 2
    ):
        gravacao = planejar(resultado, cfg, origem)
        return [gravacao] if gravacao is not None else []

    gravacoes: list[Gravacao] = []
    for aplicacao in resultado.candidato.cascata:
        sub_candidato = Candidato(
            titulo=aplicacao.titulo,
            score=resultado.candidato.score,
            evidencias=resultado.candidato.evidencias,
        )
        sub_resultado = Resultado(
            linha=resultado.linha,
            desfecho=Desfecho.TITULO,
            faixa=resultado.faixa,
            score=resultado.score,
            candidato=sub_candidato,
        )
        gravacao = planejar(sub_resultado, cfg, origem)
        if gravacao is None:
            continue
        # planejar() usa o valor da linha inteira — aqui e so a fatia
        # aplicada a este titulo especifico da cascata.
        gravacao.payload["valor"] = _num(aplicacao.valor)
        gravacoes.append(gravacao)
    return gravacoes


# ---------------------------------------------------------------------------

@dataclass
class Relatorio:
    planejadas: list[Gravacao] = field(default_factory=list)
    executadas: list[Gravacao] = field(default_factory=list)
    puladas: list[tuple[str, str]] = field(default_factory=list)  # (linha, motivo)
    falhas: list[Gravacao] = field(default_factory=list)

    def resumo(self) -> str:
        return (
            f"planejadas {len(self.planejadas)} | executadas "
            f"{len(self.executadas)} | puladas {len(self.puladas)} | "
            f"falhas {len(self.falhas)}"
        )


async def gravar(
    resultados: Sequence[Resultado],
    cfg: ConfigEscrita,
    client: Optional[ClienteOmie] = None,
    executar: bool = False,
    ja_gravadas: Optional[set[str]] = None,
    apenas_automaticas: bool = True,
    apos_gravar: Optional[Callable[[str], None]] = None,
) -> Relatorio:
    """Planeja (e opcionalmente executa) a gravacao do lote no Omie.

    `executar=False` e o padrao: devolve o plano sem tocar no ERP.
    `ja_gravadas` guarda as chaves de idempotencia ja usadas — o chamador
    persiste isso (tabela `match` no Postgres) entre rodadas; em JSON local,
    ver `apos_gravar`.

    `apos_gravar(chave)`, se informado, e chamado logo apos CADA gravacao bem
    sucedida — antes de seguir pra proxima linha do lote. Sem isso, um
    chamador que persiste `ja_gravadas` so no final do lote perde o registro
    de tudo que ja foi gravado de verdade no Omie se o processo cair no meio
    (janela real de gravacao em duplicidade — achado da validacao adversarial
    de 2026-09-20).
    """
    rel = Relatorio()
    ja_gravadas = ja_gravadas if ja_gravadas is not None else set()

    for r in resultados:
        # chave por conta REAL da linha, nao cfg.conta_corrente_omie fixo —
        # em lote multi-conta, linhas de contas diferentes com o mesmo id
        # (raro, mas nao impossivel entre bancos diferentes) nao podem
        # colidir na mesma chave de idempotencia.
        chave_linha = f"{_conta_da_linha(r.linha, cfg)}:{r.linha.id}"

        if chave_linha in ja_gravadas:
            rel.puladas.append((r.linha.id, "ja gravada (idempotencia)"))
            continue
        if r.desfecho is Desfecho.FILA:
            rel.puladas.append((r.linha.id, "fila — aguarda decisao do operador"))
            continue
        if apenas_automaticas and r.faixa is not Faixa.AUTOMATICO:
            rel.puladas.append((r.linha.id, f"faixa {r.faixa.value}"))
            continue

        # cascata (pagamento parcelado) gera mais de uma Gravacao pra mesma
        # linha, uma por titulo drenado — ver motor._avaliar_cascata.
        em_cascata = r.candidato is not None and len(r.candidato.cascata) >= 2
        gravacoes = planejar_multiplas(r, cfg)
        if not gravacoes:
            rel.puladas.append((r.linha.id, "sem operacao correspondente"))
            continue

        rel.planejadas.extend(gravacoes)

        if not executar:
            continue

        for gravacao in gravacoes:
            # a chave de idempotencia de uma cascata precisa incluir o
            # titulo — senao a segunda baixa da mesma linha acha que ja foi
            # gravada so por causa da primeira.
            chave = (
                f"{chave_linha}:{gravacao.payload.get('codigo_lancamento')}"
                if em_cascata else chave_linha
            )
            if chave in ja_gravadas:
                continue
            if client is None:
                gravacao.erro = "executar=True sem client"
                rel.falhas.append(gravacao)
                continue
            try:
                resposta = await client.call(
                    gravacao.endpoint, gravacao.operacao, gravacao.payload
                )
                gravacao.executada = True
                gravacao.quando = datetime.now()
                gravacao.id_omie = str(
                    resposta.get("nCodLanc")
                    or resposta.get("codigo_lancamento")
                    or resposta.get("nCodBaixa")
                    or ""
                ) or None
                ja_gravadas.add(chave)
                if apos_gravar is not None:
                    apos_gravar(chave)
                rel.executadas.append(gravacao)
            except Exception as e:  # noqa: BLE001 — queremos seguir o lote
                gravacao.erro = f"{type(e).__name__}: {e}"
                rel.falhas.append(gravacao)

    return rel

    return rel


# ---------------------------------------------------------------------------
# Atualizacao de valor de titulo recorrente (ex.: Simples Nacional/DAS) —
# NAO e uma baixa. O Omie pre-cria as parcelas futuras de uma despesa
# recorrente com o MESMO valor da configuracao original; quando o valor real
# muda todo mes (ex.: DAS, percentual sobre faturamento), a parcela do mes
# seguinte fica com um valor cadastrado que nunca vai bater. Isso ajusta esse
# valor cadastrado ANTES do vencimento — nunca uma baixa, nunca automatico
# (sempre por um comando explicito do operador, ver
# scripts/atualizar_titulo_recorrente.py), e so depois de localizar o titulo
# certo via omie_mcp.conciliacao.recorrencia (heuristica com trava de
# ambiguidade — nunca advinha).
#
# CONFIRMADO na doc oficial (schema PHPJSONCLIENT de financas/contapagar e
# financas/contareceber, 2026-09-21): AlterarContaPagar e AlterarContaReceber
# existem de verdade, e o campo do valor do documento em ambos e
# `valor_documento` (decimal) — e o mesmo nome que ConsultarContaPagar/
# ConsultarContaReceber devolvem, entao ler e escrever usam o mesmo campo.
# Tambem confirmado: NAO existe nenhum identificador de serie de recorrencia
# em lugar nenhum — o objeto `repeticao` (usado em Incluir/AlterarContaReceber
# pra CONFIGURAR quantas parcelas e a periodicidade) e so um parametro de
# ENTRADA; nem ConsultarContaReceber nem ListarContasReceber o devolvem. Ou
# seja, a heuristica de `omie_mcp.conciliacao.recorrencia` (parceiro +
# categoria + mes) nao e um atalho provisorio — e a UNICA forma possivel de
# achar "a proxima parcela", porque o Omie mesmo nao expoe outra.
#
# AINDA EM ABERTO (nao confirmado pela doc, que so lista o schema aceito, nao
# a semantica de update): se AlterarContaPagar/Receber faz merge (so muda o
# que foi enviado) ou substituicao total (campos ausentes viram nulo/default)
# — mesmo risco que derrubou as duas primeiras tentativas de IncluirLancCC
# nesta sessao. Por isso `planejar_atualizacao_valor_titulo` parte SEMPRE de
# uma copia do registro CRU inteiro (de consultar_conta_pagar/
# consultar_conta_receber), nunca de um payload minimo construido do zero —
# e o primeiro uso real com `executar=True` deve ser contra um titulo de
# baixo risco, nao direto no titulo real da recorrencia, ate confirmar isso
# ao vivo.

@dataclass
class AtualizacaoValorTitulo:
    """Uma alteracao de valor planejada (ou executada) num titulo que ainda
    nao venceu — nao e uma Gravacao (aquela e sempre baixa/lancamento/
    transferencia originada de um Resultado do motor; esta e originada de
    uma decisao manual do operador, fora do fluxo de conciliacao)."""

    titulo_id: str
    tipo: str                     # "CP" ou "CR"
    valor_antes: Decimal
    valor_depois: Decimal
    operacao: str                 # "AlterarContaPagar" | "AlterarContaReceber" — confirmado na doc oficial
    endpoint: str
    payload: dict
    motivo: str                   # texto livre do operador: qual guia, por que
    origem: str = "operador"
    executada: bool = False
    id_omie: Optional[str] = None
    erro: Optional[str] = None
    quando: Optional[datetime] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "titulo_id": self.titulo_id,
            "tipo": self.tipo,
            "valor_antes": str(self.valor_antes),
            "valor_depois": str(self.valor_depois),
            "operacao": self.operacao,
            "endpoint": self.endpoint,
            "payload": self.payload,
            "motivo": self.motivo,
            "origem": self.origem,
            "executada": self.executada,
            "id_omie": self.id_omie,
            "erro": self.erro,
            "quando": self.quando.isoformat() if self.quando else None,
        }


def planejar_atualizacao_valor_titulo(
    registro_atual: dict,
    novo_valor: Decimal,
    motivo: str,
) -> AtualizacaoValorTitulo:
    """Monta o plano de alteracao a partir do registro CRU e completo (a
    resposta de ConsultarContaPagar/ConsultarContaReceber) — nunca a partir
    de um Titulo resumido nem de um payload novo do zero, exatamente pra
    nao correr o risco de mandar um payload parcial que o Omie interprete
    como "apagar" os campos ausentes.

    Endpoint, operacao (AlterarContaPagar/AlterarContaReceber) e o campo de
    valor (`valor_documento`) confirmados na doc oficial (schema
    PHPJSONCLIENT de financas/contapagar e financas/contareceber,
    2026-09-21). O que ainda nao esta confirmado e a semantica de update
    (merge vs. substituicao total) — ver o bloco de comentario acima desta
    secao antes de usar isto com `executar=True` contra o Omie de verdade.
    """
    codigo = registro_atual.get("codigo_lancamento_omie") or registro_atual.get("nCodTitulo")
    if codigo is None:
        raise ValueError("registro_atual sem codigo_lancamento_omie/nCodTitulo")

    valor_atual = registro_atual.get("valor_documento")
    if valor_atual is None:
        valor_atual = registro_atual.get("nValorTitulo")
    valor_antes = Decimal(str(valor_atual)) if valor_atual is not None else Decimal("0")

    # O registro cru sozinho (resposta de ConsultarContaPagar/Receber) nao
    # diz de forma confirmada se e CP ou CR — quem chamou sabe, porque foi
    # quem escolheu qual consulta fazer. `tipo_registro` e uma chave que o
    # chamador acrescenta ao dict antes de passar pra ca (nao vem do Omie).
    tipo = registro_atual.get("tipo_registro") or "CP"

    payload = dict(registro_atual)  # copia do registro inteiro, nunca minimo
    payload["valor_documento"] = _num(novo_valor)

    operacao = "AlterarContaPagar" if tipo == "CP" else "AlterarContaReceber"
    endpoint = "financas/contapagar/" if tipo == "CP" else "financas/contareceber/"

    return AtualizacaoValorTitulo(
        titulo_id=str(codigo),
        tipo=tipo,
        valor_antes=valor_antes,
        valor_depois=novo_valor,
        operacao=operacao,
        endpoint=endpoint,
        payload=payload,
        motivo=motivo,
    )


async def executar_atualizacao_valor(
    atualizacao: AtualizacaoValorTitulo,
    client: Optional[ClienteOmie] = None,
    executar: bool = False,
) -> AtualizacaoValorTitulo:
    """`executar=False` (padrao): so devolve o plano, nunca chama a API —
    mesma postura de `gravar()`. `executar=True`: chama `client.call(...)` e
    preenche id_omie/erro/quando."""
    if not executar:
        return atualizacao
    if client is None:
        atualizacao.erro = "executar=True sem client"
        return atualizacao
    try:
        resposta = await client.call(
            atualizacao.endpoint, atualizacao.operacao, atualizacao.payload
        )
        atualizacao.executada = True
        atualizacao.quando = datetime.now()
        atualizacao.id_omie = str(
            resposta.get("codigo_lancamento_omie") or resposta.get("nCodTitulo") or ""
        ) or None
    except Exception as e:  # noqa: BLE001 — erro fica no plano, quem chamou decide o que fazer
        atualizacao.erro = f"{type(e).__name__}: {e}"
    return atualizacao


# ---------------------------------------------------------------------------

class ClienteFalso:
    """Cliente de teste: registra as chamadas em vez de mandar pro Omie."""

    def __init__(self, falhar_em: Sequence[str] = ()) -> None:
        self.chamadas: list[tuple[str, str, dict]] = []
        self.falhar_em = set(falhar_em)
        self._seq = 1000

    async def call(self, endpoint: str, call: str, param: dict) -> dict:
        self.chamadas.append((endpoint, call, param))
        if call in self.falhar_em:
            raise RuntimeError(f"Omie recusou {call} (simulado)")
        self._seq += 1
        return {"nCodLanc": self._seq}
