"""Modelos de dados da conciliacao bancaria (Proos).

Python puro, sem dependencia de rede nem da API Omie. O motor so conhece
"linha normalizada" e "candidato" — de onde o extrato veio (OFX, Open Finance,
API do banco) nao importa aqui.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Any, Optional


class Natureza(str, Enum):
    """Sinal do movimento na conta."""

    CREDITO = "C"  # dinheiro entrou
    DEBITO = "D"   # dinheiro saiu


class Desfecho(str, Enum):
    """Os quatro desfechos possiveis de uma linha de extrato."""

    TITULO = "titulo"                # casou com um CP/CR do ERP
    LANCAMENTO_DIRETO = "lanc_direto"  # tarifa, rendimento, IOF, juros de conta
    TRANSFERENCIA = "transferencia"  # entre contas da propria empresa
    FILA = "fila"                    # exige decisao humana


class Faixa(str, Enum):
    """Faixa de confianca — define o que acontece com o desfecho."""

    AUTOMATICO = "automatico"  # grava sozinho no ERP
    REVISAO = "revisao"        # candidato pre-selecionado, um toque confirma
    EXCECAO = "excecao"        # vai pra fila tipificada


class TipoExcecao(str, Enum):
    SEM_TITULO_SAIDA = "sem_titulo_saida"
    SEM_TITULO_ENTRADA = "sem_titulo_entrada"
    DIVERGENCIA_VALOR = "divergencia_valor"
    AMBIGUIDADE = "ambiguidade"
    TRANSFERENCIA_SEM_PAR = "transferencia_sem_par"
    CADASTRO = "cadastro"
    DUPLICIDADE = "duplicidade"


@dataclass
class LinhaExtrato:
    """Uma linha do extrato bancario, ja normalizada."""

    id: str                      # FITID do OFX ou id da fonte
    conta_id: str                # conta corrente no nosso cadastro
    data: date
    valor: Decimal               # sempre positivo; o sinal vive em `natureza`
    natureza: Natureza
    descricao: str               # descricao bruta do banco
    contraparte_nome: Optional[str] = None
    contraparte_documento: Optional[str] = None  # CNPJ/CPF quando disponivel
    banco: Optional[str] = None  # usado pelo dicionario de tarifas por banco
    fonte: str = "ofx"

    @property
    def valor_com_sinal(self) -> Decimal:
        return self.valor if self.natureza is Natureza.CREDITO else -self.valor


@dataclass
class Titulo:
    """Um titulo em aberto no ERP (contas a pagar ou a receber)."""

    id: str                      # codigo_lancamento_omie
    tipo: str                    # "CP" ou "CR"
    vencimento: date
    valor: Decimal               # valor liquido esperado
    parceiro_nome: str           # fornecedor ou cliente
    parceiro_documento: Optional[str] = None
    numero_documento: Optional[str] = None
    categoria: Optional[str] = None
    tem_documento_anexo: bool = False
    conciliado: bool = False     # ja baixado/conciliado no ERP

    @property
    def natureza_esperada(self) -> Natureza:
        return Natureza.DEBITO if self.tipo == "CP" else Natureza.CREDITO


@dataclass
class Evidencia:
    """Um fato que soma (ou subtrai) pontos no score.

    Guardar as evidencias e o que permite auditar depois *por que* o motor
    decidiu o que decidiu — e e o contexto que a IA usa no residuo.
    """

    nome: str
    pontos: int
    detalhe: str = ""


@dataclass
class Candidato:
    """Um titulo avaliado contra uma linha, com score e evidencias."""

    titulo: Titulo
    score: int = 0
    evidencias: list[Evidencia] = field(default_factory=list)
    diferenca: Decimal = Decimal("0")
    explicacao_diferenca: Optional[str] = None
    parcial: bool = False

    def somar(self, nome: str, pontos: int, detalhe: str = "") -> None:
        self.evidencias.append(Evidencia(nome, pontos, detalhe))
        self.score += pontos


@dataclass
class Resultado:
    """O que o motor decidiu para uma linha."""

    linha: LinhaExtrato
    desfecho: Desfecho
    faixa: Faixa
    score: int = 0
    candidato: Optional[Candidato] = None
    descartados: list[Candidato] = field(default_factory=list)
    categoria_sugerida: Optional[str] = None
    linha_par_id: Optional[str] = None       # outra ponta da transferencia (id da linha)
    conta_destino_id: Optional[str] = None   # conta corrente da outra ponta (id de conta, p/ escrita)
    valor_tarifa: Decimal = Decimal("0")     # diferenca lancada como tarifa embutida na transferencia
    tipo_excecao: Optional[TipoExcecao] = None
    motivo: str = ""
    evidencias: list[Evidencia] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "linha_id": self.linha.id,
            "data": self.linha.data.isoformat(),
            "valor": str(self.linha.valor_com_sinal),
            "descricao": self.linha.descricao,
            "desfecho": self.desfecho.value,
            "faixa": self.faixa.value,
            "score": self.score,
            "titulo_id": self.candidato.titulo.id if self.candidato else None,
            "titulo_parceiro": (
                self.candidato.titulo.parceiro_nome if self.candidato else None
            ),
            "titulo_valor": (
                str(self.candidato.titulo.valor) if self.candidato else None
            ),
            "titulo_vencimento": (
                self.candidato.titulo.vencimento.isoformat()
                if self.candidato else None
            ),
            "titulo_tem_documento": (
                self.candidato.titulo.tem_documento_anexo
                if self.candidato else None
            ),
            "diferenca": str(self.candidato.diferenca) if self.candidato else None,
            "descartados": [
                {
                    "titulo_id": c.titulo.id,
                    "parceiro": c.titulo.parceiro_nome,
                    "valor": str(c.titulo.valor),
                    "vencimento": c.titulo.vencimento.isoformat(),
                    "score": c.score,
                }
                for c in self.descartados
            ],
            "categoria": self.categoria_sugerida,
            "linha_par_id": self.linha_par_id,
            "conta_destino_id": self.conta_destino_id,
            "valor_tarifa": str(self.valor_tarifa) if self.valor_tarifa else None,
            "tipo_excecao": self.tipo_excecao.value if self.tipo_excecao else None,
            "motivo": self.motivo,
            "evidencias": [
                {"nome": e.nome, "pontos": e.pontos, "detalhe": e.detalhe}
                for e in (self.candidato.evidencias if self.candidato else self.evidencias)
            ],
        }


@dataclass
class RegraCliente:
    """Padrao aprendido: descricao bruta -> classificacao.

    Alimentada por cada confirmacao do operador. Depois de N confirmacoes
    iguais, `confirmacoes` sobe e a regra passa a decidir sozinha.
    """

    padrao: str                  # trecho da descricao, comparado em maiusculas
    desfecho: Desfecho
    categoria: Optional[str] = None
    parceiro_id: Optional[str] = None
    conta_destino_id: Optional[str] = None  # para transferencia
    confirmacoes: int = 1

    def casa(self, linha: LinhaExtrato) -> bool:
        import re
        return re.search(
            r"(?<![A-Z0-9])" + re.escape(self.padrao.upper()) + r"(?![A-Z0-9])",
            linha.descricao.upper(),
        ) is not None
