"""Consultas de Contas Correntes — Omie: /geral/contacorrente/."""

from __future__ import annotations

import re
from typing import Any, Optional

from ..client import OmieClient


class ContaBancariaAmbigua(Exception):
    """Zero ou mais de uma conta corrente do Omie bate com o banco/numero
    do extrato — nunca escolhe sozinha (ver resolver_conta_por_extrato)."""

_MODULE = "geral/contacorrente"
_RECORDS_KEYS = ["ListarContasCorrentes", "cadastro", "contasCorrentesListaCadastro"]


def _normalizar(texto: str) -> str:
    mapa = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ",
                          "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC")
    return texto.translate(mapa).upper()


def eh_omie_cash(descricao: str) -> bool:
    """Reconhece uma conta Omie.CASH pelo nome cadastrado no Omie.

    Confirmado real (Proos, 2026-09-21): "Omie.CASH", "Omie.CASH (PX)
    (encerrada)", "Omie.CASH Letsbank (encerrada)", "Omie.CASH -
    (Recebiveis de Cartao (Z))" — a grafia varia, mas "OMIE.CASH"/
    "OMIECASH" sempre aparece. E o proprio banco do Omie: a conciliacao
    dessa conta e feita automaticamente pelo Omie, entao o motor nunca
    deve processa-la (nem gerar gabarito de teste a partir dela).
    """
    normalizado = _normalizar(descricao).replace(" ", "").replace(".", "")
    return "OMIECASH" in normalizado


async def listar_contas_correntes(
    client: OmieClient, max_paginas: int | None = None
) -> list[dict[str, Any]]:
    """Lista as contas correntes (bancos/caixas) cadastradas no Omie."""
    return await client.call_paginated(
        _MODULE,
        "ListarContasCorrentes",
        params={},
        records_key=_RECORDS_KEYS,
        max_paginas=max_paginas,
    )


async def contas_omie_cash(client: OmieClient) -> set[int]:
    """nCodCC de todas as contas Omie.CASH cadastradas no cliente.

    Uso: filtro de seguranca antes de rodar o motor — essas contas ja sao
    conciliadas automaticamente pelo proprio Omie, entao nunca devem
    entrar em --contas/--conta-omie (production ou modo sombra).
    """
    contas = await listar_contas_correntes(client)
    return {c["nCodCC"] for c in contas if eh_omie_cash(c.get("descricao", ""))}


async def contas_fluxo_de_caixa(
    client: OmieClient, excluir: set[int] | None = None
) -> set[int]:
    """
    Retorna o conjunto de nCodCC (contas correntes) que devem entrar em
    qualquer cálculo de fluxo de caixa real — contas ativas, não marcadas
    como "não considerar no fluxo"/"não considerar no resumo".

    `excluir` permite excluir nCodCC específicos além dos flags acima —
    necessário porque a API do Omie pode devolver nao_fluxo/nao_resumo
    errados para contas "virtuais" que não representam dinheiro de
    verdade (confirmado com a conta da Oystr em 2026-08-08: uma conta
    chamada "PERDA / PREJUIZO", usada só para registrar baixa de título
    por perda/prejuízo sem nenhum trânsito bancário real, tinha os flags
    "corretos" mas mesmo assim precisou ser excluída manualmente — ver
    `reports/oystr_diagnostico.py`). Isso é o mesmo problema que o
    `fluxo_caixa.py` do Rodrigo (rotina de referência já em produção) já
    contorna com um EXCLUIR hardcoded — este parâmetro existe pra permitir
    o mesmo padrão aqui, mas de forma genérica (cada cliente passa o seu
    próprio conjunto, não fixo no código genérico da API).
    """
    excluir = excluir or set()
    contas = await listar_contas_correntes(client)
    return {
        c["nCodCC"]
        for c in contas
        if c.get("inativo", "N") == "N"
        and c["nCodCC"] not in excluir
        and c.get("nao_fluxo", "N") == "N"
        and c.get("nao_resumo", "N") == "N"
    }


def _so_digitos(valor: str) -> str:
    return re.sub(r"\D", "", valor or "")


def resolver_conta_por_extrato(
    contas: list[dict[str, Any]],
    bankid: Optional[str],
    acctid: Optional[str],
) -> str:
    """Acha o nCodCC (codigo interno do Omie) da conta corrente que
    corresponde ao extrato, casando pelo numero da conta NO BANCO
    (`numero_conta_corrente`, confirmado na doc oficial de
    ListarContasCorrentes) contra o ACCTID do OFX.

    So compara digitos (tira ponto/traco/zero a esquerda) porque o ACCTID
    varia por banco/exportacao — pode vir so o numero da conta, ou
    agencia+conta concatenados. Por isso o teste e "o numero da conta
    cadastrado no Omie aparece no FINAL do ACCTID do extrato", nao
    igualdade exata — funciona nos dois formatos sem arriscar casar um
    numero curto por coincidencia no meio de outro maior.

    Nunca adivinha: 0 ou 2+ contas batendo levanta ContaBancariaAmbigua —
    quem chamou tem que pedir o nCodCC direto ao operador nesse caso
    (mesmo principio de omie_mcp.conciliacao.recorrencia.
    localizar_titulo_recorrente_seguinte).
    """
    if not acctid:
        raise ContaBancariaAmbigua(
            "O extrato nao tem <ACCTID> (numero da conta) no bloco "
            "BANKACCTFROM — nao da pra resolver a conta automaticamente."
        )

    acctid_digitos = _so_digitos(acctid)
    candidatas: dict[str, dict[str, Any]] = {}
    for c in contas:
        conta = _so_digitos(str(c.get("numero_conta_corrente") or "")).lstrip("0")
        if not conta or not acctid_digitos.endswith(conta):
            continue
        candidatas[str(c["nCodCC"])] = c

    if len(candidatas) != 1:
        detalhe = (
            "nenhuma conta encontrada" if not candidatas
            else f"{len(candidatas)} contas candidatas: {sorted(candidatas)}"
        )
        raise ContaBancariaAmbigua(
            f"Nao foi possivel resolver a conta do Omie pro extrato "
            f"(banco {bankid or '?'}, conta {acctid}): {detalhe}. "
            "Informe o nCodCC manualmente."
        )
    return next(iter(candidatas))
