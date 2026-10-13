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
    # Casou com um titulo que o Omie JA recebeu/baixou (ex.: PIX QR sem
    # contraparte no extrato, mas o recebimento ja existe no Omie com o
    # cliente). O motor roda DEPOIS do CNAB/baixa, entao nao cria baixa — so
    # amarra a linha do extrato ao recebimento que ja existe. Nunca gera
    # escrita (a camada de escrita ignora este desfecho). Recupera QUEM pagou,
    # que o banco escondeu. Decisao: Rodrigo, 2026-10-13.
    CONCILIAR_RECEBIDO = "conciliar_recebido"
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
    # Recebimento consolidado de boleto (credito de cobranca representando
    # varios boletos liquidados de uma vez) sem titulo individual batendo —
    # decisao explicita do usuario, 2026-09-21: NUNCA concilia nem cria
    # lancamento pra isso aqui. O motor so decompoe 1 linha <-> 1 titulo;
    # decompor o credito consolidado em N titulos e o que o arquivo retorno
    # (importado no Omie) resolve. Ate isso acontecer, e so pendencia — a
    # ser sinalizada no Portal Proos, nao decidida as cegas.
    AGUARDANDO_RETORNO_BOLETO = "aguardando_retorno_boleto"
    # Padrao reconhecido (o cliente sabe exatamente o que essa descricao
    # costuma ser), mas o proprio cliente decidiu que NUNCA quer decisao
    # automatica pra ele — sempre revisao humana. Decisao explicita do
    # usuario, 2026-09-21: "PIX Rodrigo, sempre pergunte" (pode ser
    # pro-labore, distribuicao de lucro ou outra coisa; so o operador sabe
    # qual, olhando o contexto do mes — nao da pra advinhar so pelo texto
    # do banco, mesmo com o nome presente). Ver RegraCliente.sempre_revisao.
    CONFIRMACAO_MANUAL = "confirmacao_manual"


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
class RecebimentoOmie:
    """Um titulo que o Omie JA recebeu/baixou no periodo (CR liquidado).

    Fonte: `financas/mf:ListarMovimentos` (cTipo/cNatureza=R), deduplicado por
    titulo. Usado SO para o passo CONCILIAR_RECEBIDO — casar uma linha de
    credito do extrato (ex.: PIX QR sem contraparte) com o recebimento que o
    Omie ja fez, recuperando o cliente. Nao entra na busca de titulo em aberto.
    """

    id: str                      # nCodTitulo
    valor: Decimal
    data: date                   # dDtPagamento (data em que o Omie recebeu)
    parceiro_nome: str = ""
    parceiro_documento: Optional[str] = None
    tipo_documento: Optional[str] = None  # cTipo: BOL, NFS, 99999...
    conta_corrente_id: Optional[str] = None  # nCodCC onde o titulo foi baixado


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
class AplicacaoTitulo:
    """Quanto de uma linha foi aplicado a um titulo especifico, dentro de uma
    cascata (pagamento parcelado drenando uma fila de titulos do mesmo
    parceiro+categoria — ex.: distribuicao de lucro paga aos poucos: quando o
    total pago ultrapassa o titulo aberto, o excedente drena o proximo titulo
    da fila, mais antigo primeiro)."""

    titulo: Titulo
    valor: Decimal


@dataclass
class Candidato:
    """Um titulo avaliado contra uma linha, com score e evidencias."""

    titulo: Titulo
    score: int = 0
    evidencias: list[Evidencia] = field(default_factory=list)
    diferenca: Decimal = Decimal("0")
    explicacao_diferenca: Optional[str] = None
    parcial: bool = False
    # Preenchido (2+ itens) quando o pagamento drenou mais de um titulo em
    # sequencia. `titulo` acima sempre aponta pro primeiro (mais antigo) da
    # cascata, pra continuar compativel com quem so olha esse campo.
    cascata: list[AplicacaoTitulo] = field(default_factory=list)
    # True quando a identificacao do parceiro veio de uma RegraCliente com
    # `parceiro_nome_esperado` (descricao de lote como "SISPAG SALARIOS",
    # sem NENHUM nome/documento no texto do banco). Forca REVISAO sempre,
    # do mesmo jeito que `parcial` — mesmo que o score aritmetico cruze
    # corte_automatico, essa identificacao nunca teve confirmacao textual
    # direta da linha, so a palavra do cliente sobre o que aquele padrao
    # SEMPRE significa. Achado real: Proos, 2026-09-21 (SISPAG SALARIOS).
    via_regra_lote: bool = False

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
            "cascata": (
                [
                    {"titulo_id": a.titulo.id, "valor": str(a.valor)}
                    for a in self.candidato.cascata
                ]
                if self.candidato and len(self.candidato.cascata) >= 2
                else None
            ),
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
    # Descricoes de lote (ex.: "SISPAG SALARIOS", pagamento de folha em
    # lote) nao trazem NENHUM nome/documento do beneficiario — o padrao
    # de texto normal (`padrao.upper() in nome_do_titulo`) nunca bate,
    # porque nao ha nada pra bater. Quando preenchido, a regra declara o
    # parceiro esperado diretamente, sem exigir que o padrao apareca no
    # nome (achado real: Proos, 2026-09-21 — SISPAG SALARIOS sempre e
    # Rodrigo Rubio Colin, mas o texto do banco nunca diz isso).
    parceiro_nome_esperado: Optional[str] = None
    # Desambigua candidatos que compartilham o MESMO texto de banco mas
    # sao categorias diferentes (mesmo achado: "SISPAG SALARIOS" de
    # R$1.442,69 e sempre pro-labore recorrente; qualquer outro valor e
    # distribuicao de lucro parcelada). None = regra vale pra qualquer
    # valor da linha. So um dos dois deve ser usado por regra.
    valor_exato: Optional[Decimal] = None
    valor_exceto: Optional[Decimal] = None
    # Quando True, o motor NUNCA decide sozinho pra esse padrao — vai direto
    # pra FILA/CONFIRMACAO_MANUAL assim que a regra casa, antes de avaliar
    # titulo, transferencia ou dicionario. Diferente de `parceiro_nome_esperado`
    # (que identifica QUEM e o parceiro pra ajudar a pontuar): aqui o padrao
    # pode ate identificar o parceiro com certeza (ex.: o nome esta na
    # descricao), mas o SIGNIFICADO do lancamento (pro-labore? distribuicao
    # de lucro? outra coisa?) so o operador sabe olhando o contexto do mes.
    # Achado real: Proos, 2026-09-21 — "PIX Rodrigo, sempre pergunte".
    sempre_revisao: bool = False

    def casa(self, linha: LinhaExtrato) -> bool:
        import re
        return re.search(
            r"(?<![A-Z0-9])" + re.escape(self.padrao.upper()) + r"(?![A-Z0-9])",
            linha.descricao.upper(),
        ) is not None
