"""Consultas de Contas Correntes — Omie: /geral/contacorrente/."""

from __future__ import annotations

from typing import Any

from ..client import OmieClient

_MODULE = "geral/contacorrente"
_RECORDS_KEYS = ["ListarContasCorrentes", "cadastro", "contasCorrentesListaCadastro"]


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
