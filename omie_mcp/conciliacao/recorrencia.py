"""Localiza o titulo do MES SEGUINTE de uma recorrencia do Omie (ex.: Simples
Nacional/DAS — despesa recorrente cujas parcelas futuras ja existem no Omie,
pre-criadas no valor original, e que vai ficando cada vez mais errado porque
o valor real muda todo mes com o faturamento).

Python puro, sem rede — mesma familia de `modelos.py`/`motor.py`.

O Omie NAO expoe nenhum campo que ligue uma parcela de recorrencia a
proxima — confirmado tanto por leitura de codigo/busca no repo quanto na
doc oficial (schema PHPJSONCLIENT de financas/contareceber, 2026-09-21): o
objeto `repeticao` (Incluir/AlterarContaReceber) so CONFIGURA quantas
parcelas e a periodicidade na hora de criar a recorrencia — nao carrega
nenhum identificador de serie, e nem ConsultarContaReceber nem
ListarContasReceber o devolvem depois. `Titulo` (o modelo interno deste
projeto) so tem id/tipo/vencimento/valor/parceiro_nome/parceiro_documento/
numero_documento/categoria/tem_documento_anexo/conciliado. Por isso a busca
aqui e HEURISTICA (mesmo parceiro + mesma categoria + vencimento no mes
alvo + ainda em aberto) — nao e um atalho provisorio, e a unica forma
possivel de encontrar "a proxima parcela". E por isso mesmo ela e estrita:
qualquer ambiguidade (0 ou 2+ candidatos) aborta em vez de adivinhar. Nunca
decide sozinha; quem confirma e sempre o operador (ver scripts/atualizar_
titulo_recorrente.py).
"""

from __future__ import annotations

from typing import Optional, Sequence

from .modelos import Titulo


class AmbiguidadeRecorrencia(Exception):
    """Zero ou mais de um titulo candidato pro mes seguinte — a heuristica
    (parceiro+categoria+mes) nao foi suficiente pra apontar um so titulo.
    Nunca adivinha: quem chamou precisa resolver via --titulo-destino
    explicito."""


def _mes_seguinte(ano: int, mes: int) -> tuple[int, int]:
    return (ano + 1, 1) if mes == 12 else (ano, mes + 1)


def localizar_titulo_recorrente_seguinte(
    titulo_referencia: Titulo,
    todos_titulos: Sequence[Titulo],
    mes_alvo: Optional[tuple[int, int]] = None,
) -> Titulo:
    """Acha, entre `todos_titulos`, o titulo que e a proxima parcela da
    mesma recorrencia de `titulo_referencia`.

    `mes_alvo` e (ano, mes); por padrao e o mes seguinte ao vencimento de
    `titulo_referencia`. Levanta `AmbiguidadeRecorrencia` se nao achar
    exatamente 1 candidato — o dia do vencimento fica livre de proposito
    (o dia que o Omie usa pra gerar a parcela pode nao ser identico todo
    mes), so ano/mes importam.
    """
    ano_alvo, mes_alvo_num = (
        mes_alvo if mes_alvo is not None
        else _mes_seguinte(titulo_referencia.vencimento.year, titulo_referencia.vencimento.month)
    )

    candidatos = [
        t for t in todos_titulos
        if t.id != titulo_referencia.id
        and t.tipo == titulo_referencia.tipo
        and t.parceiro_nome == titulo_referencia.parceiro_nome
        and t.categoria == titulo_referencia.categoria
        and not t.conciliado
        and t.vencimento.year == ano_alvo
        and t.vencimento.month == mes_alvo_num
    ]

    if len(candidatos) != 1:
        ids = [t.id for t in candidatos]
        motivo = "nenhum titulo compativel encontrado" if not ids else f"{len(ids)} titulos compativeis: {ids}"
        raise AmbiguidadeRecorrencia(
            f"Titulo do mes seguinte ({ano_alvo:04d}-{mes_alvo_num:02d}) pra "
            f"'{titulo_referencia.parceiro_nome}' (categoria "
            f"{titulo_referencia.categoria}) e ambiguo: {motivo}. "
            "Use --titulo-destino pra apontar o titulo certo direto."
        )
    return candidatos[0]
