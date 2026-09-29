"""
Marcação das contas correntes: o que é caixa, o que é dívida.

Mesma regra de `src/lib/omie/fluxo-caixa.ts` (configPadrao): sem marcação da
Proos, os flags do Omie decidem se a conta entra e o nome sugere o tipo; a
marcação gravada em fluxo_caixa_config.contas prevalece campo a campo.
"""

from __future__ import annotations

import re
from typing import Any


def config_padrao(conta: dict[str, Any]) -> dict[str, Any]:
    nome = (conta.get("descricao") or "").lower()
    tipo_omie = f"{conta.get('tipo') or ''} {conta.get('tipo_conta_corrente') or ''}".lower()
    virtual = bool(re.search(r"perda|preju[ií]zo", nome))
    garantida = bool(re.search(r"garantida|cheque especial", nome))
    aplicacao = not garantida and bool(
        re.search(r"aplica|cdb|invest|poupan|fundo", nome) or re.search(r"\bca\b|aplic", tipo_omie)
    )
    return {
        "entra": not virtual
        and conta.get("inativo", "N") == "N"
        and conta.get("nao_fluxo", "N") == "N"
        and conta.get("nao_resumo", "N") == "N",
        "tipo": "garantida" if garantida else "aplicacao" if aplicacao else "corrente",
        "liquidezImediata": True,
        "limite": float(conta.get("valor_limite") or 0),
    }


def marcacao(conta: dict[str, Any], marcacoes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    propria = marcacoes.get(str(conta["nCodCC"])) or {}
    final = {**config_padrao(conta), **{k: v for k, v in propria.items() if v is not None}}
    # A tela de configuração grava limite 0 quando o campo fica vazio; nesse
    # caso vale o limite que o Omie informa na conta.
    if not final.get("limite"):
        final["limite"] = float(conta.get("valor_limite") or 0)
    return final


def soma_no_caixa(m: dict[str, Any]) -> bool:
    return m["tipo"] == "corrente" or (m["tipo"] == "aplicacao" and bool(m["liquidezImediata"]))


def contas_excluidas(contas_omie: list[dict[str, Any]], marcacoes: dict[str, dict[str, Any]]) -> set[int]:
    """nCodCC que não entram no fluxo — o filtro das bases de títulos."""
    return {c["nCodCC"] for c in contas_omie if not marcacao(c, marcacoes)["entra"]}
