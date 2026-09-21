"""Consultas de Contas a Pagar — Omie: /financas/contapagar/."""

from __future__ import annotations

from typing import Any

from ..client import OmieClient

_MODULE = "financas/contapagar"
_RECORDS_KEYS = ["conta_pagar_cadastro", "cadastros"]


async def listar_contas_pagar(
    client: OmieClient,
    filtros: dict[str, Any] | None = None,
    max_paginas: int | None = None,
) -> list[dict[str, Any]]:
    """
    Lista títulos de contas a pagar.

    `filtros` é passado como parâmetros extras da chamada `ListarContasPagar`
    (ex.: filtro por status, período de vencimento, código de cliente/
    fornecedor). Os nomes exatos dos campos de filtro variam conforme a
    versão da API — confirme na documentação oficial
    (https://developer.omie.com.br/service-list/) ou no primeiro teste real
    de conexão antes de usar em produção.
    """
    return await client.call_paginated(
        _MODULE,
        "ListarContasPagar",
        params=dict(filtros or {}),
        records_key=_RECORDS_KEYS,
        max_paginas=max_paginas,
    )


async def consultar_conta_pagar(
    client: OmieClient, codigo_lancamento_omie: int
) -> dict[str, Any]:
    """Consulta um título de conta a pagar específico pelo código Omie."""
    return await client.call(
        _MODULE,
        "ConsultarContaPagar",
        params={"codigo_lancamento_omie": codigo_lancamento_omie},
    )
