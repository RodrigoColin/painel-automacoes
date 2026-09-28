"""
Reconstrói a parte dinâmica da aba "Aging Recebiveis" — a lista de clientes
com saldo vencido (> 30 dias) — a partir dos dados reais de
"Base - Receber Aberto", em vez de uma lista de nomes digitada à mão.

Criado em 2026-08-13 depois de um bug real encontrado pelo Rodrigo: o
cliente "NELSON WILIANS & ADVOGADOS ASSOCIADOS" tinha título vencido em
"Base - Receber Aberto" mas não aparecia (nem zerado, nem com erro — só
ausente) na aba "Aging Recebiveis". Duas causas raiz, as duas corrigidas:

1. O nome do cliente em "Base - Receber Aberto" vinha do cadastro do Omie
   (`ListarClientes` -> `razao_social`/`nome_fantasia`) com entity HTML não
   decodificada (ex.: "NELSON WILIANS &amp; ADVOGADOS ASSOCIADOS" em vez de
   "... & ..."), então a fórmula SUMIFS/COUNTIFS que compara o nome digitado
   à mão na aba Aging (sem entity) contra o nome na base (com entity) nunca
   batia — 102 das 490 linhas de "Base - Receber Aberto" tinham esse
   problema. Fix na raiz: `_sem_entities_html()` em oystr_diagnostico.py.

2. A lista de clientes em "Aging Recebiveis" (Top 20 e "Todos os clientes")
   era texto DIGITADO À MÃO num momento passado — clientes que passaram a
   ter saldo vencido DEPOIS desse momento nunca apareceriam, nem que a
   fórmula estivesse perfeita. Este módulo resolve isso: a cada
   `--modo escrever`, a lista de nomes é recalculada em Python direto de
   `base_receber_aberto` (mesmos dados que alimentam "Base - Receber
   Aberto"), então nunca mais fica desatualizada.

As colunas de VALOR (Valor Vencido, Nº Títulos etc.) continuam sendo
fórmula viva (SUMIFS/COUNTIFS contra "Base - Receber Aberto", que por sua
vez usa TODAY() na coluna "Dias Atraso" — ver _FORMULA_DIAS_ATRASO em
refresh_oystr_diagnostico.py) — só o NOME de cada linha passou a ser
escrito automaticamente. Isso preserva o comportamento de "reabrir o
arquivo dias depois sem rodar o refresh e a categorização de atraso ainda
está atualizada", só que agora pra uma lista de clientes que também é
mantida correta a cada refresh.

O resumo por faixa de atraso (linhas 6-14, topo da aba) não muda de
estrutura — só o RANGE das fórmulas SUMIF/COUNTIF, que antes era fixo em
"$2:$598" (mesma classe de bug já corrigida em fluxo_diario_mensal.py: uma
base que cresce além da linha 598 faria a fórmula silenciosamente ignorar
título novo) e agora é calculado a cada rodada a partir do tamanho real de
"Base - Receber Aberto" + margem.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

_FAIXAS_ORDEM = [
    "0) A vencer", "1) 0-30 dias", "2) 31-60 dias",
    "3) 61-90 dias", "4) 91-180 dias", "5) +180 dias",
]


def _faixa(dias_atraso: int) -> str:
    if dias_atraso < 0:
        return "0) A vencer"
    if dias_atraso <= 30:
        return "1) 0-30 dias"
    if dias_atraso <= 60:
        return "2) 31-60 dias"
    if dias_atraso <= 90:
        return "3) 61-90 dias"
    if dias_atraso <= 180:
        return "4) 91-180 dias"
    return "5) +180 dias"


def _as_date(v: Any) -> date | None:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def _linha_base_max(base_receber_aberto: list[dict[str, Any]], margem: int = 500) -> int:
    """Última linha do range usado nas fórmulas SUMIF/COUNTIF contra
    'Base - Receber Aberto' — tamanho real da base + margem, em vez de um
    número fixo tipo 598 que quebra silenciosamente quando a base cresce
    além dele (mesma classe de bug já corrigida em fluxo_diario_mensal.py:
    ver docstring do módulo)."""
    return 1 + len(base_receber_aberto) + margem


def montar_aba_aging_recebiveis(
    wb, base_receber_aberto: list[dict[str, Any]], hoje: date | None = None,
) -> None:
    """Recalcula (em cima da aba já existente 'Aging Recebiveis', sem
    recriar do zero — preserva formatação/estilo) o range das fórmulas de
    resumo (linhas 6-14) e a lista de clientes com saldo vencido > 30 dias
    (Top 20 em A17+, todos em F17+), escrita dinamicamente a partir dos
    dados reais."""
    hoje = hoje or date.today()
    ws = wb["Aging Recebiveis"]
    ultima_linha_base = _linha_base_max(base_receber_aberto)

    # --- 1) Resumo por faixa (linhas 6-11) e TOTAL (12): só alarga o range ---
    padrao_range = re.compile(r"(\$[A-Z]+\$2):\$([A-Z]+)\$\d+\b")
    for row in ws.iter_rows(min_row=6, max_row=14):
        for cell in row:
            if isinstance(cell.value, str) and cell.value.startswith("="):
                cell.value = padrao_range.sub(
                    rf"\1:$\2${ultima_linha_base}", cell.value
                )

    # --- 2) Agrega por cliente (Python, direto dos dados reais) ---
    agregados: dict[tuple[str, str], dict[str, Any]] = {}
    for titulo in base_receber_aberto:
        vcto = _as_date(titulo.get("Vencimento"))
        if vcto is None:
            continue
        dias_atraso = (hoje - vcto).days
        if _faixa(dias_atraso) not in ("2) 31-60 dias", "3) 61-90 dias",
                                        "4) 91-180 dias", "5) +180 dias"):
            continue  # só vencido > 30 dias interessa pra essa lista
        nome = titulo.get("Razão Social") or ""
        cnpj = titulo.get("CNPJ/CPF") or ""
        valor = float(titulo.get("Valor da Conta") or 0) - float(titulo.get("Recebido") or 0)
        chave = (nome, cnpj)
        ag = agregados.setdefault(chave, {
            "nome": nome, "total_valor": 0.0, "total_qtd": 0,
            "ano_atual_valor": 0.0, "ano_atual_qtd": 0,
        })
        ag["total_valor"] += valor
        ag["total_qtd"] += 1
        if vcto.year == hoje.year:
            ag["ano_atual_valor"] += valor
            ag["ano_atual_qtd"] += 1

    # "Top 20 clientes com maior saldo vencido" (A17+) -- ranking histórico,
    # continua por total_valor (vencido>30 em qualquer ano).
    top20 = sorted(agregados.values(), key=lambda a: a["total_valor"], reverse=True)[:20]

    # "Todos os clientes com saldo vencido (> 30 dias) em <ano>" (F17+) --
    # pedido do Rodrigo (2026-08-14): ordenar por "Vencido <ano> (R$)"
    # (ano_atual_valor, coluna G), não pelo total histórico, e mostrar só
    # quem realmente tem saldo vencido NESSE ano (ano_atual_valor > 0) --
    # antes a lista incluía cliente com total_valor>0 mas ano_atual_valor
    # zerado (vencido só em ano anterior), aparecendo com "Vencido <ano>"
    # zerado na tabela, o que não fazia sentido pro filtro do ano.
    todos = sorted(
        (a for a in agregados.values() if a["ano_atual_valor"] > 0),
        key=lambda a: a["ano_atual_valor"], reverse=True,
    )

    # --- 3) Limpa sobra de linhas antigas (listas antigas podem ser maiores
    # que a nova) antes de escrever, mesmo padrão de _limpar_e_escrever em
    # refresh_oystr_diagnostico.py ---
    linha_final_antiga = ws.max_row
    linha_final_nova = 16 + max(len(top20), len(todos))
    if linha_final_antiga > linha_final_nova:
        for row in range(17, linha_final_antiga + 1):
            for col in range(1, 11):  # A..J
                ws.cell(row=row, column=col).value = None

    # --- 4) Escreve "Top 20 clientes com maior saldo vencido" (A17+) ---
    for i, ag in enumerate(top20):
        r = 17 + i
        ws.cell(row=r, column=1, value=ag["nome"])  # A: Cliente
        ws.cell(row=r, column=2, value=(
            f"=SUMIFS('Base - Receber Aberto'!$J$2:$J${ultima_linha_base},"
            f"'Base - Receber Aberto'!$A$2:$A${ultima_linha_base},A{r},"
            f"'Base - Receber Aberto'!$K$2:$K${ultima_linha_base},\">30\")"
        ))
        ws.cell(row=r, column=3, value=(
            f"=COUNTIFS('Base - Receber Aberto'!$A$2:$A${ultima_linha_base},A{r},"
            f"'Base - Receber Aberto'!$K$2:$K${ultima_linha_base},\">30\")"
        ))

    # --- 5) Escreve "Todos os clientes com saldo vencido (> 30 dias) em <ano>" (F17+) ---
    ws["F15"] = f"Todos os clientes com saldo vencido (> 30 dias) em {hoje.year}"
    ws["G16"] = f"Vencido {hoje.year} (R$)"
    ws["H16"] = f"Qtde Vencidos {hoje.year}"
    for i, ag in enumerate(todos):
        r = 17 + i
        ws.cell(row=r, column=6, value=ag["nome"])  # F: Cliente
        ws.cell(row=r, column=7, value=(
            f"=SUMIFS('Base - Receber Aberto'!$J$2:$J${ultima_linha_base},"
            f"'Base - Receber Aberto'!$A$2:$A${ultima_linha_base},F{r},"
            f"'Base - Receber Aberto'!$K$2:$K${ultima_linha_base},\">30\","
            f"'Base - Receber Aberto'!$D$2:$D${ultima_linha_base},\">=\"&DATE({hoje.year},1,1),"
            f"'Base - Receber Aberto'!$D$2:$D${ultima_linha_base},\"<\"&DATE({hoje.year + 1},1,1))"
        ))
        ws.cell(row=r, column=8, value=(
            f"=COUNTIFS('Base - Receber Aberto'!$A$2:$A${ultima_linha_base},F{r},"
            f"'Base - Receber Aberto'!$K$2:$K${ultima_linha_base},\">30\","
            f"'Base - Receber Aberto'!$D$2:$D${ultima_linha_base},\">=\"&DATE({hoje.year},1,1),"
            f"'Base - Receber Aberto'!$D$2:$D${ultima_linha_base},\"<\"&DATE({hoje.year + 1},1,1))"
        ))
        ws.cell(row=r, column=9, value=(
            f"=SUMIFS('Base - Receber Aberto'!$J$2:$J${ultima_linha_base},"
            f"'Base - Receber Aberto'!$A$2:$A${ultima_linha_base},F{r},"
            f"'Base - Receber Aberto'!$K$2:$K${ultima_linha_base},\">30\")"
        ))
        ws.cell(row=r, column=10, value=(
            f"=COUNTIFS('Base - Receber Aberto'!$A$2:$A${ultima_linha_base},F{r},"
            f"'Base - Receber Aberto'!$K$2:$K${ultima_linha_base},\">30\")"
        ))
