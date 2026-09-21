"""Aprendizado: cada decisao do operador vira regra do cliente.

E o que faz a fila encolher mes a mes — e, no modelo servico-como-servico, e
onde a margem aparece: menos minutos de operador por 100 linhas.

Duas coisas acontecem aqui:

1. `registrar_decisao()` — o operador confirmou/corrigiu algo. Extraimos o
   trecho estavel da descricao bancaria (tirando numero de documento, data,
   valor e outros ruidos que mudam a cada linha) e criamos ou reforcamos uma
   regra. Com `confirmacoes >= N`, a regra passa a decidir sozinha.

2. `calibrar()` — compara o que o motor sugeriu com o que o operador decidiu e
   diz se da pra baixar o corte automatico (ganhar automacao) ou se precisa
   subir (esta errando demais). A metrica que governa: retrabalho, ou seja,
   conciliacao automatica que o operador desfez.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable, Optional, Sequence

from .dicionario_banco import _normalizar
from .modelos import Desfecho, Faixa, LinhaExtrato, RegraCliente, Resultado


# ---------------------------------------------------------------------------
# extracao do padrao estavel da descricao
# ---------------------------------------------------------------------------

_RUIDO = (
    (re.compile(r"\b\d{2}/\d{2}/\d{2,4}\b"), " "),        # datas
    (re.compile(r"\b\d{1,3}(?:\.\d{3})*,\d{2}\b"), " "),  # valores
    (re.compile(r"\bNF\s*-?\s*\d+\b"), " "),              # nota fiscal
    (re.compile(r"\bDOC\s*\d+\b"), " "),
    (re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b"), " "),  # CNPJ
    (re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"), " "),         # CPF
    (re.compile(r"\b\d{5,}\b"), " "),                     # ids longos
    (re.compile(r"[^A-Z0-9 ]+"), " "),
    (re.compile(r"\s{2,}"), " "),
)

_PALAVRAS_VAZIAS = {
    "PAGTO", "PAGAMENTO", "RECEBIMENTO", "CREDITO", "DEBITO", "PIX",
    "TED", "DOC", "TRANSFERENCIA", "ENVIADO", "RECEBIDO", "LIQUIDACAO",
    "COBRANCA", "BOLETO", "TITULO", "REF", "DE", "DA", "DO", "PARA",
    "LTDA", "ME", "EIRELI", "SA", "EPP", "MEI",
}


def extrair_padrao(descricao: str, minimo_tokens: int = 1) -> Optional[str]:
    """Reduz a descricao bancaria ao trecho que se repete entre lancamentos.

    'PIX ENVIADO 12/09 JOSE SILVA ME 123456' -> 'JOSE SILVA'
    """
    texto = _normalizar(descricao)
    for padrao, troca in _RUIDO:
        texto = padrao.sub(troca, texto)

    tokens = [
        t for t in texto.split()
        if len(t) > 2 and t not in _PALAVRAS_VAZIAS and not t.isdigit()
    ]
    if len(tokens) < minimo_tokens:
        return None
    # ate 3 tokens bastam para identificar a contraparte sem ficar restritivo
    return " ".join(tokens[:3])


# ---------------------------------------------------------------------------
# registro de decisao
# ---------------------------------------------------------------------------

@dataclass
class Decisao:
    """O que o operador fez com uma linha."""

    linha: LinhaExtrato
    desfecho: Desfecho
    titulo_id: Optional[str] = None
    categoria: Optional[str] = None
    parceiro_id: Optional[str] = None
    conta_destino_id: Optional[str] = None
    sugestao_motor: Optional[Resultado] = None
    quem: str = ""
    quando: Optional[date] = None

    @property
    def confirmou_o_motor(self) -> bool:
        s = self.sugestao_motor
        if s is None:
            return False
        if s.desfecho is not self.desfecho:
            return False
        if self.desfecho is Desfecho.TITULO:
            sugerido = s.candidato.titulo.id if s.candidato else None
            return sugerido == self.titulo_id
        return True


def registrar_decisao(
    decisao: Decisao,
    regras: list[RegraCliente],
    minimo_tokens: int = 1,
) -> Optional[RegraCliente]:
    """Cria ou reforca a regra correspondente. Devolve a regra afetada.

    So aprende padrao de CLASSIFICACAO (lancamento direto e transferencia).
    Titulo nao vira regra: cada titulo e um evento unico — o que se aprende ali
    e o vinculo descricao->parceiro, que entra como `parceiro_id`.
    """
    if decisao.desfecho is Desfecho.FILA:
        return None  # adiar/pendencia nao ensina nada

    padrao = extrair_padrao(decisao.linha.descricao, minimo_tokens)
    if not padrao:
        return None

    for regra in regras:
        if regra.padrao == padrao and regra.desfecho is decisao.desfecho:
            regra.confirmacoes += 1
            # a decisao mais recente prevalece nos detalhes
            if decisao.categoria:
                regra.categoria = decisao.categoria
            if decisao.parceiro_id:
                regra.parceiro_id = decisao.parceiro_id
            if decisao.conta_destino_id:
                regra.conta_destino_id = decisao.conta_destino_id
            return regra

    # decisao que CONTRARIA uma regra existente zera a confianca dela:
    # o operador acabou de dizer que aquele padrao nao e mais aquilo
    for regra in regras:
        if regra.padrao == padrao and regra.desfecho is not decisao.desfecho:
            regra.confirmacoes = 1
            regra.desfecho = decisao.desfecho
            regra.categoria = decisao.categoria
            regra.parceiro_id = decisao.parceiro_id
            regra.conta_destino_id = decisao.conta_destino_id
            return regra

    nova = RegraCliente(
        padrao=padrao,
        desfecho=decisao.desfecho,
        categoria=decisao.categoria,
        parceiro_id=decisao.parceiro_id,
        conta_destino_id=decisao.conta_destino_id,
        confirmacoes=1,
    )
    regras.append(nova)
    return nova


# ---------------------------------------------------------------------------
# calibracao dos cortes
# ---------------------------------------------------------------------------

@dataclass
class Calibracao:
    avaliadas: int
    acertos: int
    erros_na_faixa_automatica: int
    retrabalho: float             # % de automaticas que o operador desfez
    acerto_geral: float
    corte_sugerido: Optional[int]
    recomendacao: str

    def __str__(self) -> str:
        return (
            f"{self.avaliadas} decisoes | acerto {self.acerto_geral:.1%} | "
            f"retrabalho {self.retrabalho:.1%} | {self.recomendacao}"
        )


def calibrar(
    decisoes: Sequence[Decisao],
    corte_atual: int = 90,
    retrabalho_maximo: float = 0.02,
) -> Calibracao:
    """Diz se da pra ganhar automacao ou se e preciso apertar o corte.

    A regra: enquanto o retrabalho na faixa automatica ficar abaixo do limite,
    da pra baixar o corte e automatizar mais. Se passar, sobe o corte — errar
    silenciosamente e o unico risco que nao se aceita.
    """
    com_sugestao = [d for d in decisoes if d.sugestao_motor is not None]
    if not com_sugestao:
        return Calibracao(0, 0, 0, 0.0, 0.0, None, "sem dados suficientes")

    acertos = sum(1 for d in com_sugestao if d.confirmou_o_motor)
    automaticas = [
        d for d in com_sugestao if d.sugestao_motor.faixa is Faixa.AUTOMATICO
    ]
    erros_auto = sum(1 for d in automaticas if not d.confirmou_o_motor)
    retrabalho = erros_auto / len(automaticas) if automaticas else 0.0
    acerto_geral = acertos / len(com_sugestao)

    if retrabalho > retrabalho_maximo:
        corte = min(99, corte_atual + 5)
        rec = (
            f"SUBIR o corte para {corte}: {erros_auto} conciliacao(oes) "
            f"automatica(s) foram desfeitas pelo operador."
        )
    else:
        # quanto ganhariamos baixando o corte? olha a faixa de revisao
        revisao = [
            d for d in com_sugestao if d.sugestao_motor.faixa is Faixa.REVISAO
        ]
        confirmadas = [d for d in revisao if d.confirmou_o_motor]
        if revisao and len(confirmadas) / len(revisao) >= 0.97 and len(revisao) >= 20:
            scores = sorted(d.sugestao_motor.score for d in confirmadas)
            corte = max(60, scores[0]) if scores else corte_atual
            rec = (
                f"BAIXAR o corte para {corte}: a faixa de revisao foi confirmada "
                f"em {len(confirmadas)}/{len(revisao)} casos — automatizavel."
            )
        else:
            corte = None
            rec = "MANTER o corte: sem evidencia suficiente para mexer ainda."

    return Calibracao(
        avaliadas=len(com_sugestao),
        acertos=acertos,
        erros_na_faixa_automatica=erros_auto,
        retrabalho=retrabalho,
        acerto_geral=acerto_geral,
        corte_sugerido=corte,
        recomendacao=rec,
    )


# ---------------------------------------------------------------------------
# persistencia simples (JSON) — o backend trocara por Postgres
# ---------------------------------------------------------------------------

def regras_para_json(regras: Iterable[RegraCliente]) -> list[dict]:
    return [
        {
            "padrao": r.padrao,
            "desfecho": r.desfecho.value,
            "categoria": r.categoria,
            "parceiro_id": r.parceiro_id,
            "conta_destino_id": r.conta_destino_id,
            "confirmacoes": r.confirmacoes,
        }
        for r in regras
    ]


def regras_de_json(dados: Iterable[dict]) -> list[RegraCliente]:
    return [
        RegraCliente(
            padrao=d["padrao"],
            desfecho=Desfecho(d["desfecho"]),
            categoria=d.get("categoria"),
            parceiro_id=d.get("parceiro_id"),
            conta_destino_id=d.get("conta_destino_id"),
            confirmacoes=int(d.get("confirmacoes", 1)),
        )
        for d in dados
    ]
