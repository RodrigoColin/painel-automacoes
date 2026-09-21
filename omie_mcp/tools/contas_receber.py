"""Consultas de Contas a Receber — Omie: /financas/contareceber/."""

from __future__ import annotations

from typing import Any

from ..client import OmieClient

_MODULE = "financas/contareceber"
_RECORDS_KEYS = ["conta_receber_cadastro", "cadastros"]


async def listar_contas_receber(
    client: OmieClient,
    filtros: dict[str, Any] | None = None,
    max_paginas: int | None = None,
) -> list[dict[str, Any]]:
    """
    Lista títulos de contas a receber.

    `filtros` é passado como parâmetros extras da chamada
    `ListarContasReceber` (ex.: filtro por status, período de vencimento,
    código de cliente). Confirme os nomes exatos dos campos na documentação
    oficial ou no primeiro teste real de conexão.
    """
    return await client.call_paginated(
        _MODULE,
        "ListarContasReceber",
        params=dict(filtros or {}),
        records_key=_RECORDS_KEYS,
        max_paginas=max_paginas,
    )


async def consultar_conta_receber(
    client: OmieClient, codigo_lancamento_omie: int
) -> dict[str, Any]:
    """Consulta um título de conta a receber específico pelo código Omie."""
    return await client.call(
        _MODULE,
        "ConsultarContaReceber",
        params={"codigo_lancamento_omie": codigo_lancamento_omie},
    )
