"""
Lógica de negócio para popular as 4 abas "Base -" do
Oystr_Diagnostico_Consolidado.xlsx a partir de dados reais do Omie, em vez
de export manual. Python puro (sem openpyxl aqui) — a escrita no arquivo
.xlsx fica em scripts/refresh_oystr_diagnostico.py, que importa este
módulo. Isso segue o mesmo princípio do resto do projeto: lógica
reaproveitável pelo backend FastAPI da Plataforma Proos no futuro.

Como cada aba é alimentada
---------------------------
- **Base - Receber Aberto** / **Base - Pagar Aberto**: títulos ainda em
  aberto (`ListarContasReceber`/`ListarContasPagar`, status EMABERTO,
  ATRASADO, AVENCER, VENCEHOJE, PAGTO_PARCIAL).
- **Base - Recebimentos** / **Base - Pagamentos**: lançamentos de conta
  corrente (`financas/contacorrentelancamentos`/`ListarLancCC`) cuja DATA
  DO LANÇAMENTO caia no período pedido, cruzados com o título original
  para trazer Emissão/Vencimento/Categoria/etc. Ver
  `montar_recebimentos_pagamentos()`.

O cruzamento título <-> lançamento de conta corrente
-------------------------------------------------------
Histórico (2026-08-06): a primeira versão deste cruzamento usava o
extrato bancário (`financas/extrato`/`ListarExtrato`) casado por CHAVE
COMPOSTA (codigo_cliente_fornecedor + numero_documento_fiscal do título
== nCodCliente + cDocumentoFiscal do movimento). Funcionava, mas falhava
para títulos lançados manualmente (id_origem="MANP") sem
numero_documento_fiscal preenchido — sem chave, sem cruzamento.

A solução atual usa `financas/contacorrentelancamentos`/`ListarLancCC`
(nomes de call confirmados contra dados reais — vieram de pesquisa em
MCPs Omie de terceiros, não da doc oficial, e foram validados um por um
antes de virar código; ver `tools/lancamentos_cc.py`). Cada lançamento
retornado traz, no bloco `diversos`, o ELO DIRETO pro título original
(`nCodLancCR`/`nCodLancCP` -> `codigo_lancamento_omie`) — chave exata,
sem depender de `numero_documento_fiscal`. Confirmado contra os 5 títulos
MANP que ficavam sem par no cruzamento antigo: os 5 apareceram certinho.

Qual data usar, e qual critério define "pertence ao período"
-----------------------------------------------------------------
Segunda rodada de correção (2026-08-06, depois que o Rodrigo comparou
contra `fluxo_caixa.py` — a rotina de fluxo de caixa diário já em
produção — e notou números de agosto diferentes):

1. **Critério de período**: a primeira versão filtrava títulos por DATA
   DE EMISSÃO (`filtrar_por_emissao_de/ate`). Isso faz um título emitido
   em julho mas pago em agosto ficar fora da janela de agosto — errado
   para um relatório de fluxo de caixa, que deve refletir quando o
   dinheiro realmente moveu. Agora o critério é a DATA DO LANÇAMENTO na
   conta corrente (`cabecalho.dDtLanc`, via `lancamentos_cc.
   data_lancamento()`), o mesmo dado que `fluxo_caixa.py` usa como
   `dDataLancamento` (vindo do extrato — é o mesmo valor, só que exposto
   por um endpoint diferente).
2. **Qual data mostrar em "Data de Crédito ou Débito"**: por esse mesmo
   motivo, usa `data_lancamento()` (`dDtLanc`), NÃO `data_conciliacao()`
   (`dDtConc`) — os dois podem divergir por um ou mais dias no mesmo
   lançamento (confirmado com dado real: um caso teve `dDtLanc=01/07` e
   `dDtConc=02/07`).

Títulos com status LIQUIDADO/PAGO cuja emissão caia no período mas que
não têm nenhum lançamento de conta corrente vinculado continuam
aparecendo, à parte, com `conciliado=False` (baixa sem trânsito pela
conta corrente — compensação, desconto integral — ou título cujo status
mudou depois, ex.: cancelado) — Rodrigo revisa esses manualmente.

Contas correntes que NÃO são dinheiro de verdade (2026-08-08)
-----------------------------------------------------------------
Achado pelo Rodrigo comparando dia a dia contra `FluxoCaixa_Oystr.xlsx`:
o dia 04/08/2026 tinha R$ 4.200,00 de "Recebido" a mais do que a
referência. Causa raiz: 7 títulos de mensalidade (Presto Recorrente,
R$ 600 cada, um por mês de dez/25 a jun/26) do mesmo cliente foram
baixados em 04/08/2026 não por um recebimento bancário real, mas por uma
baixa por PERDA/PREJUÍZO (inadimplência declarada) — o Omie registra
isso como um lançamento em `financas/contacorrentelancamentos` igual a
qualquer outro, numa conta corrente "virtual" chamada "PERDA / PREJUIZO"
que não corresponde a nenhum banco real. `fluxo_caixa.py` (rotina de
referência) já contorna isso com um EXCLUIR hardcoded de nCodCC — o
mesmo padrão foi replicado aqui via `tools/contas_correntes.
contas_fluxo_de_caixa()` (genérico) + o parâmetro `excluir_contas`
(desde 2026-09-29 vem das marcações da empresa em fluxo_caixa_config) —
ver uso em `montar_recebimentos_pagamentos()`. Confirmado no arquivo:
13 lançamentos nessa conta em "Base - Recebimentos" somando
R$ 16.413,39 no total (não só os 7 do dia 04/08) — todos inflavam
"Recebido" sem nenhum dinheiro ter entrado de verdade. O mesmo filtro
também passa a excluir as subcontas de cartão de crédito (Itaú Cartão
Business/Corporativo) de "Base - Pagamentos", pelo mesmo motivo que
`fluxo_caixa.py` as exclui: o desembolso real acontece quando a fatura
do cartão é paga pela conta corrente principal, contar a compra
individual no cartão também seria dinheiro contado duas vezes.

Valor líquido (retenção de imposto) nos títulos em aberto (2026-08-08)
-----------------------------------------------------------------------
Achado pelo Rodrigo comparando "Fluxo Diario Ago-2026" dia a dia contra
`FluxoCaixa_Oystr.xlsx`: sobrava R$70,01 no dia 10/08 e R$6,14 no dia
20/08, mesmo já com os fixes de PERDA/PREJUÍZO e Previsão aplicados.
Causa raiz: `linha_receber_aberto()`/`linha_pagar_aberto()` usavam
`valor_documento` do título (valor BRUTO da nota fiscal) como "Valor da
Conta" — mas títulos com retenção de imposto configurada (IRRF/PIS/
COFINS/CSLL/INSS/ISS — comum em NF de serviço, ex. advocacia) têm um
valor líquido menor de verdade saindo/entrando do banco. Confirmado com
dado real: os dois títulos que geravam o resíduo (GABRIEL MOREIRA E
GABRIELA COELHO ADVOCACIA, WEON TELECOMUNICACOES) tinham
`valor_cofins+valor_csll+valor_inss+valor_ir+valor_iss+valor_pis`
somando exatamente R$70,01 e R$6,14.

Rodrigo pediu explicitamente pra não calcular a retenção manualmente
(subtrair os campos de imposto), e sim achar um campo que já trouxesse o
valor líquido pronto. Esse campo existe — só que não no cadastro do
título (`ListarContasReceber`/`ListarContasPagar`, nem na consulta
individual `ConsultarContaPagar`, nenhum dos dois tem um campo
"valor_liquido" ou parecido) — está no EXTRATO bancário
(`financas/extrato`/`ListarExtrato`, a mesma fonte que `fluxo_caixa.py`
já usa): pra um movimento com `cOrigem` "Conta a Receber"/"Conta a
Pagar", `nValorDocumento` já vem líquido, descontando retenção e valor
já pago/recebido — e `nCodLancamento` desse movimento é o mesmo
`codigo_lancamento_omie` do título, então dá pra cruzar de volta sem
nenhuma chamada extra. Ver `tools/extrato.previsao_titulos_por_extrato()`
(genérico, monta esse índice) e `_valor_liquido_ou_bruto()`/
`_info_extrato()` abaixo (usa o índice, com fallback pro valor bruto do
título quando ele ainda não aparece no extrato). Mesma função também
passou a fornecer a data de Previsão (prioridade sobre o campo
data_previsao do título, que na prática já bate igual na maioria dos
casos testados, mas o extrato é a fonte mais confiável por ser a mesma
que `fluxo_caixa.py` usa).

Receita recorrente ainda não faturada (2026-08-10)
---------------------------------------------------
Pedido do Rodrigo: o relatório nativo do Omie "Fluxo de Caixa por
Categoria Diário" projeta receita de contratos de serviço recorrentes
(categorias "RPA Recorrente"/"Presto Recorrente") mesmo ANTES do título
do mês ser gerado — algo que nem este relatório nem o `fluxo_caixa.py`
enxergavam (os dois são baseados em título: `ListarContasReceber`/
`ListarContasPagar`, cegos pra receita que ainda não virou título).
Confirmado comparando o dia 28/08/2026 (R$207.975,58 previstos no Omie,
zero em qualquer dos dois sistemas baseados em título) e depois validado
contra o mês inteiro de agosto/2026 com o dump completo dos 830
contratos (`servicos/contrato`/`ListarContratos`).

Achados na validação (830 contratos, comparados campo a campo contra o
export nativo "Fluxo de Caixa por Categoria Diário" detalhado, linha a
linha, do Omie):
  - `cabecalho.cCodSit`: '10'=Ativo (446 contratos, bateu exato com a
    contagem do Rodrigo), '99'=Cancelado (361, bateu exato), '00'=Em
    elaboração (4, bateu exato), '90'=Suspenso (19 — confirmado pelo
    Rodrigo em 2026-08-10, NÃO projetar). Só '10' entra na projeção.
  - `cabecalho.nValTotMes`: valor mensal do contrato — bate exato (nos
    casos testados) com o valor que o Omie usa na projeção.
  - `vencTextos.nDiaFixo`: dia fixo do mês em que o contrato cobra.
    Quando cai em fim de semana: `cAntecipar='S'` -> move pro dia útil
    ANTERIOR; `cPostergar='S'` -> move pro dia útil SEGUINTE (nunca vi
    os dois 'S' nem os dois 'N' nos 446 contratos ativos — sempre
    exatamente um dos dois setado quando nDiaFixo cai em fim de semana).
    Ver `_dia_projetado_no_mes()`. NÃO leva feriado nacional em conta
    (só fim de semana) — pra agosto/2026 não fez diferença (sem feriado
    federal no mês), mas pode divergir em mês com feriado.
  - **A parte mais importante**: comparando por VALOR (ignorando nome —
    "nome_cliente" vem de razão social via Lookups, o export nativo usa
    Nome Fantasia, os dois batem por CNPJ mas não por string) contra as
    379 linhas do detalhe "3.1. RECEITAS PREVISTAS" de agosto/2026: 330
    bateram exato (~87%) só com nDiaFixo+antecipar/postergar, SEM
    nenhuma exclusão. Os ~49 que sobravam do nosso lado eram, na prática
    totalidade, contratos cujo título do mês JÁ tinha sido gerado — ou
    já pago (aparecem em "3. RECEITAS REALIZADAS" nesse caso, confirmado
    linha a linha: NOBREGA FARIAS, VIALLE, IVAN GUIMARAES etc. batendo
    valor exato) ou ainda em aberto (aparecem em "Base - Receber
    Aberto"/`receber_aberto_raw` pro mesmo cliente, mesmo mês). Ou seja:
    **o Omie só projeta a partir do CONTRATO quando ainda não existe
    NENHUM título (aberto ou já realizado) pro cliente naquele mês** —
    quando já existe, ele mostra o título de verdade (que já está
    coberto pelas abas "Base - Receber Aberto"/"Base - Recebimentos"
    existentes) em vez do valor recalculado do contrato.

Por isso `montar_contratos_recorrentes_nao_faturados()` abaixo exclui,
por CÓDIGO DE CLIENTE OMIE (`nCodCli` do contrato == `codigo_cliente_
fornecedor` do título — chave exata, sem depender de nome/CNPJ
formatado), qualquer contrato cujo cliente já tenha um título (aberto OU
já recebido) com Vencimento dentro do mês-alvo. O que sobra é
exatamente o "buraco" que nem este relatório nem o fluxo_caixa.py viam
antes — escrito numa aba nova, "Base - Contratos Recorrentes Nao
Faturados", somada à aba "Fluxo Diario <Mês>" só no lado PREVISTO (nunca
vira "Realizado" aqui — quando o título de verdade é gerado, o contrato
sai automaticamente dessa lista no próximo refresh, porque passa a ter
título em Base - Receber Aberto/Recebimentos).

Vigência do contrato (2026-08-10, pedido explícito do Rodrigo): status
`cCodSit='10'` (Ativo) sozinho NÃO é suficiente — um contrato pode estar
marcado Ativo mas já ter passado da data de `dVigFinal` (achado real:
12 dos 446 contratos ativos nos 830 testados tinham `dVigFinal` no
passado, prováveis renovações pendentes de formalizar no Omie).
`_contrato_vigente_em()` confere que a data projetada (já ajustada por
fim de semana) cai dentro de `[dVigInicial, dVigFinal]` do contrato
antes de incluir a linha — sem isso, um contrato vencido seria
projetado pra sempre.
"""

from __future__ import annotations

import asyncio
import calendar
import hashlib
import html
import json
import os
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from ..client import OmieAPIError, OmieClient

# Status considerados "em aberto" para as abas *Aberto.
_STATUS_ABERTO = ("EMABERTO", "ATRASADO", "AVENCER", "VENCEHOJE", "PAGTO_PARCIAL")

# As contas que NÃO representam dinheiro de verdade (baixa por perda/prejuízo,
# subcontas de cartão de crédito — ver "Contas correntes que NÃO são dinheiro
# de verdade" no docstring acima) chegam por parâmetro (`excluir_contas`),
# vindas das marcações da empresa em fluxo_caixa_config (contas com
# "entra": false). As 4 da Oystr foram para lá na migração 0005.

# Mapeamento best-effort de codigo_tipo_documento -> rótulo (baseado nos
# códigos vistos em dados reais da Oystr; complete se aparecerem outros).
_TIPO_DOCUMENTO_LABELS = {
    "BOL": "Boleto",
    "TRA": "Transferência",
    "99999": "Outros",
    "NFE": "Nota Fiscal Eletrônica",
    "REC": "Recibo",
    "CHQ": "Cheque",
    "DIN": "Dinheiro",
    "DEP": "Depósito",
    "DUP": "Duplicata",
    "PIX": "PIX",
}


def _label_tipo_documento(codigo: str | None) -> str:
    if not codigo:
        return ""
    return _TIPO_DOCUMENTO_LABELS.get(codigo, codigo)


def _parse_br_date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%d/%m/%Y")
    except ValueError:
        return None


def _sem_entities_html(texto: str | None) -> str | None:
    """Decodifica entity HTML (ex.: '&amp;' -> '&') que às vezes vem direto
    do cadastro do Omie (`razao_social`/`nome_fantasia` de `ListarClientes`,
    e também `cRazCliente`/`cDesCliente` do extrato) — BUG REAL (2026-08-13,
    achado pelo Rodrigo: cliente "NELSON WILIANS & ADVOGADOS ASSOCIADOS"
    sumia da aba "Aging Recebiveis" porque o nome vinha gravado como
    "NELSON WILIANS &amp; ADVOGADOS ASSOCIADOS" no cadastro/extrato,
    quebrando o match exato de texto usado pelas fórmulas SUMIFS/COUNTIFS).
    html.unescape() é seguro de aplicar sempre — texto sem entity nenhuma
    passa por ele sem mudar nada."""
    if texto is None:
        return None
    return html.unescape(str(texto))


@dataclass
class Lookups:
    contas_correntes: dict[int, str] = field(default_factory=dict)  # nCodCC -> descricao
    categorias: dict[str, str] = field(default_factory=dict)  # codigo -> descricao
    clientes: dict[int, dict[str, str]] = field(default_factory=dict)  # codigo -> {nome, cnpj_cpf}

    def nome_cliente(self, codigo: int | None) -> str:
        if codigo is None:
            return ""
        c = self.clientes.get(codigo)
        return c["nome"] if c else f"(cliente {codigo} não encontrado)"

    def cnpj_cliente(self, codigo: int | None) -> str:
        if codigo is None:
            return ""
        c = self.clientes.get(codigo)
        return c["cnpj_cpf"] if c else ""

    def categoria(self, codigo: str | None) -> str:
        if not codigo:
            return ""
        return self.categorias.get(codigo, codigo)

    def conta_corrente(self, n_cod_cc: int | None) -> str:
        if n_cod_cc is None:
            return ""
        return self.contas_correntes.get(n_cod_cc, f"(conta {n_cod_cc} não encontrada)")


async def carregar_lookups(client: OmieClient) -> Lookups:
    """Carrega de uma vez as tabelas de apoio (contas correntes, categorias,
    clientes/fornecedores) reaproveitadas por todas as 4 abas."""
    lookups = Lookups()

    contas = await client.call_paginated(
        "geral/contacorrente", "ListarContasCorrentes", params={},
        records_key=["ListarContasCorrentes", "cadastro", "contasCorrentesListaCadastro"],
    )
    for c in contas:
        cod = c.get("nCodCC")
        if cod is not None:
            lookups.contas_correntes[cod] = c.get("descricao", "")

    categorias = await client.call_paginated(
        "geral/categorias", "ListarCategorias", params={},
        records_key=["categoria_cadastro", "cadastros"],
    )
    for cat in categorias:
        cod = cat.get("codigo")
        if cod:
            lookups.categorias[cod] = cat.get("descricao", cod)

    clientes = await client.call_paginated(
        "geral/clientes", "ListarClientes", params={},
        records_key=["clientes_cadastro", "cadastro"],
    )
    for cli in clientes:
        cod = cli.get("codigo_cliente_omie")
        if cod is not None:
            nome = _sem_entities_html(
                cli.get("razao_social") or cli.get("nome_fantasia") or str(cod)
            )
            lookups.clientes[cod] = {
                "nome": nome,
                "cnpj_cpf": cli.get("cnpj_cpf", ""),
            }

    return lookups


# Espera entre chamadas SEGUIDAS ao mesmo método (mesmo modulo+call) — o
# limitador de requisições/segundo do client.py (token bucket global) não
# é suficiente sozinho pra evitar o lock de concorrência do Omie ("Já
# existe uma requisição desse método sendo executada..."), que é por
# MÉTODO, não por volume geral. Confirmado em 2026-08-08: o loop abaixo
# batendo ListarContasPagar 5x seguidas (uma por status de
# _STATUS_ABERTO) disparava esse erro quase toda vez, obrigando o
# client.py a cair no retry/backoff (que funciona, mas desperdiça 1-2min
# por rodada, incluindo o throttle de "consumo redundante" quando o
# backoff tenta de novo rápido demais). Esse pequeno respiro PROATIVO
# entre chamadas ao MESMO método evita cair no erro na maioria das vezes,
# em vez de só reagir a ele depois que já aconteceu.
_ESPERA_ENTRE_CHAMADAS_MESMO_METODO_S = 1.5


async def buscar_titulos_abertos(
    client: OmieClient, modulo: str, call: str, records_key: list[str]
) -> list[dict[str, Any]]:
    """Busca todos os títulos em aberto (todos os status de _STATUS_ABERTO),
    removendo duplicatas por codigo_lancamento_omie (um título pode
    teoricamente aparecer em mais de um status filtrado, embora não devesse).

    Espera um pouco entre cada status pra não bater o mesmo método
    (ListarContasReceber/ListarContasPagar) rápido demais — ver
    `_ESPERA_ENTRE_CHAMADAS_MESMO_METODO_S` acima."""
    vistos: dict[int, dict[str, Any]] = {}
    for i, status in enumerate(_STATUS_ABERTO):
        if i > 0:
            await asyncio.sleep(_ESPERA_ENTRE_CHAMADAS_MESMO_METODO_S)
        try:
            registros = await client.call_paginated(
                modulo, call,
                params={"filtrar_por_status": status},
                records_key=records_key,
            )
        except OmieAPIError as exc:
            # Alguns status podem não ter nenhum título (isso é normal).
            if "não foram encontrados" in str(exc).lower():
                continue
            raise
        for r in registros:
            cod = r.get("codigo_lancamento_omie")
            if cod is not None:
                vistos[cod] = r
    return list(vistos.values())


async def buscar_titulos_liquidados_no_periodo(
    client: OmieClient,
    modulo: str,
    call: str,
    status: str,
    records_key: str,
    data_de: str,
    data_ate: str,
) -> list[dict[str, Any]]:
    """
    Busca títulos já liquidados/pagos (status LIQUIDADO/PAGO) cuja
    data_emissao caia entre data_de e data_ate (dd/mm/aaaa), usando o
    filtro real da API — filtrar_por_emissao_de/filtrar_por_emissao_ate,
    confirmado contra dados reais em 2026-08-06 (as amostras retornadas
    tinham data_emissao exatamente dentro do período pedido). Substitui a
    busca binária por página usada antes, quando não sabíamos que esse
    filtro existia.

    filtrar_por_status="LIQUIDADO" (usado para contas a receber) devolve,
    na prática, títulos com status_titulo="RECEBIDO" *e também*
    status_titulo="CANCELADO" misturados (confirmado em 2026-08-06: de
    657 registros retornados para a Oystr, 156 eram CANCELADO — títulos
    cancelados depois de terem sido liquidados/registrados, sem nenhum
    lançamento bancário correspondente). Descarta CANCELADO aqui, sem
    chamada extra à API — o campo já vem na própria resposta.
    """
    registros = await client.call_paginated(
        modulo, call,
        params={
            "filtrar_por_status": status,
            "filtrar_por_emissao_de": data_de,
            "filtrar_por_emissao_ate": data_ate,
        },
        records_key=[records_key],
    )
    return [r for r in registros if r.get("status_titulo") != "CANCELADO"]


async def buscar_lancamentos_cc_periodo(
    client: OmieClient, data_de: str, data_ate: str
) -> list[dict[str, Any]]:
    """Busca os lançamentos de conta corrente (baixas já conciliadas) do
    período — usado para achar o título original e a data real de
    crédito/débito dos títulos liquidados. Uma chamada paginada cobre
    TODAS as contas correntes de uma vez (nCodCC é opcional no filtro)."""
    from ..tools import lancamentos_cc as tools_lancamentos_cc

    return await tools_lancamentos_cc.listar_lancamentos_cc(
        client, data_pagamento_de=data_de, data_pagamento_ate=data_ate,
    )


def _info_extrato(
    titulo: dict[str, Any], previsao_extrato: dict[int, dict[str, Any]] | None
) -> dict[str, Any] | None:
    """Info do índice montado por
    `tools.extrato.previsao_titulos_por_extrato()` pra esse título
    (cruzado por codigo_lancamento_omie), ou None se o título não tiver
    (ainda) um lançamento previsto correspondente no extrato — nesse caso
    tudo cai no fallback pro dado bruto do próprio título."""
    if not previsao_extrato:
        return None
    codigo = titulo.get("codigo_lancamento_omie")
    return previsao_extrato.get(codigo) if codigo is not None else None


def _data_previsao_ou_vencimento(
    titulo: dict[str, Any], previsao_extrato: dict[int, dict[str, Any]] | None = None
) -> Any:
    """Data de Previsão do título — confirmado por Rodrigo em 2026-08-08 que
    é esse o campo certo pra fluxo de caixa (não Vencimento). Prioridade:
    (1) data do extrato bancário (ver `_info_extrato`/`tools.extrato.
    previsao_titulos_por_extrato` — mesma fonte que fluxo_caixa.py usa,
    então é a mais confiável), (2) campo data_previsao do próprio título,
    (3) Vencimento como último fallback (evita que o título "suma" do
    fluxo de caixa projetado por falta de dado)."""
    info = _info_extrato(titulo, previsao_extrato)
    if info and info.get("data_previsao"):
        data = _parse_br_date(info["data_previsao"])
        if data is not None:
            return data
    return _parse_br_date(titulo.get("data_previsao")) or _parse_br_date(titulo.get("data_vencimento"))


def _valor_liquido_ou_bruto(
    titulo: dict[str, Any], previsao_extrato: dict[int, dict[str, Any]] | None = None
) -> Any:
    """Valor de verdade do título em aberto — confirmado por Rodrigo em
    2026-08-08: não é pra usar `valor_documento` (valor BRUTO da nota
    fiscal), porque títulos com retenção de imposto (IRRF/PIS/COFINS/
    CSLL/INSS/ISS) têm um valor líquido menor de verdade saindo/entrando
    do banco (achado com dado real: R$70,01 e R$6,14 de diferença em dois
    títulos — exatamente a soma das retenções de cada um). O valor
    líquido já vem pronto no extrato bancário (`nValorDocumento`, ver
    `tools.extrato.previsao_titulos_por_extrato()`) — sem precisar
    calcular retenção manualmente aqui. Fallback pro valor bruto do
    título quando ele ainda não aparece no extrato."""
    info = _info_extrato(titulo, previsao_extrato)
    if info and info.get("valor_liquido") is not None:
        return info["valor_liquido"]
    return titulo.get("valor_documento", 0)


def _valor_a_receber_real(
    titulo: dict[str, Any], recebido_por_titulo: dict[Any, float] | None
) -> float:
    """Saldo que ainda vai entrar de verdade: valor bruto do título menos a
    retenção de imposto (IRRF/PIS/COFINS/CSLL/INSS/ISS) e menos o que já foi
    recebido parcialmente (títulos PAGTO_PARCIAL — a baixa parcial já passou
    pela conta corrente e está em `recebido_por_titulo`, indexado pelo código
    do título).

    Diferente de "Valor da Conta" (que, via extrato, só vira líquido quando o
    título aparece lá) e do "A Receber" do fluxo (= Valor da Conta − Recebido,
    com Recebido fixo em 0 aqui). Usado só pela inadimplência (caixa/extra.py),
    pra não contar o valor cheio de um título já parcialmente pago. Confirmado
    com dado real (JORGE ABRAO SOCIEDADE INDIVIDUAL, Startlaw, 2026-10-05):
    dois títulos de 3.098 com 3.000 já recebidos → 98 cada; um de 3.098
    atrasado sem receber → 3.098 (total 3.294, não 9.294)."""
    bruto = float(titulo.get("valor_documento") or 0)
    retencoes = sum(
        float(titulo.get(f"valor_{imp}") or 0)
        for imp in ("pis", "cofins", "csll", "ir", "iss", "inss")
    )
    ja_recebido = (recebido_por_titulo or {}).get(titulo.get("codigo_lancamento_omie"), 0.0)
    return max(0.0, round(bruto - retencoes - ja_recebido, 2))


def _categorias_do_titulo(titulo: dict[str, Any], lookups: Lookups) -> list[tuple[str, float]]:
    """Categoria(s) efetivas do título, com a fração de cada uma.

    Header `codigo_categoria` preenchido = 1 categoria (100%). Header VAZIO +
    rateio em `categorias[]` = uma fração por categoria — é assim que o Omie
    devolve título com distribuição de categorias, e é por isso que o relatório
    nativo "Fluxo de Caixa por Categoria" mostra esses valores repartidos
    (achado 07/10/2026: ~R$ 220 mil/mês de recebimentos caíam como categoria em
    branco aqui e o build_extra jogava quase tudo em "RPA Recorrente" pela moda
    do cliente — RPA de jan/26 saía R$ 922 mil no painel vs R$ 891 mil no
    relatório do Omie). Sem header e sem rateio: [("", 1.0)] — o chamador
    mantém o comportamento antigo (categoria em branco).
    """
    cod = titulo.get("codigo_categoria")
    if cod:
        return [(lookups.categoria(cod), 1.0)]
    cats = [c for c in (titulo.get("categorias") or []) if c.get("codigo_categoria")]
    if not cats:
        return [("", 1.0)]
    tot = sum(float(c.get("valor") or 0) for c in cats)
    if tot > 0:
        return [
            (lookups.categoria(c["codigo_categoria"]), float(c.get("valor") or 0) / tot)
            for c in cats
            if float(c.get("valor") or 0) > 0
        ]
    fr = 1.0 / len(cats)
    return [(lookups.categoria(c["codigo_categoria"]), fr) for c in cats]


def _explodir_linha_por_categorias(
    linha: dict[str, Any],
    titulo: dict[str, Any],
    lookups: Lookups,
    colunas_valor: tuple[str, ...],
) -> list[dict[str, Any]]:
    """Devolve a linha repartida pelo rateio de categorias do título (uma linha
    por categoria, valores proporcionais; a última absorve o resíduo de
    arredondamento para a soma bater com o original). Título sem rateio volta
    como [linha] intacta — custo zero no caso comum."""
    cats = _categorias_do_titulo(titulo, lookups)
    if len(cats) == 1:
        if cats[0][0]:
            linha["Categoria"] = cats[0][0]
        return [linha]
    out: list[dict[str, Any]] = []
    acum = {c: 0.0 for c in colunas_valor}
    for i, (desc, fr) in enumerate(cats):
        l2 = dict(linha)
        l2["Categoria"] = desc or linha.get("Categoria", "")
        ultima = i == len(cats) - 1
        for c in colunas_valor:
            v = linha.get(c) or 0
            if not isinstance(v, (int, float)):
                continue
            p = round(v - acum[c], 2) if ultima else round(v * fr, 2)
            if not ultima:
                acum[c] += p
            l2[c] = p
        out.append(l2)
    return out


def linha_receber_aberto(
    titulo: dict[str, Any],
    lookups: Lookups,
    previsao_extrato: dict[int, dict[str, Any]] | None = None,
    recebido_por_titulo: dict[Any, float] | None = None,
) -> dict[str, Any]:
    return {
        "Razão Social": lookups.nome_cliente(titulo.get("codigo_cliente_fornecedor")),
        "CNPJ/CPF": lookups.cnpj_cliente(titulo.get("codigo_cliente_fornecedor")),
        "Emissão": _parse_br_date(titulo.get("data_emissao")),
        "Vencimento": _parse_br_date(titulo.get("data_vencimento")),
        "Categoria": lookups.categoria(titulo.get("codigo_categoria")),
        "Documento": _label_tipo_documento(titulo.get("codigo_tipo_documento")),
        "Conta Corrente": lookups.conta_corrente(titulo.get("id_conta_corrente")),
        "Valor da Conta": _valor_liquido_ou_bruto(titulo, previsao_extrato),
        "Recebido": 0,  # títulos EMABERTO/ATRASADO/AVENCER/VENCEHOJE: nada recebido ainda
        "Valor a Receber Real": _valor_a_receber_real(titulo, recebido_por_titulo),
        "Previsão": _data_previsao_ou_vencimento(titulo, previsao_extrato),
        "status_titulo": titulo.get("status_titulo", ""),  # útil pra revisão de PAGTO_PARCIAL
    }


def linha_pagar_aberto(
    titulo: dict[str, Any],
    lookups: Lookups,
    previsao_extrato: dict[int, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "Razão Social": lookups.nome_cliente(titulo.get("codigo_cliente_fornecedor")),
        "CNPJ/CPF": lookups.cnpj_cliente(titulo.get("codigo_cliente_fornecedor")),
        "Emissão": _parse_br_date(titulo.get("data_emissao")),
        "Vencimento": _parse_br_date(titulo.get("data_vencimento")),
        "Categoria": lookups.categoria(titulo.get("codigo_categoria")),
        "Documento": _label_tipo_documento(titulo.get("codigo_tipo_documento")),
        "Conta Corrente": lookups.conta_corrente(titulo.get("id_conta_corrente")),
        "Valor da Conta": _valor_liquido_ou_bruto(titulo, previsao_extrato),
        "Valor Pago": 0,
        "Previsão": _data_previsao_ou_vencimento(titulo, previsao_extrato),
        "status_titulo": titulo.get("status_titulo", ""),
    }


def linha_liquidado(
    titulo: dict[str, Any],
    lancamento: dict[str, Any] | None,
    lookups: Lookups,
    coluna_valor_liquidado: str,
) -> dict[str, Any]:
    """Monta uma linha de Base - Recebimentos/Pagamentos. `lancamento` é o
    lançamento de conta corrente (financas/contacorrentelancamentos) já
    casado pelo próprio ID do título (ou None se não achou nenhum
    lançamento vinculado — título liquidado sem baixa bancária, ex.:
    compensação, desconto integral, ou baixa manual sem trânsito pela
    conta corrente; fica para revisão manual do Rodrigo).

    "Data de Crédito ou Débito (No Extrato)" usa cabecalho.dDtLanc do
    lançamento (data_lancamento), NÃO diversos.dDtConc — ver
    tools/lancamentos_cc.py:data_lancamento() para o porquê (consistência
    com fluxo_caixa.py, a rotina de fluxo de caixa diário já em
    produção)."""
    from ..tools import lancamentos_cc as tools_lancamentos_cc

    valor_documento = titulo.get("valor_documento", 0)
    linha = {
        "Cliente/Fornecedor": lookups.nome_cliente(titulo.get("codigo_cliente_fornecedor")),
        "Emissão": _parse_br_date(titulo.get("data_emissao")),
        "Vencimento": _parse_br_date(titulo.get("data_vencimento")),
        "Data de Crédito ou Débito (No Extrato)": None,
        "Categoria": lookups.categoria(titulo.get("codigo_categoria")),
        "Documento": _label_tipo_documento(titulo.get("codigo_tipo_documento")),
        "Conta Corrente": lookups.conta_corrente(titulo.get("id_conta_corrente")),
        "Valor da Conta": valor_documento,
        coluna_valor_liquidado: valor_documento,  # default: assume valor cheio: ver 'conciliado'
        "conciliado": False,
        "codigo_lancamento_omie": titulo.get("codigo_lancamento_omie"),
        # Não é escrito na planilha (fora do cabecalho_para_coluna do script de
        # refresh) — só usado internamente por
        # montar_contratos_recorrentes_nao_faturados() pra saber se um cliente
        # já teve receita realizada no mês-alvo (ver docstring do módulo).
        "codigo_cliente_fornecedor": titulo.get("codigo_cliente_fornecedor"),
        # Idem — elo direto título->contrato (achado real 2026-08-12,
        # "FRANCISCO ALVES"/"NANTES E MELLO"): campo de texto livre que,
        # quando presente, bate exato com `cabecalho.cNumCtr` do contrato.
        # Usado por montar_contratos_recorrentes_nao_faturados() como
        # cruzamento PRIMÁRIO (mais confiável que bater valor) pra
        # contratos de valor variável (RPA/Presto Recorrente).
        "cNumeroContrato": titulo.get("cNumeroContrato"),
    }
    if lancamento is not None:
        data_lanc = tools_lancamentos_cc.data_lancamento(lancamento)
        linha["Data de Crédito ou Débito (No Extrato)"] = _parse_br_date(data_lanc)
        linha[coluna_valor_liquidado] = abs(
            tools_lancamentos_cc.valor_lancamento(lancamento) or valor_documento
        )
        linha["conciliado"] = True
    return linha


async def _consultar_titulo_cache(
    client: OmieClient, consultar, codigo: int, cache: dict[int, dict[str, Any] | None]
) -> dict[str, Any] | None:
    if codigo not in cache:
        try:
            cache[codigo] = await consultar(client, codigo)
        except OmieAPIError:
            cache[codigo] = None
    return cache[codigo]


# --- Cache em disco dos títulos já consultados (2026-08-11) -----------------
#
# Achado (Rodrigo, mesmo dia): em execuções longas (--desde 01/01/2025, mais
# de 1h de duração), o passo mais lento (uma consulta individual por título
# liquidado) é vulnerável a quedas de rede locais (DNS falhando por mais de
# um minuto seguido, mesmo com o backoff/retries reforçados em client.py) —
# reproduzido 2x seguidas no mesmo dia. Como este relatório (--modo
# relatorio) não grava nada em disco até terminar, qualquer queda no meio
# perdia TODO o progresso (ex.: 1200+ títulos já consultados com sucesso),
# obrigando a recomeçar do zero.
#
# Esses títulos são sempre CONSULTADOS PORQUE JÁ FORAM LIQUIDADOS (a baixa
# já aconteceu — é assim que aparecem como título vinculado de um
# lançamento de conta corrente já ocorrido), então seus dados centrais
# (valor, data, cliente, categoria) não mudam mais depois — é seguro
# cachear em disco e reaproveitar entre execuções, não só durante a mesma
# chamada do script. Isso também reduz a EXPOSIÇÃO a instabilidade de rede
# nas reexecuções (só os títulos ainda não vistos precisam de uma chamada
# nova). Só entram no cache consultas que teve SUCESSO ou erro de negócio
# real do Omie (OmieAPIError, ex. título não encontrado) — nunca uma falha
# de rede/timeout (essas nem chegam a setar `cache[codigo]`, ver
# _consultar_titulo_cache acima, então uma reexecução tenta de novo).
_CACHE_DIR = Path(
    os.environ.get("OMIE_CACHE_DIR") or Path(__file__).resolve().parent.parent.parent / ".cache"
)


def _cache_titulos_path(client: OmieClient) -> Path:
    """Um arquivo por CONTA Omie (app_key) — códigos de título só fazem
    sentido dentro da mesma conta. Usa hash da app_key no nome do arquivo
    em vez da chave crua (a chave em si só fica no .env local)."""
    h = hashlib.sha256(client.settings.app_key.encode("utf-8")).hexdigest()[:16]
    return _CACHE_DIR / f"titulos_liquidados_{h}.json"


def _carregar_cache_titulos(path: Path) -> tuple[dict[int, Any], dict[int, Any]]:
    if not path.exists():
        return {}, {}
    try:
        bruto = json.loads(path.read_text(encoding="utf-8"))
        receber = {int(k): v for k, v in bruto.get("receber", {}).items()}
        pagar = {int(k): v for k, v in bruto.get("pagar", {}).items()}
        return receber, pagar
    except (json.JSONDecodeError, OSError, ValueError):
        # Cache corrompido/ilegível — melhor recomeçar do zero do que
        # travar o relatório inteiro por causa de um arquivo auxiliar.
        return {}, {}


async def _salvar_cache_titulos(
    path: Path, cache_receber: dict[int, Any], cache_pagar: dict[int, Any]
) -> None:
    """Salva o cache em disco. NUNCA deixa uma falha aqui derrubar o
    relatório inteiro (achado real 2026-08-13, ver docstring do módulo,
    seção "Salvamento de cache resiliente a lock do OneDrive") — o cache
    é só uma otimização de performance entre execuções, perder UM save
    não é motivo pra jogar fora um relatório de 1h+ já quase pronto."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    conteudo = json.dumps({"receber": cache_receber, "pagar": cache_pagar}, ensure_ascii=False)

    _TENTATIVAS = 5
    _ESPERAS = [0.5, 1, 2, 4, 8]  # segundos — locks do OneDrive costumam ser breves
    for tentativa in range(1, _TENTATIVAS + 1):
        try:
            tmp.write_text(conteudo, encoding="utf-8")
            tmp.replace(path)  # escrita atômica — evita corromper o cache se cair no meio do write
            return
        except OSError as exc:
            if tentativa == _TENTATIVAS:
                print(
                    f"  [aviso] não foi possível salvar o cache local de títulos "
                    f"({path.name}) após {_TENTATIVAS} tentativas — provável arquivo "
                    f"temporariamente travado pela sincronização do OneDrive. Seguindo "
                    f"sem salvar o cache desta vez (não afeta o relatório, só faz a "
                    f"próxima execução reconsultar mais títulos do zero). Erro: {exc}",
                    flush=True,
                )
                return
            await asyncio.sleep(_ESPERAS[tentativa - 1])


async def montar_recebimentos_pagamentos(
    client: OmieClient,
    lookups: Lookups,
    data_de: str,
    data_ate: str,
    excluir_contas: set[int] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Monta as linhas de Base - Recebimentos/Pagamentos.

    Critério de inclusão em [data_de, data_ate] (dd/mm/aaaa): a DATA DO
    LANÇAMENTO na conta corrente (cabecalho.dDtLanc, via
    lancamentos_cc.data_lancamento) — o mesmo critério que fluxo_caixa.py
    (rotina de fluxo de caixa diário já em produção) usa via
    dDataLancamento do extrato. Confirmado em 2026-08-06: a versão
    anterior deste relatório filtrava títulos por DATA DE EMISSÃO, o que
    fazia um título emitido em julho mas pago em agosto ficar de fora (ou
    na janela errada) — foi o Rodrigo quem notou a divergência comparando
    contra o fluxo_caixa.py.

    Dois conjuntos, sem duplicar título:
      1) PRIMÁRIO — lançamentos de conta corrente com dDtLanc dentro do
         período, cruzados com o título vinculado (nCodLancCR/nCodLancCP).
         `conciliado=True`.
      2) SEM PAR — títulos com status LIQUIDADO/PAGO cuja EMISSÃO caia no
         período mas que não apareceram no conjunto 1 (título liquidado
         sem nenhum lançamento bancário — compensação, desconto integral,
         baixa manual, etc.). `conciliado=False`, para revisão manual.

    Isso significa uma consulta individual (ConsultarContaReceber/
    ConsultarContaPagar) por título encontrado no conjunto primário — o
    relatório fica mais lento que antes (antes só paginava em lote), mas
    é o preço de bucketizar pela data real do movimento em vez da
    emissão.
    """
    from ..tools import contas_correntes as tools_contas_correntes
    from ..tools import contas_pagar as tools_contas_pagar
    from ..tools import contas_receber as tools_contas_receber
    from ..tools import lancamentos_cc as tools_lancamentos_cc

    margem = timedelta(days=20)
    lanc_de = (_parse_br_date(data_de) - margem).strftime("%d/%m/%Y")
    lanc_ate = (_parse_br_date(data_ate) + margem).strftime("%d/%m/%Y")
    lancamentos = await buscar_lancamentos_cc_periodo(client, lanc_de, lanc_ate)

    # Só conta como entrada/saída real de caixa lançamento em conta
    # corrente de verdade — ver "Contas correntes que NÃO são dinheiro de
    # verdade" no docstring do módulo (baixa por perda/prejuízo, subcontas
    # de cartão de crédito, etc. não são trânsito bancário real).
    contas_validas = await tools_contas_correntes.contas_fluxo_de_caixa(
        client, excluir=excluir_contas
    )
    lancamentos = [
        lc for lc in lancamentos
        if tools_lancamentos_cc.conta_corrente_id(lc) in contas_validas
    ]

    alvo_de = _parse_br_date(data_de)
    alvo_ate = _parse_br_date(data_ate)

    linhas_recebimentos: list[dict[str, Any]] = []
    linhas_pagamentos: list[dict[str, Any]] = []
    titulos_vistos_receber: set[int] = set()
    titulos_vistos_pagar: set[int] = set()

    # Cache em disco entre execuções — ver "Cache em disco dos títulos já
    # consultados (2026-08-11)" acima de _consultar_titulo_cache. Se uma
    # execução anterior já consultou parte destes títulos (mesmo tendo
    # caído no meio por queda de rede), reaproveita em vez de consultar de
    # novo.
    cache_path = _cache_titulos_path(client)
    cache_receber, cache_pagar = _carregar_cache_titulos(cache_path)
    if cache_receber or cache_pagar:
        print(f"  Cache local encontrado: {len(cache_receber)} título(s) de recebimento e "
              f"{len(cache_pagar)} de pagamento já consultados em execuções anteriores "
              f"(não serão consultados de novo).", flush=True)

    # Progresso na tela — esta é a etapa mais demorada (uma consulta
    # individual ao Omie por título baixado no período), e ficava 100%
    # silenciosa antes (parecia travado mesmo quando só estava lento).
    # Ver achado de 2026-08-10 no docstring do módulo.
    print(f"  Cruzando {len(lancamentos)} lançamento(s) de conta corrente com os títulos "
          f"originais (uma consulta por título — pode ser a etapa mais lenta)...", flush=True)
    consultados = 0

    try:
        for lc in lancamentos:
            dt_lanc = _parse_br_date(tools_lancamentos_cc.data_lancamento(lc))
            if dt_lanc is None or not (alvo_de <= dt_lanc <= alvo_ate):
                continue

            cod_receber = tools_lancamentos_cc.titulo_vinculado_receber(lc)
            cod_pagar = tools_lancamentos_cc.titulo_vinculado_pagar(lc)

            if cod_receber is not None:
                titulo = await _consultar_titulo_cache(
                    client, tools_contas_receber.consultar_conta_receber, cod_receber,
                    cache_receber,
                )
                if titulo is not None:
                    linhas_recebimentos.extend(_explodir_linha_por_categorias(
                        linha_liquidado(titulo, lc, lookups, "Recebido"),
                        titulo, lookups, ("Valor da Conta", "Recebido")))
                    titulos_vistos_receber.add(cod_receber)
                consultados += 1
            elif cod_pagar is not None:
                titulo = await _consultar_titulo_cache(
                    client, tools_contas_pagar.consultar_conta_pagar, cod_pagar, cache_pagar
                )
                if titulo is not None:
                    linhas_pagamentos.extend(_explodir_linha_por_categorias(
                        linha_liquidado(titulo, lc, lookups, "Valor Pago"),
                        titulo, lookups, ("Valor da Conta", "Valor Pago")))
                    titulos_vistos_pagar.add(cod_pagar)
                consultados += 1
            # lançamentos sem nCodLancCR/CP (ex.: transferência entre contas,
            # tarifa bancária) não são baixa de título — ficam fora das duas abas.

            if consultados and consultados % 100 == 0:
                print(f"    ...{consultados} título(s) consultado(s) até agora.", flush=True)
                await _salvar_cache_titulos(cache_path, cache_receber, cache_pagar)
    finally:
        # Salva mesmo se o loop for interrompido por uma exceção (ex.: a
        # queda de rede que motivou este cache) — o progresso até aqui não
        # se perde numa próxima execução. `_salvar_cache_titulos` nunca
        # levanta (ver docstring dela) — uma falha de disco aqui não deve
        # mascarar/derrubar o relatório que já foi montado com sucesso.
        await _salvar_cache_titulos(cache_path, cache_receber, cache_pagar)

    recebidos_raw = await buscar_titulos_liquidados_no_periodo(
        client, "financas/contareceber", "ListarContasReceber", "LIQUIDADO",
        "conta_receber_cadastro", data_de, data_ate,
    )
    pagos_raw = await buscar_titulos_liquidados_no_periodo(
        client, "financas/contapagar", "ListarContasPagar", "PAGO",
        "conta_pagar_cadastro", data_de, data_ate,
    )
    for t in recebidos_raw:
        cod = t.get("codigo_lancamento_omie")
        if cod not in titulos_vistos_receber:
            linhas_recebimentos.extend(_explodir_linha_por_categorias(
                linha_liquidado(t, None, lookups, "Recebido"),
                t, lookups, ("Valor da Conta", "Recebido")))
    for t in pagos_raw:
        cod = t.get("codigo_lancamento_omie")
        if cod not in titulos_vistos_pagar:
            linhas_pagamentos.extend(_explodir_linha_por_categorias(
                linha_liquidado(t, None, lookups, "Valor Pago"),
                t, lookups, ("Valor da Conta", "Valor Pago")))

    return linhas_recebimentos, linhas_pagamentos


def _dia_projetado_no_mes(
    dia_fixo: int, antecipar: str | None, postergar: str | None, ano: int, mes: int
) -> int | None:
    """Em que dia do mês (ano, mes) o contrato deveria cobrar, dado
    `vencTextos.nDiaFixo` (dia fixo do mês) e o ajuste de fim de semana
    (`cAntecipar`/`cPostergar`) — ver "Receita recorrente ainda não
    faturada" no docstring do módulo pra evidência da regra.

    Se `dia_fixo` cair em fim de semana: 'S' em antecipar move pro
    último dia ÚTIL anterior; 'S' em postergar move pro próximo dia
    ÚTIL seguinte. Se nenhum dos dois estiver 'S' (raro/nunca visto nos
    446 contratos ativos testados), mantém o dia sem ajuste — mais
    seguro do que arriscar mover pro mês errado.

    NÃO leva feriado nacional/estadual em conta, só fim de semana — se
    algum mês tiver divergência sistemática num feriado, é o próximo
    lugar a olhar (precisaria de um calendário de feriados BR).

    Retorna None se o ajuste empurrar pra fora do mês (dia_fixo=1 ou 2
    caindo num fim de semana no início do mês, com cAntecipar='S' —
    nesse caso o dia útil anterior cai no mês ANTERIOR; melhor não
    projetar do que projetar no dia errado do mês corrente)."""
    import calendar as _calendar
    from datetime import date as _date
    from datetime import timedelta as _timedelta

    if dia_fixo <= 0 or dia_fixo > _calendar.monthrange(ano, mes)[1]:
        return None
    d = _date(ano, mes, dia_fixo)
    if d.weekday() < 5:  # 0=Seg .. 4=Sex já é dia útil, sem ajuste
        return dia_fixo
    if antecipar == "S":
        while d.weekday() >= 5:
            d -= _timedelta(days=1)
    elif postergar == "S":
        while d.weekday() >= 5:
            d += _timedelta(days=1)
    else:
        return dia_fixo
    return d.day if (d.year, d.month) == (ano, mes) else None


def _proximo_mes(ano: int, mes: int) -> tuple[int, int]:
    return (ano + 1, 1) if mes == 12 else (ano, mes + 1)


def _contrato_vigente_em(cabecalho: dict[str, Any], data_projetada) -> bool:
    """Confere se `data_projetada` (a data em que a cobrança cairia,
    já ajustada por fim de semana) está dentro da vigência do contrato
    — `cabecalho.dVigInicial`/`dVigFinal` (dd/mm/aaaa).

    Pedido explícito do Rodrigo (2026-08-10): cada contrato tem uma
    data de vigência, e a projeção precisa respeitar isso — não basta
    olhar `cCodSit='10'` (Ativo). Achado real nos 830 contratos
    testados: 12 contratos com `cCodSit='10'` já tinham `dVigFinal` no
    passado (prováveis casos de renovação pendente ainda não
    formalizada no Omie) — sem esse filtro, esses 12 seriam projetados
    pra sempre, mesmo com o contrato tecnicamente vencido.

    Comparação por MÊS, não pelo dia exato (fix 2026-08-12): o
    caso real "M S Asessoria Juridicas" tinha `dVigFinal`=20/08/2026 e
    `nDiaFixo`=24 (cobra todo dia 24) — comparando dia a dia, a
    ocorrência de agosto (24/08) caía 4 dias DEPOIS do dVigFinal e era
    descartada, mesmo o contrato ainda ativo e o relatório nativo do
    Omie esperando essa receita em 24/08. Rodrigo confirmou: "uma
    coisa é o faturamento, outra é data de vencimento" — a data de
    vigência do contrato e o dia de faturamento são conceitos
    diferentes, não faz sentido cortar a cobrança do mês só porque o
    dia de faturamento cai depois do dVigFinal dentro do mesmo mês.
    Por isso o corte agora é por mês: o mês do dVigFinal ainda conta
    inteiro (mesma lógica que Rodrigo descreveu pra vigência em geral —
    "um contrato de 1000 com Vencimento do contrato dia 31/12, será
    considerado na projecao mensalmente até dezembro" — dezembro
    incluído), só o mês SEGUINTE ao dVigFinal é que fica de fora.
    Simétrico pro dVigInicial, pelo mesmo motivo.

    `dVigInicial` ausente/inválido não bloqueia (assume que já começou
    — mais seguro do que perder projeção por dado faltando).
    `dVigFinal` ausente/inválido também não bloqueia (contrato sem
    prazo definido, comum em recorrência "por prazo indeterminado)."""
    inicio = _parse_br_date(cabecalho.get("dVigInicial"))
    if inicio is not None:
        inicio_data = inicio.date()
        if (data_projetada.year, data_projetada.month) < (inicio_data.year, inicio_data.month):
            return False
    fim = _parse_br_date(cabecalho.get("dVigFinal"))
    if fim is not None:
        fim_data = fim.date()
        if (data_projetada.year, data_projetada.month) > (fim_data.year, fim_data.month):
            return False
    return True


def linha_contrato_nao_faturado(
    contrato: dict[str, Any], lookups: Lookups, ano: int, mes: int, dia: int
) -> dict[str, Any]:
    from datetime import date as _date

    cab = contrato.get("cabecalho", {}) or {}
    n_cod_cli = cab.get("nCodCli")
    return {
        "Razão Social": lookups.nome_cliente(n_cod_cli),
        "CNPJ/CPF": lookups.cnpj_cliente(n_cod_cli),
        "Contrato": cab.get("nCodCtr"),
        "Categoria": "Recorrente (contrato, ainda não faturado)",
        "Valor Mensal": cab.get("nValTotMes", 0),
        "Data Prevista": _date(ano, mes, dia),
    }


async def montar_contratos_recorrentes_nao_faturados(
    client: OmieClient,
    lookups: Lookups,
    receber_aberto_raw: list[dict[str, Any]],
    linhas_recebimentos: list[dict[str, Any]],
    meses: list[tuple[int, int]],
    debug_cod_cli: int | None = None,
) -> list[dict[str, Any]]:
    """
    *** SUBSTITUÍDA em 2026-08-13 (BUG REAL #7) — NÃO é mais chamada por
    `montar_relatorio()`. *** Mantida no código só como referência
    histórica dos bugs #1-#6 documentados abaixo (todos genuínos,
    todos corrigidos aqui) — não apagar sem motivo, mas não reativar
    sem entender por que foi substituída.

    O motivo da substituição: mesmo depois de 6 fixes reais em cima
    desta função (tolerância de valor, cruzamento por número de
    contrato, escopo por cliente, fallback nDiaFat+nDias, bucket por
    mês de emissão), o caso "PEREIRA GIONEDIS ADVOGADOS" revelou um
    problema estrutural que nenhum heurística ia resolver de forma
    confiável: uma "OS Adicional de Contrato" (cobrança pontual
    vinculada ao contrato) carrega o MESMO `cNumeroContrato` que a
    fatura mensal regular — não dá pra distinguir uma da outra só
    pelos dados do título, não importa quão específica a regra de
    cruzamento fique. Confirmado com o Rodrigo (2026-08-13) e com dado
    real (`ListarExtrato`, `cOrigem="Previsão de Contratos Mensais"`)
    que o PRÓPRIO Omie já expõe essa previsão pronta e correta — com
    ajuste de fim de semana/feriado já calculado — sem precisar
    reconstruir `nDiaFixo`/`nDiaFat`/`nDias`/vigência/cruzamento com
    título na mão. Ver `montar_contratos_nao_faturados_via_extrato()`
    logo abaixo desta função, que é a versão nova, muito mais simples
    e mais confiável (fonte direta do Omie, não reimplementação).

    Docstring original (histórico dos bugs #1-#6), preservado abaixo:

    Monta as linhas da aba "Base - Contratos Nao Faturados" (nome
    encurtado em 2026-08-12 — o original "Base - Contratos Recorrentes
    Nao Faturados" tinha 42 caracteres, acima do limite de 31 do Excel
    pra nome de aba; ver nota em refresh_oystr_diagnostico.py):
    receita de contratos de serviço recorrentes (`ListarContratos`,
    `cCodSit='10'`=Ativo) projetada pro(s) mês(es) em `meses`
    [(ano, mes), ...], EXCLUINDO qualquer contrato cujo cliente já tenha
    um título (aberto OU já recebido) com Vencimento dentro daquele mês
    — ver "Receita recorrente ainda não faturada" no docstring do
    módulo pra evidência de que é essa a regra que o próprio relatório
    nativo do Omie usa.

    Cruzamento por `nCodCli`/`codigo_cliente_fornecedor` (código Omie do
    cliente) — não por nome nem CNPJ formatado, pra evitar falso-negativo
    por variação de grafia (razão social vs. nome fantasia).

    Cruzamento por VALOR além de cliente (fix 2026-08-12): cliente com
    mais de um contrato recorrente (ex. "PEREIRA GIONEDIS ADVOGADOS",
    3 contratos ativos — R$14.939,05/R$17.791,54/R$3.000,00) tinha TODOS
    os contratos excluídos do mês assim que QUALQUER UM deles já tinha
    título gerado, mesmo os outros ainda não faturados — achado real
    comparando contra o relatório nativo do Omie (dia 28/08 previa
    R$32.730,59 pra esse cliente, R$14.939,05 a menos do que a gente
    projetava, exatamente o valor do contrato ainda não faturado que
    estava sendo escondido pelos outros dois já faturados). Por isso o
    cruzamento agora é por (cliente, valor) — um título de R$17.791,54
    só "abate" o contrato de mesmo valor, não os outros do mesmo cliente.

    Tolerância de 5 centavos no valor (fix 2026-08-12, achado real
    "NELSON WILIANS & ADVOGADOS ASSOCIADOS"): o título real de agosto
    tinha `valor_documento`=23.350,40, mas `cabecalho.nValTotMes` do
    contrato era 23.350,41 — 1 centavo de diferença (arredondamento
    interno do Omie entre o valor "cheio" do contrato e o valor
    efetivamente faturado). Com igualdade exata isso não batia, e o
    contrato era projetado de novo em cima de um título que já existia
    (dia 28/08 duplicava pra R$46.700,81 quando o relatório nativo do
    Omie previa R$23.350,40 — o dobro exato). Só falha (volta a
    comportar como antes) se dois contratos do mesmo cliente tiverem
    valor mensal a menos de 5 centavos um do outro — caso raro, e mesmo
    assim não pior que o comportamento anterior.

    Cruzamento por NÚMERO DE CONTRATO — fix 2026-08-12, achado real
    "FRANCISCO ALVES SOCIEDADE INDIVIDUAL DE ADVOCACIA": contrato
    nCodCtr=2538079528/cNumCtr="994", nValTotMes=R$489,00 (RPA/Presto
    Recorrente — "Presto - Credencial"+"Presto - Usuário", plano base),
    mas o título real de agosto (RECEBIDO, boleto.cGerado="N") tinha
    valor_documento=R$1.977,00 — mais de 4x o valor nominal do contrato,
    bem além de qualquer tolerância de arredondamento. O cruzamento por
    (cliente, valor com tolerância de 5 centavos) sozinho NUNCA bate
    esse caso, então o contrato ficava sendo projetado de novo (receita
    fantasma). MAS o título trazia `cNumeroContrato`="994" — batendo
    EXATO com `cabecalho.cNumCtr`="994" do contrato — um elo direto
    título->contrato que não depende do valor bater. Confirmado que
    esse campo aparece tanto com `boleto.cGerado="S"` (achado antes, no
    caso NANTES E MELLO) quanto "N" (este caso) — não é exclusivo de
    título gerado por boleto, hipótese anterior estava errada.

    Por isso o cruzamento agora tem DOIS níveis: primeiro tenta bater
    por `cNumeroContrato`/`cNumCtr` (mais confiável, cobre contrato de
    valor variável); só cai pro cruzamento por (cliente, valor+tolerância)
    quando o título não tem `cNumeroContrato` preenchido (ainda existe —
    nem todo título parece trazer esse campo, caso não confirmado ainda
    com 100% dos tipos de lançamento/origem).

    Caso "CAIQUE CASTRO" (contrato de R$3.600,00, título real de agosto
    de só R$600,00) — CONFIRMADO 2026-08-12 com o mesmo padrão exato de
    FRANCISCO ALVES (`cNumeroContrato`="990" batendo `cNumCtr`="990" do
    contrato) — os 2 casos reais conhecidos de valor variável estão
    cobertos por este cruzamento.

    BUG REAL encontrado e CORRIGIDO (2026-08-13) — `cNumeroContrato` NÃO
    é único globalmente: rodando em produção com o fix acima, o cliente
    "NANTES E MELLO" (causa raiz #3, ver fallback nDiaFat+nDias acima)
    sumiu de novo — mas só do mês de AGOSTO, continuando certo em
    setembro/outubro. Conferindo o cache local de títulos já consultados
    (21 mil+ registros), achado que `cNumeroContrato` se REPETE entre
    clientes DIFERENTES: 11 de 640 números distintos usados por mais de
    1 `codigo_cliente_fornecedor` (ex.: "413" usado tanto pelo cliente
    2514438745 quanto pelo 1892794692). Isso prova que não é um ID
    globalmente único (provavelmente uma numeração que se repete por
    algum outro escopo dentro do Omie, não confirmado qual) — o primeiro
    cruzamento (`_bate_por_numero_contrato`) comparava esse número
    IGNORANDO o cliente, então o título de agosto de um cliente
    qualquer, com o mesmo número "por coincidência" de um contrato de
    OUTRO cliente, marcava esse outro contrato como "já faturado" sem
    ter relação nenhuma com ele. **Fix**: o cruzamento por número de
    contrato agora é escopado por CLIENTE também (`nCodCli`/
    `codigo_cliente_fornecedor`), igual ao cruzamento por valor — nunca
    cruza `cNumeroContrato` de um cliente com o de outro.

    BUG REAL encontrado e CORRIGIDO (2026-08-13) — dedup por mês de
    VENCIMENTO cancelava o mês ERRADO quando faturamento e vencimento
    caem em meses de calendário diferentes: mesmo depois do fix acima, a
    NANTES E MELLO seguia sumindo só de agosto. Dump cru + confirmação do
    Rodrigo (`--debug-cliente`, ver script) revelou a causa real: o
    contrato tem `nDiaFat`=20 (fatura perto do fim do mês) e prazo curto
    (`nDias`=5), então o título que cobre a receita de JULHO foi emitido
    em 27/07 mas só venceu em 01/08 — o mês de Vencimento (agosto) é
    DIFERENTE do mês que o título realmente cobre (julho). O cruzamento
    (por número de contrato E por valor) bucketava por Vencimento, então
    esse título "já faturado" de julho cancelava errado a projeção de
    AGOSTO (o mês seguinte, ainda sem título nenhum) em vez de não afetar
    nada (julho já está fora da janela de projeção). Rodrigo confirmou a
    regra de negócio: "o Omie está correto... Julho foi faturado em
    julho e recebido no dia 3 de agosto" — ou seja, a fatura de julho
    (caixa em agosto) e a fatura de agosto (a vencer ~25/08, ainda não
    faturada) são duas receitas DISTINTAS que só coincidem de cair no
    mesmo mês de caixa, não uma duplicata. Conferido no cache de títulos
    que esse padrão não é raro (~4,4% dos títulos com `cNumeroContrato`
    têm emissão e Vencimento em meses de calendário diferentes — sempre
    faturamento no fim de um mês com Vencimento início do seguinte).
    **Fix**: os dois cruzamentos (número de contrato e valor+tolerância)
    agora bucketam por mês de EMISSÃO, não de Vencimento (fallback pro
    mês de Vencimento só quando a emissão não vier preenchida). Validado
    que não quebra os casos reais já confirmados (FRANCISCO ALVES e
    CAIQUE CASTRO): nesses dois, emissão e Vencimento caem no MESMO mês,
    então o bucket não muda pra eles.
    """
    from ..tools import servicos as tools_servicos

    contratos = await tools_servicos.listar_contratos_servico(client)
    contratos_ativos = [
        c for c in contratos if (c.get("cabecalho", {}) or {}).get("cCodSit") == "10"
    ]

    _TOLERANCIA_VALOR = 0.05

    # cliente -> lista de valores de título (aberto ou recebido) com
    # Vencimento no mês-alvo — um dict por mês, pra não confundir "já tem
    # título em agosto" com "já tem título em setembro" (mês seguinte deve
    # continuar projetando normalmente mesmo que agosto já esteja
    # faturado). Cada valor é "consumido" (removido da lista) na hora de
    # bater com um contrato, pra um título só poder abater UM contrato.
    ja_tem_titulo: dict[tuple[int, int], dict[int, list[float]]] = {
        m: defaultdict(list) for m in meses
    }
    # cruzamento primário por número de contrato (fix 2026-08-12, corrigido
    # 2026-08-13 pra escopar por CLIENTE — ver docstring acima, `cNumeroContrato`
    # NÃO é único globalmente, se repete entre clientes diferentes) — mês ->
    # cliente -> conjunto de `cNumeroContrato` já vistos num título (aberto ou
    # recebido) DESSE cliente com Vencimento naquele mês.
    numero_contrato_com_titulo: dict[tuple[int, int], dict[int, set[str]]] = {
        m: defaultdict(set) for m in meses
    }

    def _numero_contrato_normalizado(valor: Any) -> str | None:
        texto = str(valor or "").strip()
        return texto or None

    def _bate_titulo_existente(ano: int, mes: int, cod_cli: int, valor_contrato: float) -> bool:
        valores = ja_tem_titulo.get((ano, mes), {}).get(cod_cli)
        if not valores:
            return False
        for i, v in enumerate(valores):
            if abs(v - valor_contrato) <= _TOLERANCIA_VALOR:
                valores.pop(i)
                return True
        return False

    def _bate_por_numero_contrato(
        ano: int, mes: int, cod_cli: int | None, num_ctr: str | None
    ) -> bool:
        if num_ctr is None or cod_cli is None:
            return False
        return num_ctr in numero_contrato_com_titulo.get((ano, mes), {}).get(cod_cli, set())

    # Chave de dedup por mês de EMISSÃO, não de Vencimento (BUG REAL #6,
    # 2026-08-13, achado "NANTES E MELLO SOCIEDADE DE ADVOGADOS", CONFIRMADO
    # pelo Rodrigo com a regra de negócio real): contrato recorrente com
    # `nDiaFat`=20 fatura perto do fim do mês (emissão real observada:
    # 27/07) com um prazo curto (`nDias`=5) que empurra o Vencimento pro
    # mês SEGUINTE (01/08) — mas o título ainda representa a receita do mês
    # em que foi FATURADO (julho), não do mês em que vence (agosto).
    # Confirmado pelo Rodrigo: "o Omie está correto... Julho foi faturado
    # em julho e recebido no dia 3 de agosto" — ou seja, a fatura de julho
    # (recebida em agosto) e a fatura de agosto (a vencer ~25/08, ainda não
    # faturada) são DUAS receitas distintas que podem cair no mesmo mês de
    # caixa por coincidência de calendário, não uma duplicata uma da outra.
    # O bucket antigo (por Vencimento) cancelava errado a projeção do mês
    # SEGUINTE (agosto) usando um título que na verdade já é a cobertura do
    # mês ANTERIOR (julho, fora da janela de projeção) — subestimando a
    # receita prevista real. Conferido no cache de títulos: esse padrão
    # (emissão e Vencimento em meses de calendário diferentes) não é raro —
    # 345 de 7906 títulos com `cNumeroContrato` (~4,4%) têm emissão no fim
    # de um mês e Vencimento no início do seguinte. Fix: bucket por mês de
    # EMISSÃO (com fallback pro mês de Vencimento só se emissão não vier
    # preenchida) tanto no cruzamento por número de contrato quanto no de
    # valor+tolerância.
    for t in receber_aberto_raw:
        emissao = _parse_br_date(t.get("data_emissao"))
        venc = _parse_br_date(t.get("data_vencimento"))
        ref = emissao or venc
        if ref is None:
            continue
        chave = (ref.year, ref.month)
        if chave in ja_tem_titulo:
            cod = t.get("codigo_cliente_fornecedor")
            if cod is not None:
                valor = round(float(t.get("valor_documento") or 0), 2)
                ja_tem_titulo[chave][cod].append(valor)
                num_ctr = _numero_contrato_normalizado(t.get("cNumeroContrato"))
                if num_ctr is not None:
                    numero_contrato_com_titulo[chave][cod].add(num_ctr)

    for l in linhas_recebimentos:
        emissao = l.get("Emissão")
        venc = l.get("Vencimento")
        ref = emissao or venc
        if ref is None:
            continue
        chave = (ref.year, ref.month)
        if chave in ja_tem_titulo:
            cod = l.get("codigo_cliente_fornecedor")
            if cod is not None:
                valor = round(float(l.get("Valor da Conta") or 0), 2)
                ja_tem_titulo[chave][cod].append(valor)
                num_ctr = _numero_contrato_normalizado(l.get("cNumeroContrato"))
                if num_ctr is not None:
                    numero_contrato_com_titulo[chave][cod].add(num_ctr)

    from datetime import date as _date

    linhas: list[dict[str, Any]] = []
    contratos_nao_mensais_ignorados = 0
    for c in contratos_ativos:
        cab = c.get("cabecalho", {}) or {}
        venc_textos = c.get("vencTextos", {}) or {}
        n_cod_cli = cab.get("nCodCli")

        # Só projeta contrato de faturamento MENSAL (fix 2026-08-12):
        # `cabecalho.cTipoFat` é o código de periodicidade do contrato —
        # confirmado com 2 casos reais: "01" = mensal (M S Asessoria,
        # cobra todo mês) e "12" = anual (Leão Alimentos, cobra 1x/ano,
        # última fatura em julho/2026, próxima só em 2027). A projeção
        # daqui assume cadência mensal (projeta o MESMO valor em todos os
        # meses da janela); pra contrato anual/trimestral/semestral isso
        # inflava a receita prevista (Leão projetado em ago/set/out, R$
        # 11.660,64 cada mês, quando na real não fatura de novo até
        # 2027) — achado comparando contra o relatório nativo do Omie,
        # que também não estava prevendo essa receita em agosto. Contrato
        # não-mensal fica de fora por enquanto (nenhuma projeção, não
        # tem lógica pra decidir a data certa da próxima fatura anual/
        # trimestral ainda) — subestimar é mais seguro que inflar.
        _debug = debug_cod_cli is not None and n_cod_cli == debug_cod_cli
        if _debug:
            print(f"[DEBUG contrato] nCodCli={n_cod_cli} nCodCtr={cab.get('nCodCtr')} "
                  f"cNumCtr={cab.get('cNumCtr')!r} cCodSit={cab.get('cCodSit')} "
                  f"cTipoFat={cab.get('cTipoFat')!r} nValTotMes={cab.get('nValTotMes')} "
                  f"dVigInicial={cab.get('dVigInicial')!r} dVigFinal={cab.get('dVigFinal')!r} "
                  f"nDiaFixo={venc_textos.get('nDiaFixo')!r} nDiaFat={cab.get('nDiaFat')!r} "
                  f"nDias={venc_textos.get('nDias')!r}", flush=True)

        if cab.get("cTipoFat") != "01":
            if _debug:
                print(f"[DEBUG contrato]   -> IGNORADO: cTipoFat != '01' (não-mensal)", flush=True)
            contratos_nao_mensais_ignorados += 1
            continue

        try:
            dia_fixo = int(venc_textos.get("nDiaFixo") or 0)
        except (TypeError, ValueError):
            dia_fixo = 0

        if dia_fixo <= 0:
            # Fallback (2026-08-12, achado real "NANTES E MELLO SOCIEDADE DE
            # ADVOGADOS"): esse contrato tem `vencTextos.nDiaFixo`=0 — não é
            # dado faltando, é um esquema de vencimento DIFERENTE
            # (`vencTextos.cTpVenc`="001", com `nDias`=5 — "vence N dias
            # depois de X", em vez de "dia fixo do mês"). O cliente tem
            # receita recorrente real (~R$2.000/mês) que o relatório nativo
            # do Omie projeta pro dia 25/08 — e `cabecalho.nDiaFat`
            # ("dia de faturamento" do contrato) desse caso é 20: 20 + 5
            # (nDias) = 25, batendo exato com o dia que o Omie espera.
            # Só entra aqui quando nDiaFixo realmente não veio (não muda
            # nada pro caso normal, já validado, onde nDiaFixo é usado
            # direto). Ainda não confirmado se essa é a regra EXATA do
            # Omie pra esse tipo de vencimento (só um caso real validado
            # até agora) — se a projeção desses contratos não bater com o
            # relatório nativo em casos futuros, é o próximo lugar a olhar.
            try:
                dia_fat = int(cab.get("nDiaFat") or 0)
            except (TypeError, ValueError):
                dia_fat = 0
            try:
                n_dias_prazo = int(venc_textos.get("nDias") or 0)
            except (TypeError, ValueError):
                n_dias_prazo = 0
            dia_fixo = dia_fat + n_dias_prazo if dia_fat > 0 else 0

        if dia_fixo <= 0:
            if _debug:
                print(f"[DEBUG contrato]   -> IGNORADO: dia_fixo <= 0 mesmo após fallback "
                      f"(nDiaFat ausente/zero)", flush=True)
            continue

        valor_contrato = round(float(cab.get("nValTotMes") or 0), 2)
        numero_contrato = _numero_contrato_normalizado(cab.get("cNumCtr"))
        if _debug:
            print(f"[DEBUG contrato]   dia_fixo calculado={dia_fixo} valor_contrato={valor_contrato} "
                  f"numero_contrato={numero_contrato!r}", flush=True)
            for chave_mes, cli_map in numero_contrato_com_titulo.items():
                print(f"[DEBUG contrato]   numero_contrato_com_titulo[{chave_mes}] pra este cliente = "
                      f"{cli_map.get(n_cod_cli, set())!r}", flush=True)
            for chave_mes, cli_map in ja_tem_titulo.items():
                print(f"[DEBUG contrato]   ja_tem_titulo[{chave_mes}] pra este cliente = "
                      f"{cli_map.get(n_cod_cli, [])!r}", flush=True)

        for ano, mes in meses:
            # Cruzamento primário: número de contrato, ESCOPADO POR CLIENTE
            # (fix 2026-08-13 — `cNumeroContrato` não é único globalmente,
            # ver docstring da função) — elo direto, independe do valor
            # bater — cobre RPA/Presto Recorrente de valor variável. Só cai
            # pro cruzamento por (cliente, valor+tolerância) quando o
            # título não trouxe `cNumeroContrato` preenchido.
            if _bate_por_numero_contrato(ano, mes, n_cod_cli, numero_contrato):
                if _debug:
                    print(f"[DEBUG contrato]   {ano}-{mes:02d}: PULADO (bateu por número de contrato)",
                          flush=True)
                continue
            if n_cod_cli is not None and _bate_titulo_existente(ano, mes, n_cod_cli, valor_contrato):
                if _debug:
                    print(f"[DEBUG contrato]   {ano}-{mes:02d}: PULADO (bateu por valor+tolerância)",
                          flush=True)
                continue
            dia = _dia_projetado_no_mes(
                dia_fixo, venc_textos.get("cAntecipar"), venc_textos.get("cPostergar"), ano, mes
            )
            if dia is None:
                if _debug:
                    print(f"[DEBUG contrato]   {ano}-{mes:02d}: PULADO (_dia_projetado_no_mes "
                          f"retornou None)", flush=True)
                continue
            # Respeita a vigência do contrato (dVigInicial/dVigFinal) —
            # ver _contrato_vigente_em(): status 'Ativo' sozinho não
            # basta, tem contrato com cCodSit='10' e dVigFinal vencido.
            if not _contrato_vigente_em(cab, _date(ano, mes, dia)):
                if _debug:
                    print(f"[DEBUG contrato]   {ano}-{mes:02d}: PULADO (fora da vigência, dia "
                          f"projetado={dia})", flush=True)
                continue
            if _debug:
                print(f"[DEBUG contrato]   {ano}-{mes:02d}: PROJETADO no dia {dia}", flush=True)
            linhas.append(linha_contrato_nao_faturado(c, lookups, ano, mes, dia))

    if contratos_nao_mensais_ignorados:
        print(
            f"    {contratos_nao_mensais_ignorados} contrato(s) não-mensal(is) "
            "(cTipoFat != '01' — trimestral/semestral/anual) NÃO projetado(s) "
            "(sem lógica de próxima fatura pra eles ainda).",
            flush=True,
        )

    return linhas


def linha_contrato_nao_faturado_via_extrato(mov: dict[str, Any]) -> dict[str, Any] | None:
    """
    Monta uma linha de "Base - Contratos Nao Faturados" DIRETO de um
    movimento de extrato com `cOrigem="Previsão de Contratos Mensais"`
    (ver `tools/extrato.buscar_previsoes()`) — BUG REAL #7 (2026-08-13),
    ver docstring de `montar_contratos_recorrentes_nao_faturados` acima
    pra contexto completo de por que essa é a versão nova.

    Nenhum campo é recalculado — tudo vem pronto do Omie:
    `cRazCliente`/`cDocCliente` (nome/CNPJ do cliente),
    `nCodLancamento` (= `nCodCtr` do contrato — confirmado com 2 casos
    reais, NANTES E MELLO e PEREIRA GIONEDIS), `cDesCategoria`
    (categoria financeira), `nValorDocumento` (valor) e
    `dDataLancamento` (data prevista, JÁ com ajuste de fim de semana/
    feriado feito pelo próprio Omie).

    Retorna None se o movimento não tiver `dDataLancamento` válida
    (defensivo — não esperado em uso normal, mas evita quebrar o
    relatório inteiro por causa de um registro malformado).
    """
    data_prevista = _parse_br_date(mov.get("dDataLancamento"))
    if data_prevista is None:
        return None
    return {
        "Razão Social": _sem_entities_html(mov.get("cRazCliente") or mov.get("cDesCliente")),
        "CNPJ/CPF": mov.get("cDocCliente"),
        "Contrato": mov.get("nCodLancamento"),
        "Categoria": mov.get("cDesCategoria"),
        "Valor Mensal": round(float(mov.get("nValorDocumento") or 0), 2),
        "Data Prevista": data_prevista,
    }


def montar_contratos_nao_faturados_via_extrato(
    movimentos_contratos_mensais: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Monta "Base - Contratos Nao Faturados" inteira a partir dos
    movimentos de "Previsão de Contratos Mensais" do extrato — ver
    `linha_contrato_nao_faturado_via_extrato()` acima e o docstring de
    `montar_contratos_recorrentes_nao_faturados` (função antiga,
    substituída) pra todo o histórico de bugs que motivou essa troca.

    Não faz nenhum filtro adicional (nem de vigência, nem de valor, nem
    de tipo de faturamento mensal/anual) — confia que o Omie já só
    inclui aqui contrato realmente ativo e de cadência mensal (é
    literalmente o que "Contratos MENSAIS" no nome da origem sugere).
    Se algum caso real mostrar um contrato não-mensal ou fora de
    vigência aparecendo aqui incorretamente, esse é o próximo lugar a
    investigar — mas até 2026-08-13 nenhuma evidência real disso.
    """
    linhas = [
        linha_contrato_nao_faturado_via_extrato(mov)
        for mov in movimentos_contratos_mensais
    ]
    linhas = [l for l in linhas if l is not None]
    linhas.sort(key=lambda l: (l["Data Prevista"], l["Razão Social"] or ""))
    return linhas


def linha_os_nao_faturada_via_extrato(mov: dict[str, Any]) -> dict[str, Any] | None:
    """
    Monta uma linha de "Base - OS Nao Faturadas" a partir de um
    movimento de extrato com `cOrigem="Previsão de Ordem de Serviço"`
    (ver `tools/extrato.buscar_previsoes()`) — pedido do Rodrigo
    (2026-08-13): OS (Ordem de Serviço) ainda não faturada é receita
    NÃO recorrente/pontual (ex.: "OS Adicional de Contrato", uma
    cobrança avulsa vinculada a um contrato mas que NÃO é a
    mensalidade regular — caso real "PEREIRA GIONEDIS ADVOGADOS"),
    diferente da recorrência do contrato — por isso vai numa aba
    separada, não junto de "Base - Contratos Nao Faturados".

    CONFIRMADO com exemplo real (2026-08-13, cliente NOBREGA FARIAS
    ADVOGADOS ASSOCIADOS, pedido explicitamente ao Rodrigo pra rodar
    `debug_extrato_previsoes.py --busca "NOBREGA FARIAS"` porque a OS
    dele estava "Previsto para hoje" na tela de Ordens de Serviço do
    Omie):
        {"cCodCategoria": "1.01.01", "cDesCategoria": "RPA Recorrente",
         "cDesCliente"/"cRazCliente": "NOBREGA FARIAS ADVOGADOS ASSOCIADOS",
         "cDocCliente": "03.672.963/0001-20", "cNatureza": "R",
         "cNumero": "18336", "cOrigem": "Previsão de Ordem de Serviço",
         "cSituacao": "Previsto", "cTipoDocumento": "Ordem de Serviço",
         "dDataLancamento": "13/08/2026", "nCodCliente": 1835266040,
         "nCodLancamento": 2541385746, "nValorDocumento": 5505.83}
    Mesmo formato de campo (nome/CNPJ/categoria/valor/data) que
    `linha_contrato_nao_faturado_via_extrato` — CONFIRMADO igual.

    ACHADO REAL (2026-08-13) — `nCodLancamento` NÃO é o número da OS: é
    um código interno de lançamento contábil (2541385746 no exemplo
    acima), diferente do "OS N° 18336" que aparece na tela de Ordens de
    Serviço do Omie e que bate com o campo `cNumero` ("18336") do
    movimento. Pra contrato mensal, `nCodLancamento` É o `nCodCtr` do
    contrato (confirmado antes) — mas pra OS o campo equivalente
    "amigável"/reconhecível é `cNumero`, não `nCodLancamento`. Por isso
    a coluna "OS" usa `cNumero` (com fallback pro código interno só se
    `cNumero` vier vazio, pra nunca ficar em branco).
    """
    data_prevista = _parse_br_date(mov.get("dDataLancamento"))
    if data_prevista is None:
        return None
    return {
        "Razão Social": _sem_entities_html(mov.get("cRazCliente") or mov.get("cDesCliente")),
        "CNPJ/CPF": mov.get("cDocCliente"),
        "OS": mov.get("cNumero") or mov.get("nCodLancamento"),
        "Categoria": mov.get("cDesCategoria"),
        "Valor": round(float(mov.get("nValorDocumento") or 0), 2),
        "Data Prevista": data_prevista,
    }


def montar_os_nao_faturadas_via_extrato(
    movimentos_os_avulsas: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Monta "Base - OS Nao Faturadas" inteira — ver
    `linha_os_nao_faturada_via_extrato()` acima."""
    linhas = [
        linha_os_nao_faturada_via_extrato(mov)
        for mov in movimentos_os_avulsas
    ]
    linhas = [l for l in linhas if l is not None]
    linhas.sort(key=lambda l: (l["Data Prevista"], l["Razão Social"] or ""))
    return linhas


def _janela_previsao_titulos(
    titulos: list[dict[str, Any]], margem_dias: int = 5
) -> tuple[str, str]:
    """Janela [data_inicial, data_final] (dd/mm/aaaa) pra buscar no extrato
    bancário (`tools.extrato.previsao_titulos_por_extrato`) — usada só pra
    enriquecer título em aberto com valor líquido/data de previsão.

    O início da janela NUNCA vai antes de hoje (menos a margem), mesmo que
    exista título com Previsão/Vencimento bem no passado (ex.: um devedor
    parado desde 2025) — Rodrigo confirmou em 2026-08-08: um título com
    Previsão no passado nunca aparece na aba Fluxo Diário mesmo (a fórmula
    só soma previsto pra dia >= hoje, dentro do mês corrente — ver
    `fluxo_diario_mensal.py`), então não vale a pena buscar o extrato de
    período tão longo só pra enriquecer um título que não vai ser usado
    nessa conta. Título muito atrasado assim fica com o valor BRUTO
    (fallback) nas outras abas (Aging Recebíveis, Compromissos Futuros) —
    mesmo comportamento que já existia antes deste fix."""
    datas = [
        d for d in (
            _parse_br_date(t.get("data_previsao")) or _parse_br_date(t.get("data_vencimento"))
            for t in titulos
        )
        if d is not None
    ]
    margem = timedelta(days=margem_dias)
    hoje = datetime.now()
    if not datas:
        return hoje.strftime("%d/%m/%Y"), hoje.strftime("%d/%m/%Y")
    # Both bounds passam por max(..., hoje) — se todos os títulos forem
    # antigos (Previsão/Vencimento no passado), início e fim colapsam pra
    # perto de hoje (janela pequena e válida), em vez de início > fim.
    inicio = max(min(datas), hoje) - margem
    fim = max(max(datas), hoje) + margem
    return inicio.strftime("%d/%m/%Y"), fim.strftime("%d/%m/%Y")


async def montar_relatorio(
    client: OmieClient,
    data_de: str,
    data_ate: str,
    debug_cod_cli: int | None = None,
    excluir_contas: set[int] | None = None,
) -> dict[str, Any]:
    """
    Monta as 4 listas de linhas (uma por aba "Base -") prontas para
    escrever no Oystr_Diagnostico_Consolidado.xlsx.

    data_de/data_ate (dd/mm/aaaa): período usado para Base - Recebimentos/
    Pagamentos (ver montar_recebimentos_pagamentos — critério é a data
    real do lançamento na conta corrente, não a emissão do título). As
    abas *Aberto trazem TODOS os títulos em aberto, independente do
    período (não faz sentido limitar títulos ainda não baixados por data).
    """
    from ..tools import contas_correntes as tools_contas_correntes
    from ..tools import extrato as tools_extrato

    # Progresso na tela por etapa — antes disso o script ficava 100%
    # silencioso do "Buscando dados..." até o fim, o que parecia travado
    # mesmo quando só estava demorando (achado real, 2026-08-10).
    print("  Carregando lookups (contas correntes, categorias, clientes)...", flush=True)
    lookups = await carregar_lookups(client)

    print("  Buscando títulos em aberto (Contas a Receber)...", flush=True)
    receber_aberto_raw = await buscar_titulos_abertos(
        client, "financas/contareceber", "ListarContasReceber",
        ["conta_receber_cadastro", "cadastros"],
    )
    print(f"    {len(receber_aberto_raw)} título(s) em aberto (Receber).", flush=True)

    print("  Buscando títulos em aberto (Contas a Pagar)...", flush=True)
    pagar_aberto_raw = await buscar_titulos_abertos(
        client, "financas/contapagar", "ListarContasPagar",
        ["conta_pagar_cadastro", "cadastros"],
    )
    print(f"    {len(pagar_aberto_raw)} título(s) em aberto (Pagar).", flush=True)

    # Meses de projeção (mês corrente + 2 seguintes) — precisa ser
    # calculado ANTES da busca no extrato agora, porque a previsão nativa
    # de contrato/OS avulsa (bug #7, ver abaixo) precisa de uma janela que
    # cubra os 3 meses inteiros, não só as datas dos títulos já em aberto.
    # Ver "Receita recorrente ainda não faturada" no docstring do módulo.
    hoje = datetime.now().date()
    meses_projecao = [(hoje.year, hoje.month)]
    for _ in range(2):
        meses_projecao.append(_proximo_mes(*meses_projecao[-1]))
    ultimo_ano, ultimo_mes = meses_projecao[-1]
    ultimo_dia = calendar.monthrange(ultimo_ano, ultimo_mes)[1]
    fim_projecao = datetime(ultimo_ano, ultimo_mes, ultimo_dia)

    # Valor líquido de verdade (descontando retenção de imposto) e data de
    # previsão dos títulos em aberto — confirmado por Rodrigo em 2026-08-08
    # que valor_documento (bruto) não é o campo certo quando o título tem
    # retenção configurada. Ver "Valor LÍQUIDO já pronto pra título em
    # aberto" no docstring de tools/extrato.py.
    #
    # MESMA passada pelo extrato (bug #7, 2026-08-13) já traz também a
    # previsão NATIVA do Omie pra contrato recorrente e OS avulsa ainda não
    # faturados (`cOrigem` "Previsão de Contratos Mensais"/"Previsão de
    # Ordem de Serviço") — ver tools/extrato.py::buscar_previsoes(). Por
    # isso a janela do extrato agora precisa cobrir não só as datas dos
    # títulos já em aberto (`_janela_previsao_titulos`), mas o fim do
    # último mês projetado — alarga só o FIM, o início continua o mesmo
    # (nunca faz sentido buscar previsão no passado).
    print("  Buscando extrato bancário (previsão de títulos, contratos e OS avulsas)...", flush=True)
    contas_validas = await tools_contas_correntes.contas_fluxo_de_caixa(
        client, excluir=excluir_contas
    )
    data_ini_prev, data_fim_titulos = _janela_previsao_titulos(
        receber_aberto_raw + pagar_aberto_raw
    )
    fim_titulos_dt = _parse_br_date(data_fim_titulos) or fim_projecao
    data_fim_prev = max(fim_titulos_dt, fim_projecao).strftime("%d/%m/%Y")
    previsao = await tools_extrato.buscar_previsoes(
        client, sorted(contas_validas), data_ini_prev, data_fim_prev
    )
    previsao_extrato = previsao["titulos"]

    if debug_cod_cli is not None:
        nome_debug = (lookups.nome_cliente(debug_cod_cli) or "").strip().upper()
        print(f"  [DEBUG cod_cli={debug_cod_cli} nome={nome_debug!r}] movimentos de previsão "
              f"de contrato/OS avulsa encontrados no extrato:", flush=True)
        for mov in previsao["contratos_mensais"] + previsao["os_avulsas"]:
            if nome_debug and nome_debug in str(mov.get("cRazCliente", "")).upper():
                print(f"    {mov}", flush=True)

    print("  Montando Base - Recebimentos/Pagamentos (títulos já liquidados no período)...", flush=True)
    linhas_recebimentos, linhas_pagamentos = await montar_recebimentos_pagamentos(
        client, lookups, data_de, data_ate, excluir_contas
    )
    print(f"    {len(linhas_recebimentos)} recebimento(s) / {len(linhas_pagamentos)} pagamento(s).", flush=True)

    # Receita recorrente ainda não faturada (contratos ativos sem título
    # gerado ainda) e OS avulsa/pontual ainda não faturada — ambas montadas
    # DIRETO da previsão nativa do Omie já buscada acima (bug #7). Ver
    # montar_contratos_nao_faturados_via_extrato/montar_os_nao_faturadas_
    # via_extrato mais acima no módulo.
    print("  Montando contratos recorrentes e OS avulsas ainda não faturados "
          "(previsão nativa do Omie)...", flush=True)
    linhas_contratos_nao_faturados = montar_contratos_nao_faturados_via_extrato(
        previsao["contratos_mensais"]
    )
    linhas_os_nao_faturadas = montar_os_nao_faturadas_via_extrato(
        previsao["os_avulsas"]
    )
    print(f"    {len(linhas_contratos_nao_faturados)} linha(s) de receita recorrente ainda não "
          f"faturada, {len(linhas_os_nao_faturadas)} linha(s) de OS avulsa ainda não faturada.",
          flush=True)

    # Quebra por mês (2026-08-12, pedido do Rodrigo — o total de 3 meses
    # somado, sem quebra, parecia alto demais comparado com a receita
    # recorrente mensal total dos contratos ativos, e não dava pra saber
    # se o problema era num mês específico ou era só o efeito esperado de
    # projetar meses futuros distantes, onde ainda não existe NENHUM
    # título gerado — ver nota no docstring do módulo).
    contratos_por_mes: dict[tuple[int, int], dict[str, Any]] = {}
    for (ano_m, mes_m) in meses_projecao:
        contratos_por_mes[(ano_m, mes_m)] = {"contagem": 0, "valor": 0.0}
    for linha in linhas_contratos_nao_faturados:
        data_prevista = linha["Data Prevista"]
        chave = (data_prevista.year, data_prevista.month)
        if chave not in contratos_por_mes:
            contratos_por_mes[chave] = {"contagem": 0, "valor": 0.0}
        contratos_por_mes[chave]["contagem"] += 1
        contratos_por_mes[chave]["valor"] += linha["Valor Mensal"]
    print("    Quebra por mês (contratos):", flush=True)
    for (ano_m, mes_m) in meses_projecao:
        info = contratos_por_mes[(ano_m, mes_m)]
        print(f"      {mes_m:02d}/{ano_m}: {info['contagem']} contrato(s), "
              f"R$ {info['valor']:,.2f}", flush=True)

    # Mesma quebra por mês, agora pra OS avulsa (bug #7) — categoria
    # separada porque é receita NÃO recorrente/pontual (pedido do Rodrigo
    # 2026-08-13), não deve ser somada junto com "contratos" na leitura do
    # relatório mesmo que ambas entrem na mesma "Entrada" do Fluxo Diário.
    os_por_mes: dict[tuple[int, int], dict[str, Any]] = {}
    for (ano_m, mes_m) in meses_projecao:
        os_por_mes[(ano_m, mes_m)] = {"contagem": 0, "valor": 0.0}
    for linha in linhas_os_nao_faturadas:
        data_prevista = linha["Data Prevista"]
        chave = (data_prevista.year, data_prevista.month)
        if chave not in os_por_mes:
            os_por_mes[chave] = {"contagem": 0, "valor": 0.0}
        os_por_mes[chave]["contagem"] += 1
        os_por_mes[chave]["valor"] += linha["Valor"]
    print("    Quebra por mês (OS avulsas):", flush=True)
    for (ano_m, mes_m) in meses_projecao:
        info = os_por_mes[(ano_m, mes_m)]
        print(f"      {mes_m:02d}/{ano_m}: {info['contagem']} OS, "
              f"R$ {info['valor']:,.2f}", flush=True)

    # Soma já recebida por título (baixas que passaram pela conta corrente),
    # indexada pelo código do título, para o saldo real "a receber" dos títulos
    # parcialmente pagos na inadimplência (ver _valor_a_receber_real).
    recebido_por_titulo: dict[Any, float] = {}
    for _l in linhas_recebimentos:
        _cod = _l.get("codigo_lancamento_omie")
        if _cod is not None:
            recebido_por_titulo[_cod] = recebido_por_titulo.get(_cod, 0.0) + float(_l.get("Recebido") or 0)

    return {
        "base_receber_aberto": [
            linha
            for t in receber_aberto_raw
            for linha in _explodir_linha_por_categorias(
                linha_receber_aberto(t, lookups, previsao_extrato, recebido_por_titulo),
                t, lookups, ("Valor da Conta", "Recebido", "Valor a Receber Real"))
        ],
        "base_pagar_aberto": [
            linha
            for t in pagar_aberto_raw
            for linha in _explodir_linha_por_categorias(
                linha_pagar_aberto(t, lookups, previsao_extrato),
                t, lookups, ("Valor da Conta", "Valor Pago"))
        ],
        "base_recebimentos": linhas_recebimentos,
        "base_pagamentos": linhas_pagamentos,
        "base_contratos_nao_faturados": linhas_contratos_nao_faturados,
        "base_os_nao_faturadas": linhas_os_nao_faturadas,
        "estatisticas": {
            "receber_aberto": len(receber_aberto_raw),
            "pagar_aberto": len(pagar_aberto_raw),
            "recebimentos_total": len(linhas_recebimentos),
            "recebimentos_conciliados": sum(1 for l in linhas_recebimentos if l["conciliado"]),
            "pagamentos_total": len(linhas_pagamentos),
            "pagamentos_conciliados": sum(1 for l in linhas_pagamentos if l["conciliado"]),
            "contratos_nao_faturados": len(linhas_contratos_nao_faturados),
            "contratos_nao_faturados_valor_total": sum(
                l["Valor Mensal"] for l in linhas_contratos_nao_faturados
            ),
            "contratos_nao_faturados_por_mes": [
                {
                    "ano": ano_m, "mes": mes_m,
                    "contagem": contratos_por_mes[(ano_m, mes_m)]["contagem"],
                    "valor": contratos_por_mes[(ano_m, mes_m)]["valor"],
                }
                for (ano_m, mes_m) in meses_projecao
            ],
            "os_nao_faturadas": len(linhas_os_nao_faturadas),
            "os_nao_faturadas_valor_total": sum(
                l["Valor"] for l in linhas_os_nao_faturadas
            ),
            "os_nao_faturadas_por_mes": [
                {
                    "ano": ano_m, "mes": mes_m,
                    "contagem": os_por_mes[(ano_m, mes_m)]["contagem"],
                    "valor": os_por_mes[(ano_m, mes_m)]["valor"],
                }
                for (ano_m, mes_m) in meses_projecao
            ],
        },
    }
