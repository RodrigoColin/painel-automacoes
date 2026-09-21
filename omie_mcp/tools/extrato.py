"""
Extrato de Conta Corrente — Omie: /financas/extrato/.

Endpoint confirmado a partir do script já em produção da Proos
(proos-automacoes/oystr/fluxo_caixa.py) — a chamada catalogada
originalmente (`ObterExtrato`) estava errada e retornava HTTP 500. A
chamada certa é `ListarExtrato`, com `cCodIntCC` obrigatório na
requisição (mesmo que vazio) e a lista de movimentos vem em
`listaMovimentos` (não em `pagina`/`registros_por_pagina` — este
endpoint não pagina como os demais "Listar*", devolve o período inteiro
de uma vez).

Este é o endpoint-chave para conciliação bancária e fluxo de caixa
realizado: cada movimento traz `cOrigem` indicando se é um lançamento
já liquidado ("Conta Recebida", "Conta Paga") ou ainda previsto
("Conta a Receber", "Conta a Pagar", "Previsão de Pedido de Compra/
Venda"), além de `dDataLancamento` (data de crédito/débito no
extrato), `cNatureza` ("R"=receita/"P"=despesa) e `nValorDocumento`.

Valor LÍQUIDO já pronto pra título em aberto (2026-08-08)
-----------------------------------------------------------
Confirmado com dado real: pra um movimento com `cOrigem` "Conta a
Receber"/"Conta a Pagar" (título ainda em aberto), `nValorDocumento`
JÁ VEM como o valor líquido de verdade — descontando retenção de
imposto (IRRF/PIS/COFINS/CSLL/INSS/ISS, quando o título tiver) e
qualquer parcial já pago/recebido. NÃO é o mesmo valor que
`valor_documento` do título (via `ListarContasReceber`/
`ListarContasPagar`), que é o valor BRUTO da nota fiscal, sem desconto
de retenção — usar `valor_documento` pra "quanto vai sair/entrar de
verdade" superestima o título quando ele tem retenção configurada (achado
comparando contra `fluxo_caixa.py`: dois títulos reais divergiam em
R$70,01 e R$6,14 — exatamente a soma das retenções de cada um).

O campo `nCodLancamento` do movimento é o MESMO `codigo_lancamento_omie`
do título de origem (confirmado com dado real) — dá pra cruzar de volta
pro título sem nenhuma chamada extra à API. Ver
`previsao_titulos_por_extrato()` abaixo, que já monta esse índice.
"""

from __future__ import annotations

import asyncio
from typing import Any

from ..client import OmieClient

_MODULE = "financas/extrato"

# Origens de movimento do extrato que correspondem a um título de Contas a
# Receber/Pagar AINDA EM ABERTO (não inclui "Previsão de Pedido de Compra/
# Venda", que é de pedido ainda não virado título — não tem
# codigo_lancamento_omie de título pra cruzar).
ORIGENS_TITULO_ABERTO = {"Conta a Receber", "Conta a Pagar"}

# Origens de PREVISÃO de receita ainda não faturada — achado real
# 2026-08-13 (pedido do Rodrigo, ver "Receita recorrente ainda não
# faturada" / bug #7 no docstring de reports/oystr_diagnostico.py):
# `ListarExtrato` já traz a previsão NATIVA do Omie pra contrato
# recorrente ("Previsão de Contratos Mensais" — confirmado com 2 casos
# reais, NANTES E MELLO e PEREIRA GIONEDIS, cobrindo os 3 meses da
# janela de projeção, já com ajuste de fim de semana/feriado calculado
# pelo próprio Omie) e pra Ordem de Serviço avulsa ainda não faturada
# ("Previsão de Ordem de Serviço" — a "cobrança pontual"/"OS Adicional"
# que o Rodrigo pediu pra separar da recorrência do contrato). Usar
# essas previsões prontas elimina a necessidade de recalcular
# dia_fixo/vigência/cruzamento com título na mão (fonte de 6 bugs reais
# diferentes até aqui).
ORIGEM_PREVISAO_CONTRATO_MENSAL = "Previsão de Contratos Mensais"
ORIGEM_PREVISAO_OS = "Previsão de Ordem de Serviço"


async def consultar_extrato(
    client: OmieClient,
    n_cod_cc: int,
    data_inicial: str,
    data_final: str,
    c_cod_int_cc: str = "",
) -> list[dict[str, Any]]:
    """
    Consulta o extrato (movimentos) de uma conta corrente no período dado.

    n_cod_cc: código Omie da conta corrente (nCodCC, ver
    listar_contas_correntes).
    data_inicial, data_final: no formato "dd/mm/aaaa".
    c_cod_int_cc: código de integração da conta (normalmente vazio —
    só usado por integrações que cadastraram contas via API própria).

    Cada movimento retornado inclui, entre outros: cDesCliente
    (descrição/cliente-fornecedor), cOrigem (origem do lançamento —
    ver módulo), dDataLancamento, cNatureza ("R"/"P"), nValorDocumento,
    cNumero (documento) e cSituacao. Quando cDesCliente é "SALDO
    ANTERIOR", o registro representa o saldo inicial do período (campo
    nSaldo), não um movimento de fato.
    """
    data = await client.call(
        _MODULE,
        "ListarExtrato",
        params={
            "nCodCC": n_cod_cc,
            "cCodIntCC": c_cod_int_cc,
            "dPeriodoInicial": data_inicial,
            "dPeriodoFinal": data_final,
        },
    )
    return data.get("listaMovimentos", [])


async def previsao_titulos_por_extrato(
    client: OmieClient,
    contas: list[int],
    data_inicial: str,
    data_final: str,
) -> dict[int, dict[str, Any]]:
    """
    Monta um índice, por `codigo_lancamento_omie` do título, do valor
    LÍQUIDO e da data de previsão que o extrato bancário (`ListarExtrato`)
    já tem prontos pra cada título de Contas a Receber/Pagar ainda em
    aberto — ver "Valor LÍQUIDO já pronto pra título em aberto" no
    docstring do módulo.

    contas: lista de nCodCC a consultar (normalmente o resultado de
    `tools.contas_correntes.contas_fluxo_de_caixa()` — só contas que são
    dinheiro de verdade).
    data_inicial, data_final: janela "dd/mm/aaaa" que cobre as datas de
    Previsão/Vencimento dos títulos em aberto que se quer enriquecer.

    Retorna: {codigo_lancamento_omie: {"valor_liquido": float,
    "data_previsao": "dd/mm/aaaa"}}. Título que não aparecer nesse índice
    (extrato ainda não tem o lançamento previsto, por qualquer motivo)
    deve cair no fallback pro valor/data bruto do próprio título — ver
    uso em `reports/oystr_diagnostico.py`.
    """
    indice: dict[int, dict[str, Any]] = {}
    for i, n_cod_cc in enumerate(contas):
        if i > 0:
            # Espera entre chamadas SEGUIDAS ao mesmo método (ListarExtrato,
            # uma por conta corrente) — mesmo cuidado que
            # reports/oystr_diagnostico.py::buscar_titulos_abertos() já
            # toma, pro lock de concorrência do Omie não disparar.
            await asyncio.sleep(1.5)
        movimentos = await consultar_extrato(client, n_cod_cc, data_inicial, data_final)
        for mov in movimentos:
            if mov.get("cDesCliente") == "SALDO ANTERIOR":
                continue
            if mov.get("cOrigem") not in ORIGENS_TITULO_ABERTO:
                continue
            codigo = mov.get("nCodLancamento")
            if codigo is None:
                continue
            indice[codigo] = {
                "valor_liquido": abs(mov.get("nValorDocumento", 0) or 0),
                "data_previsao": mov.get("dDataLancamento"),
            }
    return indice


async def buscar_previsoes(
    client: OmieClient,
    contas: list[int],
    data_inicial: str,
    data_final: str,
) -> dict[str, Any]:
    """
    Uma ÚNICA passada pelo extrato bancário (`ListarExtrato`, mesma
    chamada de `previsao_titulos_por_extrato` acima) que separa os
    movimentos em TRÊS baldes, pelo `cOrigem`:

    - "titulos": o mesmo índice por `codigo_lancamento_omie` que
      `previsao_titulos_por_extrato()` já monta (título de Contas a
      Receber/Pagar em aberto) — mesmo formato, pra não duplicar
      lógica.
    - "contratos_mensais": lista crua dos movimentos com
      `cOrigem="Previsão de Contratos Mensais"` — a previsão NATIVA do
      Omie pra contrato de serviço recorrente ainda não faturado (ver
      ORIGEM_PREVISAO_CONTRATO_MENSAL acima). Cada um já vem com
      `nCodLancamento` (= `nCodCtr` do contrato), `dDataLancamento`
      (data prevista, já com ajuste de fim de semana/feriado feito
      pelo Omie), `nValorDocumento` (valor), `cRazCliente`/
      `cDocCliente` (nome/CNPJ do cliente) e `cDesCategoria` — dá pra
      montar "Base - Contratos Nao Faturados" direto disso, sem
      recalcular nada.
    - "os_avulsas": mesma ideia, mas pra `cOrigem="Previsão de Ordem de
      Serviço"` — cobrança pontual/avulsa (ex.: "OS Adicional de
      Contrato") ainda não faturada, categoria DIFERENTE de receita
      recorrente (pedido do Rodrigo 2026-08-13: "as OSs não são
      projeção de receita recorrente, mas são não recorrente/pontual").

    Por que uma função só faz as três coisas: as três vêm do MESMO
    conjunto de chamadas `ListarExtrato` (uma por conta corrente) —
    chamar duas vezes (uma pra cada finalidade) dobraria o número de
    chamadas à API sem necessidade.
    """
    indice_titulos: dict[int, dict[str, Any]] = {}
    contratos_mensais: list[dict[str, Any]] = []
    os_avulsas: list[dict[str, Any]] = []

    for i, n_cod_cc in enumerate(contas):
        if i > 0:
            await asyncio.sleep(1.5)
        movimentos = await consultar_extrato(client, n_cod_cc, data_inicial, data_final)
        for mov in movimentos:
            if mov.get("cDesCliente") == "SALDO ANTERIOR":
                continue
            origem = mov.get("cOrigem")
            if origem in ORIGENS_TITULO_ABERTO:
                codigo = mov.get("nCodLancamento")
                if codigo is not None:
                    indice_titulos[codigo] = {
                        "valor_liquido": abs(mov.get("nValorDocumento", 0) or 0),
                        "data_previsao": mov.get("dDataLancamento"),
                    }
            elif origem == ORIGEM_PREVISAO_CONTRATO_MENSAL:
                contratos_mensais.append(mov)
            elif origem == ORIGEM_PREVISAO_OS:
                os_avulsas.append(mov)

    return {
        "titulos": indice_titulos,
        "contratos_mensais": contratos_mensais,
        "os_avulsas": os_avulsas,
    }
