"""Consultas de Clientes/Fornecedores — Omie: /geral/clientes/."""

from __future__ import annotations

from typing import Any

from ..client import OmieClient

_MODULE = "geral/clientes"
_RECORDS_KEYS = ["clientes_cadastro", "clientes_cadastros"]


async def listar_clientes(
    client: OmieClient,
    apenas_fornecedores: bool = False,
    apenas_clientes: bool = False,
    max_paginas: int | None = None,
) -> list[dict[str, Any]]:
    """
    Lista clientes/fornecedores cadastrados no Omie.

    No Omie, clientes e fornecedores compartilham o mesmo cadastro
    (o campo `cliente_fornecedor` no registro indica o tipo). Os flags
    `apenas_fornecedores` / `apenas_clientes` filtram o resultado
    localmente após a consulta.
    """
    registros = await client.call_paginated(
        _MODULE,
        "ListarClientes",
        params={},
        records_key=_RECORDS_KEYS,
        max_paginas=max_paginas,
    )

    if apenas_fornecedores:
        registros = [
            r for r in registros if "F" in str(r.get("cliente_fornecedor", ""))
        ]
    if apenas_clientes:
        registros = [
            r for r in registros if "C" in str(r.get("cliente_fornecedor", ""))
        ]
    return registros


async def consultar_cliente_por_codigo(
    client: OmieClient, codigo_cliente_omie: int
) -> dict[str, Any]:
    """Consulta um cliente/fornecedor específico pelo código Omie."""
    return await client.call(
        _MODULE,
        "ConsultarCliente",
        params={"codigo_cliente_omie": codigo_cliente_omie},
    )
