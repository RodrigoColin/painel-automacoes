"""
De/Para serviço recorrente → serviço excedente.

Fonte da verdade: tabela public.excedentes_de_para no Postgres do painel
(decisão Rodrigo 2026-11-12 — o xlsx do SharePoint virou cópia exportada).
Um mapeamento é UTILIZÁVEL quando tem n_cod_serv_excedente; status
'confirmar'/'revisar' usa mas carrega o aviso "mapeamento a confirmar"
(comportamento do gabarito de novembro). Sem mapeamento utilizável, a
linha vira exceção — o portal pode sugerir pelo catálogo, mas quem
confirma é o analista (e a confirmação grava aqui, com histórico).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MapeamentoExcedente:
    cod_recorrente: str
    n_cod_serv_recorrente: int | None
    cod_excedente: str | None
    descricao_excedente: str | None
    n_cod_serv_excedente: int | None
    categoria_excedente: str | None
    status: str

    @property
    def utilizavel(self) -> bool:
        return bool(self.n_cod_serv_excedente)

    @property
    def a_confirmar(self) -> bool:
        return self.status in ("confirmar", "revisar")


def n_cod_cc_padrao(conn, empresa_id: str) -> int | None:
    """Conta corrente (nCodCC) padrão da empresa para OS sem contrato.
    O Omie exige nCodCC na inclusão; OS sem contrato não herda de lugar
    nenhum (ver migração 0015_excedentes_config)."""
    with conn.cursor() as cur:
        cur.execute(
            "select n_cod_cc_padrao from public.excedentes_config where empresa_id = %s",
            (empresa_id,),
        )
        linha = cur.fetchone()
    return int(linha[0]) if linha and linha[0] else None


def carregar(conn, empresa_id: str) -> dict[str, MapeamentoExcedente]:
    """Mapa cod_recorrente → MapeamentoExcedente da empresa."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select cod_recorrente, n_cod_serv_recorrente, cod_excedente,
                   descricao_excedente, n_cod_serv_excedente,
                   categoria_excedente, status
            from public.excedentes_de_para
            where empresa_id = %s
            """,
            (empresa_id,),
        )
        linhas = cur.fetchall()
    mapa: dict[str, MapeamentoExcedente] = {}
    for cod, n_rec, cod_exc, desc_exc, n_exc, cat, status in linhas:
        mapa[str(cod)] = MapeamentoExcedente(
            cod_recorrente=str(cod),
            n_cod_serv_recorrente=int(n_rec) if n_rec else None,
            cod_excedente=str(cod_exc) if cod_exc else None,
            descricao_excedente=desc_exc,
            n_cod_serv_excedente=int(n_exc) if n_exc else None,
            categoria_excedente=cat,
            status=str(status or "automatico"),
        )
    return mapa
