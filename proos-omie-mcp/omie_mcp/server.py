"""
Servidor MCP da Proos para o Omie — proos-omie-mcp.

Expõe, por enquanto, apenas tools de LEITURA/CONSULTA (nenhuma escrita no
Omie), cobrindo: Clientes/Fornecedores, Categorias, Contas Correntes,
Extrato de Conta Corrente, Contas a Pagar, Contas a Receber, Serviços
(catálogo + contratos) e mais 114 endpoints gerados a partir do
catálogo (omie_mcp/catalog.py).

Multi-cliente: a Proos atende várias empresas, cada uma com sua própria
conta Omie. Quase toda tool aqui aceita um parâmetro `cliente` (slug) para
escolher qual empresa consultar — os slugs disponíveis vêm de
`clientes_omie.json` (veja clientes_omie.example.json) e podem ser
descobertos com a tool `listar_clientes_proos`. Se só houver um cliente
configurado, `cliente` é opcional (usa esse automaticamente).

Uso local (stdio, para Claude Desktop / Claude Code):

    python -m omie_mcp.server

(as credenciais vêm de clientes_omie.json ou, para um cliente só, de
OMIE_APP_KEY/OMIE_APP_SECRET no ambiente/.env)

Para conectar no Claude Desktop, adicione em claude_desktop_config.json:

    {
      "mcpServers": {
        "proos-omie": {
          "command": "python",
          "args": ["-m", "omie_mcp.server"]
        }
      }
    }

Este módulo é só a camada de exposição MCP. A lógica de negócio real vive
em omie_mcp/client.py e omie_mcp/tools/*.py, que são Python puro e podem
ser importados diretamente pelo backend FastAPI da Plataforma Proos sem
depender do protocolo MCP. omie_mcp/clients.py (o registro multi-cliente)
também é Python puro pela mesma razão.
"""

from __future__ import annotations

import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from .catalog import CATALOG, EndpointSpec
from .client import OmieAPIError, OmieClient
from .clients import ClientesRegistry
from .tools import (
    categorias as tools_categorias,
    clientes as tools_clientes,
    contas_correntes as tools_contas_correntes,
    contas_pagar as tools_contas_pagar,
    contas_receber as tools_contas_receber,
    extrato as tools_extrato,
    generic as tools_generic,
    lancamentos_cc as tools_lancamentos_cc,
    servicos as tools_servicos,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("proos.omie_mcp.server")

mcp = FastMCP(
    name="proos-omie",
    instructions=(
        "Ferramentas de CONSULTA (somente leitura) ao ERP Omie de clientes "
        "da Proos. Nenhuma tool aqui cria, altera ou exclui dados no Omie — "
        "todas são operações de leitura seguras. A Proos atende várias "
        "empresas: use a tool listar_clientes_proos primeiro para ver quais "
        "clientes estão configurados, e passe o slug certo no parâmetro "
        "'cliente' das demais tools (opcional só quando há um único cliente "
        "configurado). Use para responder perguntas sobre "
        "clientes/fornecedores, plano de categorias, contas correntes, "
        "títulos a pagar/receber e contratos de serviço cadastrados no Omie."
    ),
)

# Registro de clientes é carregado uma vez (lazy) e reutilizado — evita
# reler/reparsear clientes_omie.json a cada chamada de tool.
_registry: ClientesRegistry | None = None


def _get_registry() -> ClientesRegistry:
    global _registry
    if _registry is None:
        _registry = ClientesRegistry.load()
    return _registry


def _get_client(cliente: str | None = None) -> OmieClient:
    """
    Resolve o cliente Proos (por slug, ou automaticamente se só houver um
    configurado) e devolve um OmieClient já com as credenciais certas.
    Recarrega o registro do zero a cada chamada seria caro; em vez disso,
    o registro fica em cache no processo — se você editar
    clientes_omie.json, reinicie o servidor MCP para recarregar.
    """
    registry = _get_registry()
    slug = registry.resolver_slug(cliente)
    settings = registry.settings_for(slug)
    return OmieClient(settings)


def _fmt_error(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, OmieAPIError):
        return {
            "erro": True,
            "mensagem": str(exc),
            "fault_code": exc.fault_code,
        }
    return {"erro": True, "mensagem": str(exc)}


@mcp.tool()
def listar_clientes_proos() -> dict[str, Any]:
    """
    Lista os clientes da Proos configurados neste MCP (slug, nome, se está
    ativo) — NÃO expõe App Key/App Secret. Use o campo 'slug' retornado
    aqui no parâmetro 'cliente' das demais tools para escolher qual
    empresa consultar no Omie.
    """
    try:
        registry = _get_registry()
        clientes = registry.listar()
        return {
            "total": len(clientes),
            "clientes": [
                {"slug": c.slug, "nome": c.nome, "ativo": c.ativo} for c in clientes
            ],
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em listar_clientes_proos")
        return _fmt_error(exc)


@mcp.tool()
async def listar_clientes(
    cliente: str | None = None,
    apenas_fornecedores: bool = False,
    apenas_clientes: bool = False,
    max_paginas: int | None = None,
) -> dict[str, Any]:
    """Lista clientes/fornecedores cadastrados no Omie do cliente Proos indicado.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            registros = await tools_clientes.listar_clientes(
                client, apenas_fornecedores, apenas_clientes, max_paginas
            )
        return {"total": len(registros), "registros": registros}
    except Exception as exc:  # noqa: BLE001 - queremos superfície de erro amigável no MCP
        logger.exception("Erro em listar_clientes")
        return _fmt_error(exc)


@mcp.tool()
async def consultar_cliente(
    codigo_cliente_omie: int, cliente: str | None = None
) -> dict[str, Any]:
    """Consulta um cliente/fornecedor específico pelo código Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            return await tools_clientes.consultar_cliente_por_codigo(
                client, codigo_cliente_omie
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em consultar_cliente")
        return _fmt_error(exc)


@mcp.tool()
async def listar_categorias(
    cliente: str | None = None, max_paginas: int | None = None
) -> dict[str, Any]:
    """Lista o plano de categorias financeiras/gerenciais cadastrado no Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            registros = await tools_categorias.listar_categorias(client, max_paginas)
        return {"total": len(registros), "registros": registros}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em listar_categorias")
        return _fmt_error(exc)


@mcp.tool()
async def listar_contas_correntes(
    cliente: str | None = None, max_paginas: int | None = None
) -> dict[str, Any]:
    """Lista as contas correntes (bancos/caixas) cadastradas no Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            registros = await tools_contas_correntes.listar_contas_correntes(
                client, max_paginas
            )
        return {"total": len(registros), "registros": registros}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em listar_contas_correntes")
        return _fmt_error(exc)


@mcp.tool()
async def listar_contas_pagar(
    cliente: str | None = None,
    filtros: dict[str, Any] | None = None,
    max_paginas: int | None = None,
) -> dict[str, Any]:
    """
    Lista títulos de contas a pagar no Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    filtros: parâmetros extras opcionais da chamada ListarContasPagar
    (ex.: período de vencimento, status). Consulte a documentação oficial
    do Omie para os nomes exatos dos campos de filtro.
    """
    try:
        async with _get_client(cliente) as client:
            registros = await tools_contas_pagar.listar_contas_pagar(
                client, filtros, max_paginas
            )
        return {"total": len(registros), "registros": registros}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em listar_contas_pagar")
        return _fmt_error(exc)


@mcp.tool()
async def consultar_conta_pagar(
    codigo_lancamento_omie: int, cliente: str | None = None
) -> dict[str, Any]:
    """Consulta um título de conta a pagar específico pelo código Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            return await tools_contas_pagar.consultar_conta_pagar(
                client, codigo_lancamento_omie
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em consultar_conta_pagar")
        return _fmt_error(exc)


@mcp.tool()
async def listar_contas_receber(
    cliente: str | None = None,
    filtros: dict[str, Any] | None = None,
    max_paginas: int | None = None,
) -> dict[str, Any]:
    """
    Lista títulos de contas a receber no Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    filtros: parâmetros extras opcionais da chamada ListarContasReceber
    (ex.: período de vencimento, status). Consulte a documentação oficial
    do Omie para os nomes exatos dos campos de filtro.
    """
    try:
        async with _get_client(cliente) as client:
            registros = await tools_contas_receber.listar_contas_receber(
                client, filtros, max_paginas
            )
        return {"total": len(registros), "registros": registros}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em listar_contas_receber")
        return _fmt_error(exc)


@mcp.tool()
async def consultar_conta_receber(
    codigo_lancamento_omie: int, cliente: str | None = None
) -> dict[str, Any]:
    """Consulta um título de conta a receber específico pelo código Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            return await tools_contas_receber.consultar_conta_receber(
                client, codigo_lancamento_omie
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em consultar_conta_receber")
        return _fmt_error(exc)


@mcp.tool()
async def consultar_extrato_conta_corrente(
    n_cod_cc: int,
    data_inicial: str,
    data_final: str,
    cliente: str | None = None,
) -> dict[str, Any]:
    """
    Consulta o extrato (movimentos) de uma conta corrente do Omie em um
    período — inclui lançamentos já liquidados (recebidos/pagos) e
    previstos. É a fonte correta para fluxo de caixa realizado e
    conciliação bancária (cada movimento traz cOrigem, dDataLancamento,
    cNatureza R/P e nValorDocumento).

    n_cod_cc: código Omie da conta corrente (ver listar_contas_correntes).
    data_inicial, data_final: no formato "dd/mm/aaaa".
    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            movimentos = await tools_extrato.consultar_extrato(
                client, n_cod_cc, data_inicial, data_final
            )
        return {"total": len(movimentos), "movimentos": movimentos}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em consultar_extrato_conta_corrente")
        return _fmt_error(exc)


@mcp.tool()
async def listar_lancamentos_conta_corrente(
    data_pagamento_de: str | None = None,
    data_pagamento_ate: str | None = None,
    n_cod_cc: int | None = None,
    cliente: str | None = None,
) -> dict[str, Any]:
    """
    Lista lançamentos de conta corrente (baixas já conciliadas) do Omie,
    opcionalmente filtrando por período de pagamento e/ou conta corrente.
    Cada lançamento traz, no bloco "diversos", o elo direto pro título
    original (nCodLancCR/nCodLancCP) e a Data de Conciliação (dDtConc) —
    é a fonte mais confiável para cruzar título liquidado com a data real
    de crédito/débito, melhor que o extrato (não depende de
    numero_documento_fiscal estar preenchido no título).

    data_pagamento_de, data_pagamento_ate: "dd/mm/aaaa". Recomendado
    sempre informar — sem filtro de data este endpoint devolve o
    histórico inteiro (dezenas de milhares de registros).
    n_cod_cc: código Omie da conta corrente, opcional (sem filtro, cobre
    todas as contas).
    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            lancamentos = await tools_lancamentos_cc.listar_lancamentos_cc(
                client, data_pagamento_de, data_pagamento_ate, n_cod_cc
            )
        return {"total": len(lancamentos), "lancamentos": lancamentos}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em listar_lancamentos_conta_corrente")
        return _fmt_error(exc)


@mcp.tool()
async def consultar_lancamento_conta_corrente(
    n_cod_lanc: int, cliente: str | None = None
) -> dict[str, Any]:
    """Consulta um lançamento de conta corrente específico pelo nCodLanc
    (o mesmo nCodLancamento retornado pelo extrato).

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            return await tools_lancamentos_cc.consultar_lancamento_cc(client, n_cod_lanc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em consultar_lancamento_conta_corrente")
        return _fmt_error(exc)


@mcp.tool()
async def listar_servicos_cadastrados(
    cliente: str | None = None, max_paginas: int | None = None
) -> dict[str, Any]:
    """Lista os serviços cadastrados no catálogo de serviços do Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            registros = await tools_servicos.listar_servicos_cadastrados(
                client, max_paginas
            )
        return {"total": len(registros), "registros": registros}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em listar_servicos_cadastrados")
        return _fmt_error(exc)


@mcp.tool()
async def listar_contratos_servico(
    cliente: str | None = None,
    filtros: dict[str, Any] | None = None,
    max_paginas: int | None = None,
) -> dict[str, Any]:
    """Lista contratos de serviço (recorrência) cadastrados no Omie.

    cliente: slug do cliente Proos a consultar (ver listar_clientes_proos). Opcional se só houver um cliente configurado.
    """
    try:
        async with _get_client(cliente) as client:
            registros = await tools_servicos.listar_contratos_servico(
                client, filtros, max_paginas
            )
        return {"total": len(registros), "registros": registros}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erro em listar_contratos_servico")
        return _fmt_error(exc)


# ----------------------------------------------------------------------
# Registro dinâmico das tools de cauda longa (a partir do catálogo)
# ----------------------------------------------------------------------
# Os módulos "core" acima (clientes, categorias, contas correntes, contas a
# pagar/receber, serviços) já têm implementação própria e testada. Os
# demais ~127 endpoints de leitura catalogados em omie_mcp/catalog.py são
# registrados aqui automaticamente — cada um vira uma tool MCP própria
# (`listar_<slug>`), mas todos compartilham o mesmo executor genérico
# (tools/generic.py). A descrição de cada tool inclui o nível de confiança
# no nome da chamada, para deixar claro quando algo ainda precisa de
# validação (ver tests/full_coverage_check.py).

_CONFIANCA_LABEL = {
    "alta": "confiança ALTA",
    "media": "confiança média — nome da chamada segue o padrão do Omie mas não foi confirmado",
    "baixa": "confiança BAIXA — nome da chamada é um chute, valide antes de usar em produção",
}


def _registrar_tool_dinamica(spec: EndpointSpec) -> None:
    async def _tool_dinamica(
        cliente: str | None = None,
        filtros: dict[str, Any] | None = None,
        max_paginas: int | None = None,
    ) -> dict[str, Any]:
        try:
            async with _get_client(cliente) as client:
                registros = await tools_generic.executar_leitura(
                    client, spec, filtros, max_paginas
                )
            return {"total": len(registros), "registros": registros}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Erro na tool dinâmica listar_%s", spec.slug)
            return _fmt_error(exc)

    _tool_dinamica.__name__ = f"listar_{spec.slug}"

    descricao = (
        f"[{spec.categoria}] {spec.nome} — Omie `{spec.modulo}` "
        f"(chamada `{spec.call_listar}`, {_CONFIANCA_LABEL[spec.confianca]}). "
        "Parâmetro 'cliente': slug do cliente Proos a consultar (ver "
        "listar_clientes_proos) — opcional se só houver um cliente configurado."
    )
    if spec.observacao:
        descricao += f" Nota: {spec.observacao}"

    mcp.add_tool(_tool_dinamica, name=f"listar_{spec.slug}", description=descricao)


for _spec in CATALOG:
    if _spec.somente_escrita or not _spec.call_listar or _spec.ja_implementado_manualmente:
        continue
    _registrar_tool_dinamica(_spec)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
