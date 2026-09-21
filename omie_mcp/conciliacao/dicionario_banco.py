"""Dicionario de descricoes bancarias -> lancamento direto em conta corrente.

Estes padroes sao propriedade do BANCO, nao do cliente: o vocabulario de tarifa,
rendimento e IOF e estavel por instituicao e se reaproveita em toda a carteira.
O cliente so sobrescreve a CATEGORIA (plano de contas dele), nunca o
reconhecimento.

Regra de ouro (ver motor.py): uma linha so vira lancamento direto se NAO houver
titulo plausivel. Juros/multa de boleto pertencem ao titulo, nao aqui.

CONFERIR: `categoria_padrao` precisa ser o CODIGO da categoria no Omie (ex.:
"2.05.04"), nao o nome — o campo cCodCateg da API rejeita nome solto. So o
codigo de TARIFA/IOF ("2.05.04", Despesas Bancarias) foi confirmado ao vivo
contra a Proos em 2026-09-21; "Receitas Financeiras", "Despesas Financeiras"
e "Impostos sobre Aplicacoes" continuam como nome (nunca testados, quebrariam
a escrita da mesma forma). Alem disso, plano de contas e POR CLIENTE — o
codigo confirmado pra Proos pode nao existir ou significar outra coisa em
outra empresa; validar de novo antes de habilitar escrita em cliente novo.
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
    FATURA_CARTAO = "fatura_cartao"  # transferencia p/ conta do cartao de credito
    CONTA_GARANTIDA = "conta_garantida"  # uso/pagamento de linha de credito rotativo
    RECEBIMENTO_COBRANCA = "recebimento_cobranca"  # credito consolidado de boletos


@dataclass(frozen=True)
class PadraoBanco:
    termos: tuple[str, ...] = ()
    tipo: TipoDireto = TipoDireto.TARIFA
    natureza: Optional[Natureza] = None  # None = qualquer
    categoria_padrao: str = ""
    # Quando preenchido, TODOS os grupos aqui precisam ter pelo menos um
    # termo presente (AND entre grupos, OR dentro de cada grupo) — usado
    # quando a frase varia demais entre bancos pra listar cada combinacao
    # exata (ex.: precisa de "fatura" [ou a abreviacao "fat."/"fat "] E
    # "cartao" [ou "cart"], em qualquer ordem/pontuacao — confirmado real:
    # "FAT.CARTAO", "FATURA DO CARTAO", "DEBITO AUTOMATICO FATURA CARTAO").
    termos_e: tuple[tuple[str, ...], ...] = ()


# Padroes genericos — valem para a maioria dos bancos brasileiros.
PADROES_GENERICOS: tuple[PadraoBanco, ...] = (
    PadraoBanco(
        ("TARIFA", "TAR ", "CESTA DE SERVICOS", "PACOTE DE SERVICOS",
         "MANUTENCAO DE CONTA", "TAR PACOTE", "TAR MENSALIDADE",
         "CUSTO TED", "TAR TED", "TARIFA DOC", "TAR PIX", "TARIFA PIX",
         "TAR COBRANCA", "TARIFA BOLETO", "TAR EMISSAO BOLETO"),
        TipoDireto.TARIFA,
        Natureza.DEBITO,
        "2.05.04",  # "Despesas Bancarias" — codigo confirmado ao vivo (Proos, 2026-09-21)
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
        "2.05.04",  # ver nota acima — mesmo codigo confirmado da TARIFA
    ),
    PadraoBanco(
        ("IRRF", "IR S/ RENDIMENTO", "IMPOSTO DE RENDA S/", "IR SOBRE APLICACAO"),
        TipoDireto.IMPOSTO_FINANCEIRO,
        Natureza.DEBITO,
        "Impostos sobre Aplicacoes",
    ),
    PadraoBanco(
        ("JUROS CHEQUE ESPECIAL", "JUROS DE LIMITE", "JUROS LIMITE", "ENCARGOS",
         "JUROS ADIANT", "JUROS S/ LIMITE", "CPMF", "MULTA POR ATRASO LIMITE",
         # "JUROS LIMITE" (sem "DE") e "IMPOSTO CHEQUE ESPECIAL" confirmados
         # reais no Inter (Eskda, 2026-09-21) — mesmo grupo (encargo de
         # limite de credito/cheque especial).
         "IMPOSTO CHEQUE ESPECIAL"),
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
    PadraoBanco(
        # "CONTA GARANTIDA" cobre os dois sentidos ("USO CONTA GARANTIDA",
        # credito — sacando da linha; "PAGAMENTO CONTA GARANTIDA", debito —
        # devolvendo) com um unico termo, confirmado real em duas empresas
        # (Acordo Fechado, Startlaw, 2026-09-21). natureza=None de proposito:
        # os dois sentidos sao validos.
        ("CONTA GARANTIDA",),
        TipoDireto.CONTA_GARANTIDA,
        None,
        "",
    ),
    PadraoBanco(
        tipo=TipoDireto.FATURA_CARTAO,
        natureza=Natureza.DEBITO,
        categoria_padrao="",  # transferencia — categoria nao se aplica
        # Confirmado em texto real de 4 bancos (Itau, Inter, BTG, Santander,
        # 2026-09-21): a frase varia demais pra listar cada combinacao —
        # precisa de ("FATURA" ou a abreviacao "FAT.") E "CART" juntos.
        termos_e=(("FATURA", "FAT."), ("CART",)),
    ),
    PadraoBanco(
        # Credito consolidado de boletos liquidados (varios clientes, um so
        # lancamento) — o Itau chama "BOLETOS RECEBIDOS" (aparece quase
        # todo dia util em qualquer conta que recebe por boleto), o Inter
        # "Boleto de cobranca recebido". Motor NUNCA decompoe isso em N
        # titulos sozinho — decisao explicita do usuario, 2026-09-21: e
        # o arquivo retorno (importado no Omie) que faz essa decomposicao;
        # ate acontecer, so pendencia.
        ("BOLETOS RECEBIDO", "BOLETO DE COBRANCA RECEBIDO",
         "RECEBIMENTO DE COBRANCA", "LIQUIDACAO DE COBRANCA"),
        TipoDireto.RECEBIMENTO_COBRANCA,
        Natureza.CREDITO,
        "",
    ),
)

# Padroes extras por banco, quando o vocabulario foge do generico.
# A chave e um identificador simples de banco usado na normalizacao.
PADROES_POR_BANCO: dict[str, tuple[PadraoBanco, ...]] = {
    "itau": (
        PadraoBanco(("TAR PCT SERVICOS", "CED PAGTO TARIFA"),
                    TipoDireto.TARIFA, Natureza.DEBITO, "2.05.04"),
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
                    TipoDireto.TARIFA, Natureza.DEBITO, "2.05.04"),
    ),
    "btg": (
        PadraoBanco(("RENDIMENTO AUTOMATICO",),
                    TipoDireto.RENDIMENTO, Natureza.CREDITO, "Receitas Financeiras"),
    ),
    "sicredi": (
        PadraoBanco(("TAR CESTA RELACIONAMENTO",),
                    TipoDireto.TARIFA, Natureza.DEBITO, "2.05.04"),
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
        if padrao.termos_e:
            if all(
                any(termo in descricao for termo in grupo)
                for grupo in padrao.termos_e
            ):
                return padrao
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
