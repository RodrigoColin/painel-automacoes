"""Dicionario de descricoes bancarias -> lancamento direto em conta corrente.

Estes padroes sao propriedade do BANCO, nao do cliente: o vocabulario de tarifa,
rendimento e IOF e estavel por instituicao e se reaproveita em toda a carteira.
O cliente so sobrescreve a CATEGORIA (plano de contas dele), nunca o
reconhecimento.

Regra de ouro (ver motor.py): uma linha so vira lancamento direto se NAO houver
titulo plausivel. Juros/multa de boleto pertencem ao titulo, nao aqui.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from .modelos import LinhaExtrato, Natureza


class TipoDireto(str, Enum):
    TARIFA = "tarifa"
    RENDIMENTO = "rendimento"
    IOF = "iof"
    JUROS_CONTA = "juros_conta"
    IMPOSTO_FINANCEIRO = "imposto_financeiro"  # IRRF sobre rendimento
    APLICACAO = "aplicacao"   # transferencia p/ conta investimento
    RESGATE = "resgate"       # transferencia da conta investimento


@dataclass(frozen=True)
class PadraoBanco:
    termos: tuple[str, ...]
    tipo: TipoDireto
    natureza: Optional[Natureza] = None  # None = qualquer
    categoria_padrao: str = ""


# Padroes genericos — valem para a maioria dos bancos brasileiros.
PADROES_GENERICOS: tuple[PadraoBanco, ...] = (
    PadraoBanco(
        ("TARIFA", "TAR ", "CESTA DE SERVICOS", "PACOTE DE SERVICOS",
         "MANUTENCAO DE CONTA", "TAR PACOTE", "TAR MENSALIDADE",
         "CUSTO TED", "TAR TED", "TARIFA DOC", "TAR PIX", "TARIFA PIX",
         "TAR COBRANCA", "TARIFA BOLETO", "TAR EMISSAO BOLETO"),
        TipoDireto.TARIFA,
        Natureza.DEBITO,
        "Despesas Bancarias",
    ),
    PadraoBanco(
        ("RENDIMENTO", "REMUNERACAO", "RENDIMENTO BRUTO", "CREDITO RENDIMENTO",
         "RENDIMENTO CDB", "RENTABILIDADE", "JUROS S/ CAPITAL DISPONIVEL"),
        TipoDireto.RENDIMENTO,
        Natureza.CREDITO,
        "Receitas Financeiras",
    ),
    PadraoBanco(
        ("IOF",),
        TipoDireto.IOF,
        Natureza.DEBITO,
        "Despesas Bancarias",
    ),
    PadraoBanco(
        ("IRRF", "IR S/ RENDIMENTO", "IMPOSTO DE RENDA S/", "IR SOBRE APLICACAO"),
        TipoDireto.IMPOSTO_FINANCEIRO,
        Natureza.DEBITO,
        "Impostos sobre Aplicacoes",
    ),
    PadraoBanco(
        ("JUROS CHEQUE ESPECIAL", "JUROS DE LIMITE", "ENCARGOS", "JUROS ADIANT",
         "JUROS S/ LIMITE", "CPMF", "MULTA POR ATRASO LIMITE"),
        TipoDireto.JUROS_CONTA,
        Natureza.DEBITO,
        "Despesas Financeiras",
    ),
    PadraoBanco(
        ("APLICACAO", "APLIC AUT", "APLICACAO AUTOMATICA", "APLIC FINANC",
         "INVESTIMENTO APLIC"),
        TipoDireto.APLICACAO,
        Natureza.DEBITO,
        "",  # transferencia — categoria nao se aplica
    ),
    PadraoBanco(
        ("RESGATE", "RESG AUT", "RESGATE AUTOMATICO", "RESG APLIC",
         "RESG FINANC"),
        TipoDireto.RESGATE,
        Natureza.CREDITO,
        "",
    ),
)

# Padroes extras por banco, quando o vocabulario foge do generico.
# A chave e um identificador simples de banco usado na normalizacao.
PADROES_POR_BANCO: dict[str, tuple[PadraoBanco, ...]] = {
    "itau": (
        PadraoBanco(("TAR PCT SERVICOS", "CED PAGTO TARIFA"),
                    TipoDireto.TARIFA, Natureza.DEBITO, "Despesas Bancarias"),
        PadraoBanco(("APL AUT MAIS", "APLIC AUT MAIS"),
                    TipoDireto.APLICACAO, Natureza.DEBITO, ""),
        PadraoBanco(("RESG AUT MAIS",),
                    TipoDireto.RESGATE, Natureza.CREDITO, ""),
    ),
    "inter": (
        PadraoBanco(("RENDIMENTOS DA CONTA", "RENDIMENTO CDB INTER"),
                    TipoDireto.RENDIMENTO, Natureza.CREDITO, "Receitas Financeiras"),
    ),
    "santander": (
        PadraoBanco(("COBRANCA TARIFA", "TAR MENSALIDADE PACOTE"),
                    TipoDireto.TARIFA, Natureza.DEBITO, "Despesas Bancarias"),
    ),
    "btg": (
        PadraoBanco(("RENDIMENTO AUTOMATICO",),
                    TipoDireto.RENDIMENTO, Natureza.CREDITO, "Receitas Financeiras"),
    ),
    "sicredi": (
        PadraoBanco(("TAR CESTA RELACIONAMENTO",),
                    TipoDireto.TARIFA, Natureza.DEBITO, "Despesas Bancarias"),
    ),
}


def identificar(linha: LinhaExtrato) -> Optional[PadraoBanco]:
    """Devolve o padrao que reconhece a linha como lancamento direto, se houver."""
    descricao = _normalizar(linha.descricao)
    banco = (linha.banco or "").strip().lower()

    candidatos: list[PadraoBanco] = []
    candidatos.extend(PADROES_POR_BANCO.get(banco, ()))
    candidatos.extend(PADROES_GENERICOS)

    for padrao in candidatos:
        if padrao.natureza is not None and padrao.natureza is not linha.natureza:
            continue
        if any(termo in descricao for termo in padrao.termos):
            return padrao
    return None


def _normalizar(texto: str) -> str:
    """Maiusculas e sem acento — os bancos variam a acentuacao."""
    mapa = str.maketrans(
        "áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ",
        "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC",
    )
    return texto.translate(mapa).upper()
