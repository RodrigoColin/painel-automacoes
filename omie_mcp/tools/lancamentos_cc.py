"""
Contas Correntes - Lançamentos — Omie: /financas/contacorrentelancamentos/.

Nomes de call confirmados em 2026-08-06 contra dados reais da Oystr — o
catálogo original chutava "ListarLancamentos"/"ConsultarLancamento" (ambos
davam HTTP 500, nome de call errado). Os nomes certos vieram de pesquisa em
dois MCPs Omie open source de terceiros (lucassampsouza/omie-mcp e
@codespar/mcp-omie) e foram validados um por um contra a conta real antes
de virar código de produção:

    ListarLancCC   — listagem paginada, filtrável por dtPagInicial/
                      dtPagFinal (data de pagamento/conciliação).
    ConsultaLancCC — consulta um lançamento específico por nCodLanc (o
                      mesmo nCodLancamento que aparece no extrato,
                      ListarExtrato).

Por que este endpoint importa mais que o extrato pra conciliação
-------------------------------------------------------------------
Cada lançamento devolvido (por ListarLancCC OU ConsultaLancCC) traz um
bloco "diversos" com o elo DIRETO pro título original:

    diversos.dDtConc     -> Data de Conciliação — a data que de fato
                             importa pro fluxo de caixa (crédito/débito
                             realizado), não a data de emissão nem a de
                             vencimento.
    diversos.nCodLancCR  -> codigo_lancamento_omie do título de Contas a
                             Receber (quando diversos.cNatureza == "R")
    diversos.nCodLancCP  -> idem para Contas a Pagar (cNatureza == "P")

Isso é MELHOR que cruzar pelo extrato (financas/extrato/ListarExtrato)
por chave composta (codigo_cliente_fornecedor + numero_documento_fiscal):
o cruzamento fica exato pelo próprio ID do título, sem depender de
numero_documento_fiscal estar preenchido — o que resolve o gap que
existia para títulos lançados manualmente (id_origem="MANP"), que
frequentemente não têm numero_documento_fiscal. Confirmado contra os 5
títulos MANP que ficavam "sem par" no cruzamento antigo: os 5 apareceram
certinho via nCodLancCP.

dtPagInicial/dtPagFinal filtram corretamente tanto natureza "P" quanto
"R" (confirmado: títulos a receber conhecidos apareceram normalmente na
listagem filtrada) — não é um filtro exclusivo de pagamentos, apesar do
nome.
"""

from __future__ import annotations

from typing import Any

from ..client import OmieClient

_MODULE = "financas/contacorrentelancamentos"


async def listar_lancamentos_cc(
    client: OmieClient,
    data_pagamento_de: str | None = None,
    data_pagamento_ate: str | None = None,
    n_cod_cc: int | None = None,
    registros_por_pagina: int = 200,
) -> list[dict[str, Any]]:
    """
    Lista lançamentos de conta corrente (baixas/pagamentos/recebimentos já
    conciliados), opcionalmente filtrando por período de pagamento
    (dd/mm/aaaa) e/ou por conta corrente específica (nCodCC).

    Sem filtro de data, este endpoint devolve o histórico inteiro (dezenas
    de milhares de registros, ordenado por nCodLanc crescente, começando
    em lançamentos antigos) — na prática, SEMPRE use data_pagamento_de/ate.
    """
    # ATENÇÃO: este endpoint pagina com nPagina/nRegPorPagina/nTotPaginas,
    # não pagina/registros_por_pagina/total_de_paginas como a maioria dos
    # outros "Listar*" do Omie — por isso não dá pra usar
    # client.call_paginated() genérico aqui, precisa de paginação própria.
    base_params: dict[str, Any] = {"cOrdemDecrescente": "N"}
    if data_pagamento_de:
        base_params["dtPagInicial"] = data_pagamento_de
    if data_pagamento_ate:
        base_params["dtPagFinal"] = data_pagamento_ate
    if n_cod_cc is not None:
        base_params["nCodCC"] = n_cod_cc

    resultado: list[dict[str, Any]] = []
    pagina = 1
    total_paginas = 1
    while pagina <= total_paginas:
        data = await client.call(
            _MODULE, "ListarLancCC",
            params={**base_params, "nPagina": pagina, "nRegPorPagina": registros_por_pagina},
        )
        resultado.extend(data.get("listaLancamentos", []))
        total_paginas = data.get("nTotPaginas", pagina)
        pagina += 1

    return resultado


async def consultar_lancamento_cc(client: OmieClient, n_cod_lanc: int) -> dict[str, Any]:
    """Consulta um lançamento de conta corrente específico por nCodLanc
    (o mesmo nCodLancamento retornado pelo extrato, ListarExtrato)."""
    return await client.call(_MODULE, "ConsultaLancCC", params={"nCodLanc": n_cod_lanc})


def titulo_vinculado(lancamento: dict[str, Any]) -> int | None:
    """Extrai o codigo_lancamento_omie do título (Contas a Receber ou
    Contas a Pagar) vinculado a este lançamento de conta corrente, ou
    None se o lançamento não estiver vinculado a nenhum título (ex.:
    transferência entre contas sem baixa de título)."""
    diversos = lancamento.get("diversos", {})
    return diversos.get("nCodLancCR") or diversos.get("nCodLancCP")


def titulo_vinculado_receber(lancamento: dict[str, Any]) -> int | None:
    """codigo_lancamento_omie do título de Contas a Receber vinculado
    (None se este lançamento não for um recebimento)."""
    return lancamento.get("diversos", {}).get("nCodLancCR")


def titulo_vinculado_pagar(lancamento: dict[str, Any]) -> int | None:
    """codigo_lancamento_omie do título de Contas a Pagar vinculado
    (None se este lançamento não for um pagamento)."""
    return lancamento.get("diversos", {}).get("nCodLancCP")


def data_lancamento(lancamento: dict[str, Any]) -> str | None:
    """Data do lançamento na conta corrente (dd/mm/aaaa) —
    cabecalho.dDtLanc, o mesmo dado que ListarExtrato expõe como
    dDataLancamento. É esse campo (não dDtConc/Data de Conciliação) que
    fluxo_caixa.py, a rotina de fluxo de caixa diário já em produção,
    usa para determinar em que dia um valor entrou/saiu da conta —
    confirmado em 2026-08-06 comparando os dois códigos depois que o
    Rodrigo notou divergência entre os dois relatórios. Preferir este
    campo (não data_conciliacao) para qualquer cálculo de fluxo de caixa,
    pra manter consistência com o fluxo_caixa.py."""
    return lancamento.get("cabecalho", {}).get("dDtLanc")


def data_conciliacao(lancamento: dict[str, Any]) -> str | None:
    """Data de conciliação (dd/mm/aaaa, diversos.dDtConc) — pode diferir
    de data_lancamento() por um ou mais dias (é a data em que alguém
    confirmou/conciliou o lançamento no Omie, não necessariamente a data
    em que o dinheiro entrou/saiu da conta). Mantido disponível, mas NÃO
    é o campo usado para fluxo de caixa — ver data_lancamento()."""
    return lancamento.get("diversos", {}).get("dDtConc")


def valor_lancamento(lancamento: dict[str, Any]) -> float:
    return lancamento.get("cabecalho", {}).get("nValorLanc", 0)


def conta_corrente_id(lancamento: dict[str, Any]) -> int | None:
    """nCodCC (conta corrente) onde este lançamento foi registrado —
    cabecalho.nCodCC. Usado para filtrar lançamentos de contas correntes
    que não representam dinheiro de verdade (ex.: uma conta virtual usada
    só para registrar baixa por perda/prejuízo, sem nenhum trânsito
    bancário real) antes de contar um lançamento como entrada/saída real
    de caixa — ver `tools/contas_correntes.py::contas_fluxo_de_caixa()`."""
    return lancamento.get("cabecalho", {}).get("nCodCC")
