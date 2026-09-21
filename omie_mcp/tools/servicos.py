"""
Consultas de Serviços — Omie: /servicos/servico/ (cadastro de serviços) e
/servicos/contrato/ (contratos de serviço / recorrência).

Este módulo é o de cobertura pública mais escassa entre os que expomos
aqui — os nomes exatos de `call` e dos campos de resposta devem ser
confirmados no Portal do Desenvolvedor (developer.omie.com.br) ou no
primeiro teste real de conexão. O fallback de auto-detecção de
`records_key` em OmieClient._extract_records existe justamente para não
quebrar silenciosamente se o nome do campo estiver diferente do esperado.
"""

from __future__ import annotations

from typing import Any

from ..client import OmieClient

_MODULE_SERVICO = "servicos/servico"
_MODULE_CONTRATO = "servicos/contrato"

_RECORDS_KEYS_CADASTRO_SERVICO = ["cadastros", "servicoCadastro"]
_RECORDS_KEYS_CONTRATOS = ["contratoCadastro", "cadastros", "listaContratosCadastro"]


async def listar_servicos_cadastrados(
    client: OmieClient, max_paginas: int | None = None
) -> list[dict[str, Any]]:
    """Lista os serviços cadastrados no catálogo do Omie."""
    return await client.call_paginated(
        _MODULE_SERVICO,
        "ListarCadastroServico",
        params={},
        records_key=_RECORDS_KEYS_CADASTRO_SERVICO,
        max_paginas=max_paginas,
    )


async def listar_contratos_servico(
    client: OmieClient,
    filtros: dict[str, Any] | None = None,
    max_paginas: int | None = None,
) -> list[dict[str, Any]]:
    """
    Lista contratos de serviço (recorrência) cadastrados no Omie.

    Útil para o fluxo já usado internamente na Proos de atualização de
    contratos de serviço via automação Python.
    """
    return await client.call_paginated(
        _MODULE_CONTRATO,
        "ListarContratos",
        params=dict(filtros or {}),
        records_key=_RECORDS_KEYS_CONTRATOS,
        max_paginas=max_paginas,
    )
