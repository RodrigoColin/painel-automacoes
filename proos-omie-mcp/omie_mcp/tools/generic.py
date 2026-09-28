"""
Executor genérico para qualquer endpoint do catálogo (omie_mcp/catalog.py).

Em vez de escrever uma função Python quase idêntica para cada um dos ~130
endpoints de leitura catalogados, esta função executa qualquer `EndpointSpec`
de forma uniforme. Os módulos "core" (clientes, categorias, contas
correntes, contas a pagar, contas a receber, serviços) continuam com
implementação própria em tools/*.py porque já foram testados/ajustados —
este executor cobre a cauda longa dos demais endpoints.
"""

from __future__ import annotations

from typing import Any

from ..catalog import EndpointSpec
from ..client import OmieClient


async def executar_leitura(
    client: OmieClient,
    spec: EndpointSpec,
    filtros: dict[str, Any] | None = None,
    max_paginas: int | None = None,
) -> list[dict[str, Any]]:
    """
    Executa a chamada de leitura sugerida em `spec.call_listar` contra o
    módulo `spec.modulo`, com paginação automática.

    Levanta ValueError se o endpoint for `somente_escrita` (não deveria
    nunca ser chamado por aqui) ou não tiver um `call_listar` definido.
    """
    if spec.somente_escrita or not spec.call_listar:
        raise ValueError(
            f"Endpoint '{spec.nome}' ({spec.modulo}) é somente-escrita ou não "
            "tem uma chamada de leitura definida no catálogo — não pode ser "
            "executado por aqui."
        )

    records_key = list(spec.records_key_candidates) or [spec.slug]

    return await client.call_paginated(
        spec.modulo,
        spec.call_listar,
        params=dict(filtros or {}),
        records_key=records_key,
        max_paginas=max_paginas,
    )
