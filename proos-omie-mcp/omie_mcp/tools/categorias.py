"""Consultas de Categorias (plano de contas gerencial) — Omie: /geral/categorias/."""

from __future__ import annotations

from typing import Any

from ..client import OmieClient

_MODULE = "geral/categorias"
_RECORDS_KEYS = ["categoria_cadastro", "categorias"]


async def listar_categorias(
    client: OmieClient, max_paginas: int | None = None
) -> list[dict[str, Any]]:
    """Lista o plano de categorias (financeiro/gerencial) cadastrado no Omie."""
    return await client.call_paginated(
        _MODULE,
        "ListarCategorias",
        params={},
        records_key=_RECORDS_KEYS,
        max_paginas=max_paginas,
    )
