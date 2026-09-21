"""
Análise de Faturamento / MRR / ARR / Churn — módulo novo (2026-08-20,
pedido do Rodrigo): "no modulo de servicos, precisamos levantar o
faturamento por cliente, categoria para calcular os kpis (MRR, ARR,
churn, etc)", puxando direto da API do Omie (não mais export manual da
skill gerar-dashboard-mrr-oystr) e validando o status de cada contrato
(Ativo/Cancelado/Suspenso).

REGRAS DE CÁLCULO: as MESMAS da skill `gerar-dashboard-mrr-oystr`
(scripts/generate_dashboard.py) — só a ORIGEM do dado muda (API em vez de
export manual). Reaproveitado quase 1:1:
  - MRR do mês/categoria = soma de `valor_documento` (bruto da nota) de
    todos os títulos de Contas a Receber com Emissão naquele mês, na
    categoria (ou "Total" = todas).
  - ARR = MRR do mês x 12 — proxy simples ("taxa anualizada corrente"),
    NÃO é a soma real dos 12 meses. Igual à skill original.
  - Ticket médio = valor total do mês/categoria / nº de clientes
    distintos que faturaram no mês/categoria.
  - Novos clientes (mês N) = clientes que faturaram em N mas não em N-1.
  - Churn "bruto" (mês N) = clientes que faturaram em N-1 mas não em N —
    igual à skill (ausência de faturamento). Ver "VALIDAÇÃO DE CONTRATO"
    abaixo pro que é novo aqui.
  - Churn Rate = churn do mês / clientes do mês anterior.
  - Crescimento = variação % do MRR total do mês vs mês anterior.

VALIDAÇÃO DE CONTRATO (novo nesta rodada, é o que o Rodrigo pediu além da
skill original): a skill original enxerga churn só pela AUSÊNCIA de
faturamento num mês — não sabe se o contrato do cliente continua ativo
ou não. Aqui, além disso, cada cliente que aparece na aba "Clientes com
Churn" é cruzado com `servicos/contrato` (`ListarContratos`, TODOS os
contratos, sem filtro de status) pra dizer se ele:
  - não tem NENHUM contrato "Ativo" no cadastro -> "Churn confirmado por
    status de contrato";
  - AINDA TEM contrato "Ativo" -> "Churn NÃO confirmado — contrato
    segue ativo, pode ser atraso/gap de faturamento (revisar)";
  - não tem contrato cadastrado nenhum (nCodCli não aparece em nenhum
    contrato) -> "Sem contrato recorrente cadastrado (provável OS
    avulsa/pontual)".

COMPETÊNCIA, NÃO CAIXA (2026-08-20, pedido explícito do Rodrigo): "o
contas a receber não tem importância [aqui]... não importa a data de
recebimento e nem se recebeu" — este módulo NUNCA olha pra status de
recebimento/liquidação. O histórico vem de `ListarContasReceber` só
porque é onde mora `data_emissao`/`valor_documento` de cada título — mas
TODOS os status entram (aberto, liquidado, atrasado, tanto faz), o único
filtro é a data de Emissão. Além do histórico, este módulo agora também
projeta "o que será faturado" nos meses seguintes (contrato ativo,
categoria recorrente, ainda sem título gerado) — reaproveitando 1:1 a
MESMA fonte que "Base - Contratos Nao Faturados" já usa
(`tools/extrato.py::buscar_previsoes()`, origem nativa do Omie "Previsão
de Contratos Mensais"): a data usada É a de competência/faturamento
projetado (`dDataLancamento`, já ajustada pra dia útil pelo próprio
Omie), NUNCA vencimento — confirmado pelo Rodrigo: "aqui nao importa o
vencimento do titulo, mas quando será faturado (competencia)". Cada
linha de faturamento carrega `realizado=True` (veio de título já
emitido) ou `realizado=False` (projeção de contrato ativo ainda não
faturado) — as abas de saída marcam visualmente qual é qual (nunca
mistura os dois tipos sem avisar).

CATEGORIAS QUE CONTAM COMO "RECORRÊNCIA" (MRR) — decidido pelo Rodrigo
em 2026-08-20: só "RPA Recorrente" e "Presto Recorrente" (mesmas 2 já
usadas pela skill original) — "são as únicas duas categorias nesta
empresa que são recorrência". "RPA Excedentes"/"Presto Excedentes"
(cobrança variável extra), "Execução Unica", "Desenvolvimento",
"Outras Receitas" e títulos sem categoria continuam entrando no quadro
"Total" (faturamento da empresa como um todo), mas ficam FORA de tudo
que é "recorrência": do quadro virtual `QUADRO_RECORRENTE` ("MRR (RPA +
Presto Recorrente)", a métrica principal de MRR no Resumo Executivo) e
das abas "MRR - Novos Clientes"/"MRR - Clientes com Churn" (que agora
só listam cliente com faturamento recorrente — pedido explícito depois
do Rodrigo notar cliente de projeto avulso, tipo "Execução Unica",
aparecendo como "churn" sem nunca ter sido recorrente).

STATUS DE CONTRATO (cCodSit) — CONFIRMADO em 2026-08-20 (recon real,
838 contratos, + confirmação do Rodrigo direto na tela do Omie):
'10'=Ativo (444), '99'=Cancelado (372), '90'=Suspenso (17-18 — 1 de
diferença entre o recon e a contagem do Rodrigo, provavelmente um
contrato mudou de status entre as duas consultas, não é motivo de
dúvida sobre o mapeamento). `cCodSit`='00' (4 contratos) ficou SEM
explicação — 444+372+17=833 não fecha com os 838 encontrados, sobram
exatamente os 4 de '00'. Como é baixo impacto (4 contratos) e não
identificado, fica como "Desconhecido" — conta como NÃO-Ativo pra
validação de churn (lado mais seguro/conservador).

CRUZAMENTO título -> cliente: por CLIENTE (`codigo_cliente_fornecedor` /
`nCodCli`), NUNCA por número de contrato. Achado real já documentado em
oystr_diagnostico.py: `cNumeroContrato` só vem preenchido em ~4,4% dos
títulos — não dá pra confiar nele como chave principal (por isso a
métrica "Qtde de Contratos (#)" nas abas abaixo é só informativa, tende a
SUBESTIMAR bastante — "Qtde de Clientes (#)" é a métrica confiável).
Efeito colateral: se um cliente tiver mais de um contrato (ex. um RPA
Recorrente ativo e um Presto Recorrente cancelado), o status mostrado
pra ele é "tem pelo menos 1 contrato Ativo" — não dá pra saber, só pelo
título, qual contrato específico gerou aquela linha de faturamento.

Uso:
    python scripts\\analise_faturamento_mrr.py --cliente oystr --modo recon --desde 01/01/2026
        Só lê e IMPRIME (não escreve nada): contratos por cCodSit (com
        exemplo de cada), categorias encontradas nos títulos de receita
        desde --desde, volume (nº de títulos) e quantos títulos têm
        `cNumeroContrato` preenchido. RODE ISSO PRIMEIRO, sempre.

    python scripts\\analise_faturamento_mrr.py --cliente oystr --modo gerar ^
        --arquivo Oystr_Diagnostico_Consolidado.xlsx --desde 01/01/2026 --meses-futuros 2
        Gera 4 abas novas dentro de uma CÓPIA do arquivo indicado (nunca
        sobrescreve o original — mesmo padrão de nome com timestamp já
        usado por refresh_oystr_diagnostico.py):
          - "MRR - Resumo Executivo" (4 quadros: Total / MRR (RPA + Presto
            Recorrente) [métrica principal] / RPA Recorrente / Presto
            Recorrente — layout baseado na skill gerar-dashboard-mrr-
            oystr; colunas de mês futuro/projetado marcadas "(proj.)";
            períodos 100% projeção ficam com Novos Clientes/Churn "-")
          - "MRR - Novos Clientes"
          - "MRR - Clientes com Churn" (+ coluna de validação de status
            de contrato, ver acima)
          - "Base - Status Contratos" (1 linha por contrato: cliente,
            nCodCtr, cCodSit cru, status mapeado, valor mensal, vigência)
        `--meses-futuros N` (padrão 2) controla quantos meses ALÉM do mês
        atual entram como projeção ("o que será faturado", contrato ativo
        ainda sem título gerado) — use `--meses-futuros 0` pra olhar só
        o histórico já faturado.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import re
import sys
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpyxl import load_workbook  # noqa: E402
from openpyxl.styles import Alignment, Font, PatternFill  # noqa: E402

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.reports.oystr_diagnostico import (  # noqa: E402
    Lookups, carregar_lookups, _EXCLUIR_CONTAS_NAO_CAIXA,
)
from omie_mcp.tools import contas_correntes as tools_contas_correntes  # noqa: E402
from omie_mcp.tools import contas_receber as tools_contas_receber  # noqa: E402
from omie_mcp.tools import extrato as tools_extrato  # noqa: E402
from omie_mcp.tools import servicos as tools_servicos  # noqa: E402

# --- Status de contrato ----------------------------------------------------
# cCodSit -> rótulo. Confirmado pelo Rodrigo em 2026-08-20 (contagem batendo
# quase exata contra o recon: '10'=Ativo 444/444, '99'=Cancelado 372/372,
# '90'=Suspenso 18 no recon vs 17 que o Rodrigo viu na tela do Omie —
# diferença de 1 contrato, provavelmente um mudou de status entre as duas
# consultas, não é motivo pra desconfiar do mapeamento). 'cCodSit'='00' (4
# contratos) ficou SEM explicação do Rodrigo (444+372+17=833, sobra de 5 pro
# total de 838 encontrado, e o recon isolou exatamente 4 em '00') — fica
# como "Desconhecido" de propósito (conta como NÃO-Ativo pra validação de
# churn, lado mais seguro) até confirmar; são só 4 contratos, baixo impacto.
STATUS_CONTRATO_MAP: dict[str, str] = {
    "10": "Ativo",
    "99": "Cancelado",
    "90": "Suspenso",
}

CATEGORIAS_QUADRO = ["Total", "RPA Recorrente", "Presto Recorrente"]

# Pedido do Rodrigo (2026-08-20, depois de ver que "MRR - Clientes com
# Churn" incluía clientes de categorias não-recorrentes tipo "Execução
# Unica"): "vamos avaliar MRR apenas para RPA Recorrente e Presto
# Recorrente, sao as unicas duas categorias nesta empresa que sao
# Recorrencia". QUADRO_RECORRENTE é um quadro "virtual" (união das duas
# categorias) usado como MÉTRICA PRINCIPAL de MRR — as abas "MRR - Novos
# Clientes"/"MRR - Clientes com Churn" agora usam ELE (não mais "Total")
# pra decidir quem entra na lista, e o Resumo Executivo ganha um quadro
# novo com esse nome, logo depois de "Total".
CATEGORIAS_RECORRENTES = ["RPA Recorrente", "Presto Recorrente"]
QUADRO_RECORRENTE = "MRR (RPA + Presto Recorrente)"
CATEGORIAS_RESUMO = ["Total", QUADRO_RECORRENTE, "RPA Recorrente", "Presto Recorrente"]

# Categorias encontradas no recon (2026-08-20) que NÃO são receita
# operacional de serviço — excluídas do faturamento analisado (de todas as
# abas, não só do quadro "Total"): "Rendimentos de Aplicações" é receita
# financeira (juros de aplicação), "Reembolso de Despesas" é repasse de
# despesa do cliente, não faturamento da Proos. Decisão default (o Rodrigo
# não confirmou explicitamente — se discordar, é só tirar daqui). Todas as
# OUTRAS categorias encontradas no recon (títulos sem categoria, "RPA
# Excedentes", "Execução Unica", "Presto Excedentes", "Desenvolvimento",
# "Outras Receitas") CONTINUAM entrando no quadro "Total" — só não caem em
# nenhum dos 2 quadros de categoria específica.
CATEGORIAS_NAO_OPERACIONAIS = {"Rendimentos de Aplicações", "Reembolso de Despesas"}

_MESES_PT = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago",
             "Set", "Out", "Nov", "Dez"]


def status_contrato(cod_sit: Any) -> str:
    cod = str(cod_sit) if cod_sit is not None else ""
    return STATUS_CONTRATO_MAP.get(cod, f"Desconhecido (cCodSit={cod!r})")


def _parse_br_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%d/%m/%Y").date()
    except ValueError:
        return None


def _mes_ano(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _rotulo_mes(periodo: str) -> str:
    ano, mes = periodo.split("-")
    return f"{_MESES_PT[int(mes)]}/{ano}"


def _periodos_entre(desde: str, ate: str) -> list[str]:
    """Lista de 'AAAA-MM' entre --desde e --ate (inclusive), construída
    dinamicamente (NÃO um dicionário fixo tipo period_labels_map da skill
    original) — evita a classe de bug "valor estático que fica desatualizado
    quando o mês vira" já documentada várias vezes neste projeto."""
    d = _parse_br_date(desde)
    a = _parse_br_date(ate)
    if d is None or a is None:
        raise ValueError("--desde/--ate precisam estar em dd/mm/aaaa")
    periodos = []
    ano, mes = d.year, d.month
    while (ano, mes) <= (a.year, a.month):
        periodos.append(f"{ano:04d}-{mes:02d}")
        if mes == 12:
            ano, mes = ano + 1, 1
        else:
            mes += 1
    return periodos


# --- Coleta ------------------------------------------------------------


async def coletar_contratos(client: OmieClient) -> list[dict[str, Any]]:
    """TODOS os contratos, sem filtro de status (diferente de
    oystr_diagnostico.py, que só pega cCodSit='10' pra projeção)."""
    return await tools_servicos.listar_contratos_servico(client)


async def coletar_titulos_receita(
    client: OmieClient, desde_br: str, ate_br: str
) -> list[dict[str, Any]]:
    """Todos os títulos de Contas a Receber com Emissão no período pedido
    (TODOS os status — aberto e liquidado — porque MRR é sobre receita
    FATURADA, não sobre dinheiro já recebido).

    CONFIRMADO contra dado real em 2026-08-20 (recon): 4.002 títulos
    encontrados pra Emissão 01/01/2026-20/08/2026, com emissão mínima/
    máxima realmente dentro da janela pedida — o filtro
    `filtrar_por_emissao_de/ate` funciona como esperado."""
    return await tools_contas_receber.listar_contas_receber(
        client,
        filtros={
            "filtrar_por_emissao_de": desde_br,
            "filtrar_por_emissao_ate": ate_br,
        },
    )


def _proximo_mes(ano: int, mes: int) -> tuple[int, int]:
    return (ano + 1, 1) if mes == 12 else (ano, mes + 1)


def _fim_de_mes(ano: int, mes: int) -> date:
    import calendar
    return date(ano, mes, calendar.monthrange(ano, mes)[1])


def _sem_entities_html(texto: str | None) -> str | None:
    """Mesma correção já usada em oystr_diagnostico.py (achado real:
    cliente "NELSON WILIANS & ADVOGADOS ASSOCIADOS" gravado como
    "...&amp;..." no cadastro do Omie)."""
    if texto is None:
        return None
    return html.unescape(str(texto))


def _normalizar_doc(doc: str | None) -> str:
    """CNPJ/CPF só com dígitos, pra comparar sem depender de pontuação."""
    return re.sub(r"\D", "", doc or "")


async def coletar_projecao_contratos_mensais(
    client: OmieClient, meses_futuros: int
) -> list[dict[str, Any]]:
    """"O que será faturado" (competência) nos próximos `meses_futuros`
    meses (mês atual + N seguintes) — reaproveita 1:1 a mesma fonte que já
    alimenta "Base - Contratos Nao Faturados" no Diagnóstico:
    `tools/extrato.py::buscar_previsoes()`, que lê `financas/extrato`/
    `ListarExtrato` e separa os movimentos com
    `cOrigem="Previsão de Contratos Mensais"` — a projeção NATIVA do Omie
    pra contrato de serviço recorrente ainda não faturado, com a DATA DE
    COMPETÊNCIA já ajustada pra dia útil (não é a mesma coisa que
    vencimento — ver docstring do módulo). Só contratos MENSAIS/ativos
    aparecem aqui (o próprio Omie já filtra), sem risco de contar 2x um
    mês que já tem título emitido (esse mês nem aparece na previsão)."""
    contas_validas = await tools_contas_correntes.contas_fluxo_de_caixa(
        client, excluir=_EXCLUIR_CONTAS_NAO_CAIXA
    )
    hoje = datetime.now().date()
    meses_projecao = [(hoje.year, hoje.month)]
    for _ in range(meses_futuros):
        meses_projecao.append(_proximo_mes(*meses_projecao[-1]))
    ultimo_ano, ultimo_mes = meses_projecao[-1]
    data_ini_prev = hoje.strftime("%d/%m/%Y")
    data_fim_prev = _fim_de_mes(ultimo_ano, ultimo_mes).strftime("%d/%m/%Y")

    previsao = await tools_extrato.buscar_previsoes(
        client, sorted(contas_validas), data_ini_prev, data_fim_prev
    )
    return previsao["contratos_mensais"]


# Achado real no recon de 2026-08-20: a projeção nativa do Omie
# ("Previsão de Contratos Mensais") às vezes traz `cDesCategoria` num
# formato COMPOSTO — ex. "RPA Recorrente (24,999887%); Presto Recorrente
# (75,000113%)" — quando o contrato tem serviço dividido entre 2
# categorias por percentual (778 movimentos no recon, 19 compostos, ~2,4%).
# Sem tratar isso, esses 19 caem só no quadro "Total" e ficam de fora dos
# quadros RPA/Presto Recorrente, subestimando o MRR projetado. Números
# tinham vírgula decimal (formato BR) — normaliza pra ponto antes de
# converter pra float.
_PADRAO_CATEGORIA_COMPOSTA = re.compile(r"([^();]+?)\s*\(([\d.,]+)\s*%\)")


def _dividir_categoria_composta(categoria: str, valor: float) -> list[tuple[str, float]]:
    """Se `categoria` vier no formato 'Cat A (xx%); Cat B (yy%)', divide
    `valor` proporcionalmente entre as categorias (renormalizando pelos
    percentuais encontrados, caso não somem exatamente 100% por
    arredondamento). Caso contrário (formato normal, categoria única),
    devolve [(categoria, valor)] sem alteração — nunca perde nem
    duplica valor: a soma das partes sempre bate com `valor`."""
    matches = _PADRAO_CATEGORIA_COMPOSTA.findall(categoria)
    if len(matches) < 2:
        return [(categoria, valor)]
    partes = [(nome.strip(), float(pct.replace(",", "."))) for nome, pct in matches]
    soma_pct = sum(pct for _, pct in partes) or 1.0
    return [(nome, round(valor * pct / soma_pct, 2)) for nome, pct in partes]


def montar_linhas_projetadas(
    movimentos_contratos_mensais: list[dict[str, Any]],
    lookups: Lookups,
) -> list[dict[str, Any]]:
    """Converte os movimentos crus de "Previsão de Contratos Mensais" pro
    mesmo formato de linha usado pelo faturamento histórico
    (`montar_linhas_faturamento`), pra entrar no mesmo cálculo de KPIs.
    `cod_cli` vem de `nCodCliente` do movimento quando presente; se faltar,
    tenta casar por CNPJ/CPF normalizado contra o cadastro de clientes
    (fallback defensivo — não confirmado se é necessário, ver contagem
    impressa em --modo gerar)."""
    cnpj_para_cod: dict[str, int] = {}
    for cod, info in lookups.clientes.items():
        doc = _normalizar_doc(info.get("cnpj_cpf"))
        if doc:
            cnpj_para_cod[doc] = cod

    linhas = []
    sem_cod_cli = 0
    compostas = 0
    for mov in movimentos_contratos_mensais:
        data_prevista = _parse_br_date(mov.get("dDataLancamento"))
        if data_prevista is None:
            continue
        valor = round(float(mov.get("nValorDocumento") or 0), 2)
        if valor <= 0:
            continue
        categoria = mov.get("cDesCategoria") or ""
        cod_cli = mov.get("nCodCliente")
        if cod_cli is None:
            cod_cli = cnpj_para_cod.get(_normalizar_doc(mov.get("cDocCliente")))
        cliente = _sem_entities_html(mov.get("cRazCliente") or mov.get("cDesCliente")) or (
            lookups.nome_cliente(cod_cli) if cod_cli is not None else ""
        )
        if cod_cli is None:
            sem_cod_cli += 1
            # Fallback: usa o NOME como identidade (chave sintética, string em
            # vez de int) só pra não colapsar clientes DIFERENTES não
            # reconhecidos num único grupo "None" — imperfeito (nome não é
            # chave tão estável quanto código Omie, ver _sem_entities_html),
            # mas muito melhor que perder a distinção entre eles.
            cod_cli = f"nome:{cliente}" if cliente else None
        partes_categoria = _dividir_categoria_composta(categoria, valor)
        if len(partes_categoria) > 1:
            compostas += 1
        for categoria_parte, valor_parte in partes_categoria:
            if valor_parte <= 0:
                continue
            linhas.append({
                "cod_cli": cod_cli,
                "cliente": cliente,
                "categoria": categoria_parte,
                "contrato": mov.get("nCodLancamento") or "",
                "emissao": data_prevista,
                "periodo": _mes_ano(data_prevista),
                "valor": valor_parte,
                "realizado": False,
            })
    if sem_cod_cli:
        print(f"[aviso] {sem_cod_cli} linha(s) de projeção sem `nCodCliente` nem CNPJ "
              f"reconhecido — vão entrar sem `cod_cli` (contam pro valor total, mas não "
              f"pro cálculo de clientes distintos/novos/churn).")
    if compostas:
        print(f"{compostas} movimento(s) com categoria composta (contrato dividido entre "
              f"RPA/Presto Recorrente por percentual) — valor dividido proporcionalmente "
              f"entre as categorias, nada foi excluído.")
    return linhas


# --- Status de contrato por cliente ------------------------------------


def montar_status_por_cliente(
    contratos: list[dict[str, Any]]
) -> dict[int, dict[str, Any]]:
    por_cliente: dict[int, dict[str, Any]] = {}
    for c in contratos:
        cab = c.get("cabecalho", {}) or {}
        cod_cli = cab.get("nCodCli")
        if cod_cli is None:
            continue
        info = por_cliente.setdefault(cod_cli, {"contratos": [], "status_set": set()})
        status = status_contrato(cab.get("cCodSit"))
        info["contratos"].append({
            "nCodCtr": cab.get("nCodCtr"),
            "cCodSit": cab.get("cCodSit"),
            "status": status,
            "valor_mensal": cab.get("nValTotMes", 0),
            "vigencia_inicial": cab.get("dVigInicial"),
            "vigencia_final": cab.get("dVigFinal"),
        })
        info["status_set"].add(status)
    return por_cliente


def resumo_status_cliente(cod_cli: int | None, status_por_cliente: dict) -> str:
    if cod_cli is None:
        return "Sem contrato cadastrado (avulso/OS)"
    info = status_por_cliente.get(cod_cli)
    if not info:
        return "Sem contrato cadastrado (avulso/OS)"
    return " + ".join(sorted(info["status_set"]))


def validacao_churn(cod_cli: int | None, status_por_cliente: dict) -> str:
    """Pedido do Rodrigo (2026-08-26, achado com PASQUALI PARISE E GASPARINI
    JUNIOR ADVOGADOS): contrato Suspenso NÃO é a mesma coisa que Cancelado —
    "normalmente usamos [suspenso] pra aguardar alguma informação ou
    liberação para faturamento". Antes esse caso caía junto com Cancelado
    em "Churn confirmado" (só checava se tinha "Ativo" ou não); agora
    Suspenso ganha rótulo próprio, deixando claro que não é churn
    definitivo. Prioridade quando o cliente tem mais de um contrato com
    status diferentes: Ativo > Suspenso > Cancelado > Desconhecido (do
    mais otimista pro menos, já que qualquer contrato Ativo ou Suspenso
    já derruba a leitura de "perdido de vez")."""
    if cod_cli is None:
        return "Sem contrato recorrente cadastrado (provável OS avulsa/pontual)"
    info = status_por_cliente.get(cod_cli)
    if not info:
        return "Sem contrato recorrente cadastrado (provável OS avulsa/pontual)"
    status_set = info["status_set"]
    if "Ativo" in status_set:
        return "Churn NÃO confirmado — contrato segue Ativo, pode ser atraso/gap de faturamento (revisar)"
    if any(s.startswith("Suspenso") for s in status_set):
        return ("Contrato Suspenso — NÃO é churn definitivo (aguardando informação/liberação "
                "para faturamento, revisar)")
    if "Cancelado" in status_set:
        return "Churn confirmado por status de contrato (Cancelado)"
    return "Status de contrato desconhecido — revisar manualmente (cCodSit não mapeado)"


# --- Linhas de faturamento ----------------------------------------------


def montar_linhas_faturamento(
    titulos: list[dict[str, Any]], lookups: Lookups
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Retorna (linhas, estatisticas_exclusao) — estatisticas_exclusao
    documenta o que foi excluído por CATEGORIAS_NAO_OPERACIONAIS, pra nunca
    sumir número sem rastro (ver constante acima)."""
    linhas = []
    excluidos_qtd = 0
    excluidos_valor = 0.0
    for t in titulos:
        emissao = _parse_br_date(t.get("data_emissao"))
        if emissao is None:
            continue
        valor = float(t.get("valor_documento") or 0)
        if valor <= 0:
            continue
        categoria = lookups.categoria(t.get("codigo_categoria"))
        if categoria in CATEGORIAS_NAO_OPERACIONAIS:
            excluidos_qtd += 1
            excluidos_valor += valor
            continue
        cod_cli = t.get("codigo_cliente_fornecedor")
        linhas.append({
            "cod_cli": cod_cli,
            "cliente": lookups.nome_cliente(cod_cli),
            "categoria": categoria,
            "contrato": t.get("cNumeroContrato") or "",
            "emissao": emissao,
            "periodo": _mes_ano(emissao),
            "valor": valor,
            "realizado": True,
        })
    return linhas, {"titulos_excluidos": excluidos_qtd, "valor_excluido": excluidos_valor}


def dados_periodo(linhas: list[dict[str, Any]], categoria: str | None) -> dict[str, Any]:
    if categoria == QUADRO_RECORRENTE:
        rows = [l for l in linhas if l["categoria"] in CATEGORIAS_RECORRENTES]
    elif categoria and categoria != "Total":
        rows = [l for l in linhas if l["categoria"] == categoria]
    else:
        rows = linhas
    clientes = {l["cod_cli"] for l in rows}
    contratos = {l["contrato"] for l in rows if l["contrato"]}
    return {
        "contratos": len(contratos),
        "clientes": len(clientes),
        "valor_total": sum(l["valor"] for l in rows),
        "clientes_set": clientes,
    }


# --- Cálculo dos KPIs (mesmas regras da skill gerar-dashboard-mrr-oystr) -


def calcular_kpis(
    linhas: list[dict[str, Any]], periodos: list[str]
) -> tuple[dict, dict, dict, set[str]]:
    """Calcula os quadros de KPI por período/categoria e as transições de
    Novos Clientes / Churn entre períodos consecutivos.

    Também retorna `periodos_sem_faturamento_real` — períodos 100%
    projeção (nenhuma linha com `realizado=True` ainda). Pedido do Rodrigo
    (2026-08-26): "não tem como ter novos clientes em setembro, pois não
    teve faturamento ainda". Faz sentido: Novos Clientes/Churn descrevem um
    EVENTO já confirmado (um título que passou a existir ou deixou de
    existir); num período que é 100% forecast de contrato (nenhum título
    real emitido ainda), esse evento não é confirmável — o contrato pode
    até ser cancelado antes de chegar lá. Por isso essas células ficam '-'
    nesses períodos (mesmo tratamento já dado ao primeiro período da
    série, que também não tem "anterior" pra comparar). MRR/ARR/Qtde de
    Clientes/Ticket médio CONTINUAM calculados normalmente pra período
    100% projeção — como previsão de faturamento eles são úteis; só
    novos/churn (que implicam um evento de cliente já ocorrido) é que não.
    """
    por_periodo: dict[str, dict[str, Any]] = {}
    periodos_sem_faturamento_real: set[str] = set()
    for periodo in periodos:
        linhas_periodo = [l for l in linhas if l["periodo"] == periodo]
        por_periodo[periodo] = {
            cat: dados_periodo(linhas_periodo, None if cat == "Total" else cat)
            for cat in CATEGORIAS_RESUMO
        }
        if linhas_periodo and not any(l["realizado"] for l in linhas_periodo):
            periodos_sem_faturamento_real.add(periodo)

    novos_por_transicao: dict[str, dict[str, set | None]] = {}
    churn_por_transicao: dict[str, dict[str, set | None]] = {}
    for i in range(1, len(periodos)):
        anterior, atual = periodos[i - 1], periodos[i]
        chave = f"{anterior}->{atual}"
        novos_por_transicao[chave] = {}
        churn_por_transicao[chave] = {}
        for cat in CATEGORIAS_RESUMO:
            if atual in periodos_sem_faturamento_real:
                # Período de destino é 100% projeção — não dá pra
                # confirmar "cliente novo"/"churn" sem nenhum título real.
                novos_por_transicao[chave][cat] = None
                churn_por_transicao[chave][cat] = None
                continue
            anteriores = por_periodo[anterior][cat]["clientes_set"]
            atuais = por_periodo[atual][cat]["clientes_set"]
            novos_por_transicao[chave][cat] = atuais - anteriores
            churn_por_transicao[chave][cat] = anteriores - atuais

    return por_periodo, novos_por_transicao, churn_por_transicao, periodos_sem_faturamento_real


# --- Recon (só imprime, não escreve nada) --------------------------------


async def rodar_recon(client: OmieClient, desde: str, ate: str, meses_futuros: int = 2) -> None:
    print("=== RECON: contratos (servicos/contrato) ===")
    contratos = await coletar_contratos(client)
    print(f"{len(contratos)} contrato(s) no total (todos os status).")

    por_cod_sit: dict[str, list[dict]] = defaultdict(list)
    for c in contratos:
        cab = c.get("cabecalho", {}) or {}
        por_cod_sit[str(cab.get("cCodSit"))].append(cab)

    for cod_sit, lista in sorted(por_cod_sit.items()):
        exemplo = lista[0]
        rotulo = status_contrato(cod_sit)
        print(f"  cCodSit={cod_sit!r} -> {rotulo}: {len(lista)} contrato(s). "
              f"Exemplo: nCodCtr={exemplo.get('nCodCtr')!r} "
              f"nCodCli={exemplo.get('nCodCli')!r} "
              f"nValTotMes={exemplo.get('nValTotMes')!r} "
              f"dVigInicial={exemplo.get('dVigInicial')!r} "
              f"dVigFinal={exemplo.get('dVigFinal')!r}")
        if rotulo.startswith("Desconhecido"):
            print("    ^ ESTE CÓDIGO NÃO ESTÁ MAPEADO em STATUS_CONTRATO_MAP — "
                  "confirme o que ele significa antes de rodar --modo gerar "
                  "(senão esse contrato entra como 'Desconhecido', não conta "
                  "como Ativo nem como Cancelado/Suspenso pra validação de churn).")

    print(f"\n=== RECON: títulos de Contas a Receber (Emissão {desde} a {ate}) ===")
    titulos = await coletar_titulos_receita(client, desde, ate)
    print(f"{len(titulos)} título(s) encontrado(s) no período pedido.")
    if titulos:
        emissoes = [t.get("data_emissao") for t in titulos if t.get("data_emissao")]
        if emissoes:
            print(f"  Emissão mais antiga encontrada: {min(emissoes, key=lambda s: _parse_br_date(s) or date.min)}")
            print(f"  Emissão mais recente encontrada: {max(emissoes, key=lambda s: _parse_br_date(s) or date.min)}")
        com_num_contrato = sum(1 for t in titulos if t.get("cNumeroContrato"))
        print(f"  {com_num_contrato} de {len(titulos)} título(s) "
              f"({100 * com_num_contrato / len(titulos):.1f}%) têm cNumeroContrato preenchido "
              f"(esperado ser baixo — ~4,4% em achado anterior deste projeto).")

        categorias = await client.call_paginated(
            "geral/categorias", "ListarCategorias", params={},
            records_key=["categoria_cadastro", "categorias"],
        )
        mapa_categoria = {c.get("codigo"): c.get("descricao") for c in categorias if c.get("codigo")}
        por_categoria: dict[str, int] = defaultdict(int)
        for t in titulos:
            cat = mapa_categoria.get(t.get("codigo_categoria"), t.get("codigo_categoria"))
            por_categoria[cat] += 1
        print("  Categorias encontradas nos títulos (contagem de títulos):")
        for cat, qtd in sorted(por_categoria.items(), key=lambda kv: -kv[1]):
            marcador = "" if cat in CATEGORIAS_QUADRO else "  <-- NÃO está em CATEGORIAS_QUADRO, cai só no quadro 'Total'"
            print(f"    {cat!r}: {qtd} título(s){marcador}")
    else:
        print("  Nenhum título encontrado — confira se --desde/--ate e o filtro de "
              "Emissão estão certos antes de seguir pro --modo gerar.")

    if meses_futuros > 0:
        print(f"\n=== RECON: projeção 'o que será faturado' (mês atual + {meses_futuros} seguinte(s)) ===")
        movimentos_projecao = await coletar_projecao_contratos_mensais(client, meses_futuros)
        print(f"{len(movimentos_projecao)} movimento(s) de 'Previsão de Contratos Mensais' encontrado(s).")
        if movimentos_projecao:
            sem_nome = sum(1 for m in movimentos_projecao if not (m.get("cRazCliente") or m.get("cDesCliente")))
            sem_cod_cliente = sum(1 for m in movimentos_projecao if m.get("nCodCliente") is None)
            por_categoria_proj: dict[str, int] = defaultdict(int)
            for m in movimentos_projecao:
                por_categoria_proj[m.get("cDesCategoria") or "(sem categoria)"] += 1
            print(f"  {sem_cod_cliente} de {len(movimentos_projecao)} movimento(s) SEM `nCodCliente` "
                  f"preenchido (o script tenta casar por CNPJ, com fallback pro nome — ver aviso "
                  f"no --modo gerar).")
            if sem_nome:
                print(f"  {sem_nome} movimento(s) SEM nome de cliente nenhum (nem cRazCliente nem "
                      f"cDesCliente) — caso raro, verificar se aparece.")
            print("  Categorias encontradas na projeção:")
            for cat, qtd in sorted(por_categoria_proj.items(), key=lambda kv: -kv[1]):
                if cat in CATEGORIAS_QUADRO:
                    marcador = ""
                elif len(_PADRAO_CATEGORIA_COMPOSTA.findall(cat)) >= 2:
                    marcador = "  <-- categoria composta (contrato dividido por %), valor será DIVIDIDO entre as categorias no --modo gerar"
                else:
                    marcador = "  <-- fora de RPA/Presto Recorrente, cai só no 'Total'"
                print(f"    {cat!r}: {qtd} movimento(s){marcador}")

    print("\nRecon concluído. Se os números acima fizerem sentido (e qualquer "
          "cCodSit 'Desconhecido' já tiver sido esclarecido), rode --modo gerar.")


# --- Escrita no Excel ------------------------------------------------------


CURRENCY_FMT = "#,##0.00"
PCT_FMT = "0.00%"
HEADER_FILL = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
NOVOS_HEADER_FILL = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
CHURN_HEADER_FILL = PatternFill(start_color="C00000", end_color="C00000", fill_type="solid")


def escrever_resumo_executivo(wb, periodos, por_periodo, novos_por_transicao, churn_por_transicao,
                               periodos_com_projecao=frozenset()):
    titulo = "MRR - Resumo Executivo"
    if titulo in wb.sheetnames:
        del wb[titulo]
    ws = wb.create_sheet(titulo)
    ws.column_dimensions["A"].width = 35
    for idx in range(len(periodos)):
        ws.column_dimensions[chr(66 + idx)].width = 18

    indicadores = [
        ("Qtde de Contratos (#) [informativo — ver nota no topo do script, subestima muito]", "contratos"),
        ("Qtde de Clientes (#)", "clientes"),
        ("Novos Clientes (#)", "novos_clientes"),
        ("Cancelamentos/Churn bruto (#)", "churn_clientes"),
        ("Churn Rate (%)", "churn_rate"),
        ("Ticket médio por Cliente (R$)", "ticket_medio"),
        ("MRR (R$)", "mrr"),
        ("ARR (R$) [= MRR do mês x 12, proxy]", "arr"),
        ("Crescimento MRR (%)", "crescimento"),
    ]

    ws["A1"] = ("Colunas marcadas '(proj.)' são projeção (contrato ativo, ainda sem título "
                "gerado) — as outras são faturamento já realizado (título já emitido, "
                "independente de ter sido recebido ou não). Em períodos 100% projeção (nenhum "
                "título real ainda) 'Novos Clientes'/'Cancelamentos-Churn'/'Churn Rate' ficam "
                "'-': esses indicadores dependem de um título já ter sido emitido pra "
                "confirmar o evento — MRR/ARR/Qtde de Clientes continuam normalmente, como "
                "previsão.")
    ws["A1"].font = Font(italic=True, size=9)

    row = 3
    for categoria in CATEGORIAS_RESUMO:
        ws[f"A{row}"] = categoria
        ws[f"A{row}"].font = Font(bold=True, size=11)
        row += 1

        ws[f"A{row}"] = "Indicadores"
        ws[f"A{row}"].font = Font(bold=True)
        ws[f"A{row}"].fill = HEADER_FILL
        for idx, periodo in enumerate(periodos):
            cell = ws[f"{chr(66 + idx)}{row}"]
            rotulo = _rotulo_mes(periodo)
            if periodo in periodos_com_projecao:
                rotulo += " (proj.)"
            cell.value = rotulo
            cell.font = Font(bold=True)
            cell.fill = HEADER_FILL
            cell.alignment = Alignment(horizontal="center")
        row += 1

        for nome, chave in indicadores:
            ws[f"A{row}"] = nome
            for idx, periodo in enumerate(periodos):
                cell = ws[f"{chr(66 + idx)}{row}"]
                anterior = periodos[idx - 1] if idx > 0 else None
                trans = f"{anterior}->{periodo}" if anterior else None

                if chave == "contratos":
                    cell.value = por_periodo[periodo][categoria]["contratos"]
                elif chave == "clientes":
                    cell.value = por_periodo[periodo][categoria]["clientes"]
                elif chave == "novos_clientes":
                    val = None if trans is None else novos_por_transicao[trans][categoria]
                    cell.value = "-" if val is None else len(val)
                elif chave == "churn_clientes":
                    val = None if trans is None else churn_por_transicao[trans][categoria]
                    cell.value = "-" if val is None else len(val)
                elif chave == "churn_rate":
                    val = None if trans is None else churn_por_transicao[trans][categoria]
                    if val is None:
                        cell.value = "-"
                    else:
                        churn_n = len(val)
                        clientes_ant = por_periodo[anterior][categoria]["clientes"]
                        if clientes_ant > 0:
                            cell.value = churn_n / clientes_ant
                            cell.number_format = PCT_FMT
                        else:
                            cell.value = "-"
                elif chave == "ticket_medio":
                    clientes = por_periodo[periodo][categoria]["clientes"]
                    valor_total = por_periodo[periodo][categoria]["valor_total"]
                    if clientes > 0:
                        cell.value = valor_total / clientes
                        cell.number_format = CURRENCY_FMT
                elif chave == "mrr":
                    cell.value = por_periodo[periodo][categoria]["valor_total"]
                    cell.number_format = CURRENCY_FMT
                elif chave == "arr":
                    cell.value = por_periodo[periodo][categoria]["valor_total"] * 12
                    cell.number_format = CURRENCY_FMT
                elif chave == "crescimento":
                    if trans is None:
                        cell.value = "-"
                    else:
                        mrr_ant = por_periodo[anterior][categoria]["valor_total"]
                        mrr_atual = por_periodo[periodo][categoria]["valor_total"]
                        if mrr_ant > 0:
                            cell.value = (mrr_atual - mrr_ant) / mrr_ant
                            cell.number_format = PCT_FMT
                        else:
                            cell.value = "-"
            row += 1
        row += 1


def escrever_novos_clientes(wb, periodos, linhas, novos_por_transicao):
    titulo = "MRR - Novos Clientes"
    if titulo in wb.sheetnames:
        del wb[titulo]
    ws = wb.create_sheet(titulo)
    ws["A1"] = ("Só clientes com faturamento em RPA Recorrente ou Presto Recorrente "
                "(pedido do Rodrigo 2026-08-20: 'MRR apenas para RPA Recorrente e Presto "
                "Recorrente, são as únicas duas categorias nesta empresa que são "
                "recorrência') — um cliente que só teve Execução Única/Desenvolvimento/etc. "
                "NÃO aparece aqui. Transições pra um período 100% projeção (nenhum título "
                "real ainda) também não aparecem — pedido do Rodrigo 2026-08-26: sem título "
                "emitido não dá pra confirmar 'cliente novo'.")
    ws["A1"].font = Font(italic=True, size=9)
    headers = ["Período", "Cliente", "Categoria", "MRR (R$)"]
    for idx, h in enumerate(headers, 1):
        cell = ws.cell(2, idx)
        cell.value = h
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = NOVOS_HEADER_FILL

    row = 3
    for i in range(1, len(periodos)):
        anterior, atual = periodos[i - 1], periodos[i]
        trans = f"{anterior}->{atual}"
        novos = novos_por_transicao[trans][QUADRO_RECORRENTE]
        if novos is None:
            continue
        linhas_atual = [l for l in linhas if l["periodo"] == atual and l["categoria"] in CATEGORIAS_RECORRENTES]
        vistos = set()
        for l in linhas_atual:
            if l["cod_cli"] not in novos or l["cod_cli"] in vistos:
                continue
            vistos.add(l["cod_cli"])
            linhas_cliente = [x for x in linhas_atual if x["cod_cli"] == l["cod_cli"]]
            categorias = sorted({x["categoria"] for x in linhas_cliente})
            ws.cell(row, 1).value = f"{_rotulo_mes(anterior)} -> {_rotulo_mes(atual)}"
            ws.cell(row, 2).value = l["cliente"]
            ws.cell(row, 3).value = ", ".join(categorias)
            cell_valor = ws.cell(row, 4)
            cell_valor.value = sum(x["valor"] for x in linhas_cliente)
            cell_valor.number_format = CURRENCY_FMT
            row += 1

    ws.column_dimensions["A"].width = 25
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 25
    ws.column_dimensions["D"].width = 18


def escrever_clientes_com_churn(wb, periodos, linhas, churn_por_transicao, status_por_cliente):
    titulo = "MRR - Clientes com Churn"
    if titulo in wb.sheetnames:
        del wb[titulo]
    ws = wb.create_sheet(titulo)
    ws["A1"] = ("Só clientes com faturamento em RPA Recorrente ou Presto Recorrente "
                "(mesma restrição de 'MRR - Novos Clientes', ver nota lá) — churn aqui "
                "significa parar de faturar em categoria RECORRENTE, não em qualquer "
                "categoria. Transições pra um período 100% projeção (nenhum título real "
                "ainda) também não aparecem — pedido do Rodrigo 2026-08-26: sem título "
                "emitido não dá pra confirmar 'churn'. Coluna de Validação: 'Suspenso' NÃO é "
                "churn definitivo — é usado normalmente pra aguardar alguma informação ou "
                "liberação para faturamento; só 'Cancelado' é tratado como churn confirmado.")
    ws["A1"].font = Font(italic=True, size=9)
    headers = ["Período de Churn", "Cliente", "Categoria", "Último MRR (R$)", "Validação (status de contrato)"]
    for idx, h in enumerate(headers, 1):
        cell = ws.cell(2, idx)
        cell.value = h
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = CHURN_HEADER_FILL

    row = 3
    for i in range(1, len(periodos)):
        anterior, atual = periodos[i - 1], periodos[i]
        trans = f"{anterior}->{atual}"
        churn = churn_por_transicao[trans][QUADRO_RECORRENTE]
        if churn is None:
            continue
        linhas_anterior = [l for l in linhas if l["periodo"] == anterior and l["categoria"] in CATEGORIAS_RECORRENTES]
        vistos = set()
        for l in linhas_anterior:
            if l["cod_cli"] not in churn or l["cod_cli"] in vistos:
                continue
            vistos.add(l["cod_cli"])
            linhas_cliente = [x for x in linhas_anterior if x["cod_cli"] == l["cod_cli"]]
            categorias = sorted({x["categoria"] for x in linhas_cliente})
            ws.cell(row, 1).value = f"{_rotulo_mes(anterior)} -> {_rotulo_mes(atual)}"
            ws.cell(row, 2).value = l["cliente"]
            ws.cell(row, 3).value = ", ".join(categorias)
            cell_valor = ws.cell(row, 4)
            cell_valor.value = sum(x["valor"] for x in linhas_cliente)
            cell_valor.number_format = CURRENCY_FMT
            ws.cell(row, 5).value = validacao_churn(l["cod_cli"], status_por_cliente)
            row += 1

    ws.column_dimensions["A"].width = 25
    ws.column_dimensions["B"].width = 40
    ws.column_dimensions["C"].width = 25
    ws.column_dimensions["D"].width = 18
    ws.column_dimensions["E"].width = 60


def escrever_status_contratos(wb, status_por_cliente, lookups: Lookups):
    titulo = "Base - Status Contratos"
    if titulo in wb.sheetnames:
        del wb[titulo]
    ws = wb.create_sheet(titulo)
    headers = ["Cliente", "nCodCli", "nCodCtr", "cCodSit (cru)", "Status mapeado",
               "Valor Mensal (R$)", "Vigência Início", "Vigência Fim"]
    for idx, h in enumerate(headers, 1):
        cell = ws.cell(1, idx)
        cell.value = h
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill(start_color="808080", end_color="808080", fill_type="solid")

    row = 2
    for cod_cli, info in sorted(status_por_cliente.items(), key=lambda kv: lookups.nome_cliente(kv[0])):
        for contrato in info["contratos"]:
            ws.cell(row, 1).value = lookups.nome_cliente(cod_cli)
            ws.cell(row, 2).value = cod_cli
            ws.cell(row, 3).value = contrato["nCodCtr"]
            ws.cell(row, 4).value = contrato["cCodSit"]
            ws.cell(row, 5).value = contrato["status"]
            cell_valor = ws.cell(row, 6)
            cell_valor.value = contrato["valor_mensal"]
            cell_valor.number_format = CURRENCY_FMT
            ws.cell(row, 7).value = contrato["vigencia_inicial"]
            ws.cell(row, 8).value = contrato["vigencia_final"]
            row += 1

    for col, width in zip("ABCDEFGH", (40, 12, 12, 14, 20, 18, 16, 16)):
        ws.column_dimensions[col].width = width


# --- main ------------------------------------------------------------------


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--cliente", default=None)
    parser.add_argument("--desde", default="01/01/2026", help="dd/mm/aaaa (Emissão)")
    parser.add_argument("--ate", default=None, help="dd/mm/aaaa (Emissão) — padrão: hoje")
    parser.add_argument("--modo", choices=["recon", "gerar"], default="recon")
    parser.add_argument("--arquivo", default=None,
                         help="caminho do Oystr_Diagnostico_Consolidado.xlsx (obrigatório com --modo gerar)")
    parser.add_argument("--saida", default=None,
                         help="caminho de saída (padrão: mesmo padrão de nome com timestamp "
                              "do refresh_oystr_diagnostico.py, na mesma pasta do --arquivo)")
    parser.add_argument("--meses-futuros", type=int, default=2,
                         help="quantos meses ALÉM do mês atual projetar como 'o que será "
                              "faturado' (contrato ativo, categoria recorrente, ainda sem "
                              "título gerado) — padrão 2 (mês atual + 2 seguintes, mesma "
                              "janela que 'Base - Contratos Nao Faturados' já usa). Use 0 "
                              "pra desligar a projeção e olhar só o histórico.")
    parser.add_argument("--banco", action="store_true",
                         help="além de (ou em vez de) escrever nas abas MRR do Excel, "
                              "grava `linhas` (histórico + projeção) e `status_por_cliente` "
                              "no banco Postgres apontado por DATABASE_URL (ver "
                              "omie_mcp/db.py e db/schema.sql). Só tem efeito com --modo "
                              "gerar (recon não calcula `linhas`). Nunca sobrescreve uma "
                              "rodada anterior. Requer `pip install \"psycopg[binary]\"` e "
                              "DATABASE_URL configurada; se faltar algum dos dois, o "
                              "script AVISA e continua — a saída em Excel não depende "
                              "disso.")
    args = parser.parse_args()

    ate = args.ate or datetime.now().strftime("%d/%m/%Y")

    try:
        registry = ClientesRegistry.load()
        slug = registry.resolver_slug(args.cliente)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"[config] {exc}")
        return 1

    print(f"Cliente: {slug} | Emissão de {args.desde} a {ate}")

    async with OmieClient(settings) as client:
        if args.modo == "recon":
            await rodar_recon(client, args.desde, ate, args.meses_futuros)
            return 0

        if not args.arquivo:
            print("[erro] --modo gerar precisa de --arquivo")
            return 1
        caminho_entrada = Path(args.arquivo)
        if not caminho_entrada.exists():
            print(f"[erro] arquivo não encontrado: {caminho_entrada}")
            return 1

        print("Carregando lookups (clientes/categorias)...")
        lookups = await carregar_lookups(client)

        print("Buscando contratos (todos os status)...")
        contratos = await coletar_contratos(client)
        status_por_cliente = montar_status_por_cliente(contratos)

        print(f"Buscando títulos de Contas a Receber (Emissão {args.desde} a {ate}, "
              f"faturado = histórico realizado, não importa se recebeu)...")
        titulos = await coletar_titulos_receita(client, args.desde, ate)
        linhas_historicas, stats_exclusao = montar_linhas_faturamento(titulos, lookups)
        print(f"{len(linhas_historicas)} linha(s) de faturamento histórico válidas "
              f"(valor > 0, emissão válida).")
        if stats_exclusao["titulos_excluidos"]:
            print(f"{stats_exclusao['titulos_excluidos']} título(s) excluído(s) por serem "
                  f"{sorted(CATEGORIAS_NAO_OPERACIONAIS)} (não é receita de serviço), somando "
                  f"R$ {stats_exclusao['valor_excluido']:,.2f} — fora de todos os quadros de MRR.")

        linhas_projetadas = []
        if args.meses_futuros > 0:
            print(f"Buscando projeção de 'o que será faturado' (mês atual + "
                  f"{args.meses_futuros} seguinte(s), competência — não vencimento)...")
            movimentos_projecao = await coletar_projecao_contratos_mensais(client, args.meses_futuros)
            linhas_projetadas = montar_linhas_projetadas(movimentos_projecao, lookups)
            print(f"{len(linhas_projetadas)} linha(s) de faturamento projetado (contrato "
                  f"ativo, ainda sem título gerado).")

    linhas = linhas_historicas + linhas_projetadas
    periodos_historico = _periodos_entre(args.desde, ate)
    periodos_projecao = sorted({l["periodo"] for l in linhas_projetadas})
    periodos = periodos_historico + [p for p in periodos_projecao if p not in periodos_historico]
    periodos_com_projecao = {l["periodo"] for l in linhas if not l["realizado"]}

    por_periodo, novos_por_transicao, churn_por_transicao, periodos_sem_faturamento_real = calcular_kpis(linhas, periodos)
    if periodos_sem_faturamento_real:
        print(f"Períodos 100% projeção (sem nenhum título real ainda, Novos Clientes/Churn "
              f"ficam '-' neles): {', '.join(sorted(periodos_sem_faturamento_real))}.")

    # --- Gravação opcional no banco (--banco) --------------------------------
    # Grava `linhas` (histórico + projeção, grão de faturamento) e
    # `status_por_cliente` (grão de contrato) EXATAMENTE como já foram
    # calculados acima pra alimentar o Excel — nenhuma lógica nova, ver
    # omie_mcp/db.py. Novos Clientes/Churn (por_periodo/novos_por_transicao/
    # churn_por_transicao) não são gravados aqui: são derivados de `linhas` +
    # `status_por_cliente` por diferença de conjunto entre períodos
    # consecutivos (calcular_kpis/validacao_churn) — recalculável a qualquer
    # momento a partir do que já foi gravado, sem precisar duplicar o
    # resultado já derivado no banco (ver nota em db/schema.sql sobre
    # v_mrr_por_periodo_categoria). Uma falha aqui nunca derruba a escrita
    # do Excel logo abaixo.
    if args.banco:
        try:
            from omie_mcp import db
            conn = db.conectar()
            db.garantir_schema(conn)
            rodada_id = db.nova_rodada(
                conn, empresa=slug, tipo="mrr",
                data_de=args.desde, data_ate=ate,
                parametros={"desde": args.desde, "ate": ate, "meses_futuros": args.meses_futuros},
            )
            try:
                n_fat = db.gravar_faturamento_linhas(conn, rodada_id, slug, linhas)
                n_status = db.gravar_contratos_status(conn, rodada_id, slug, status_por_cliente)
                db.concluir_rodada(conn, rodada_id, status="concluida")
                print(f"\n[banco] rodada {rodada_id} gravada: {n_fat} linha(s) em "
                      f"faturamento_linhas, {n_status} linha(s) em contratos_status.")
            except Exception as exc:  # noqa: BLE001 — nunca deixa isso derrubar o script
                db.concluir_rodada(conn, rodada_id, status="falhou", erro=str(exc))
                print(f"\n[banco][aviso] falha ao gravar rodada {rodada_id}: {exc}")
        except Exception as exc:  # noqa: BLE001 — psycopg ausente, DATABASE_URL ausente, etc.
            print(f"\n[banco][aviso] gravação em banco pulada (--banco foi pedido, mas "
                  f"falhou antes de gravar qualquer coisa): {exc}")

    wb = load_workbook(caminho_entrada)
    escrever_resumo_executivo(wb, periodos, por_periodo, novos_por_transicao, churn_por_transicao,
                               periodos_com_projecao)
    escrever_novos_clientes(wb, periodos, linhas, novos_por_transicao)
    escrever_clientes_com_churn(wb, periodos, linhas, churn_por_transicao, status_por_cliente)
    escrever_status_contratos(wb, status_por_cliente, lookups)

    if args.saida:
        caminho_saida = Path(args.saida)
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        caminho_saida = caminho_entrada.with_name(
            f"Oystr_Diagnostico_Consolidado_{timestamp}{caminho_entrada.suffix}"
        )
    wb.save(caminho_saida)
    print(f"\nSalvo em: {caminho_saida}")
    print("Abas novas: 'MRR - Resumo Executivo', 'MRR - Novos Clientes', "
          "'MRR - Clientes com Churn', 'Base - Status Contratos'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
