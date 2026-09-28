"""
Gera/reconstrói a aba "Fluxo Diario <Mes>-<Ano>" do Oystr_Diagnostico_Consolidado.xlsx
como fórmula 100% viva (SUMIFS direto nas abas "Base -"), e cria automaticamente a
aba do mês seguinte a partir do dia 20 do mês corrente — pedido do Rodrigo em
2026-08-07, pra planilha nunca mais ficar dependendo de colar relatório manual do
Omie (foi assim que "Fluxo Diario Ago-2026" tinha ficado desatualizado e destoando
do fluxo_caixa.py: era um snapshot congelado de 05/08, não uma fórmula viva).

Reconstrução de 2026-08-07 (Ago-2026) trocou dois pontos em relação ao desenho
anterior (visto em "Fluxo Diario Jul-2026", que tinha ficado um mosaico de dias
com fórmula + dias colados à mão em correções pontuais no meio do mês):
  - Sem coluna "Saldo Acumulado (relativo)" (Rodrigo pediu pra tirar — não fazia
    sentido e ninguém usava; "Saldo Real Acumulado", coluna G, é o que importa).
  - SUMIFS por coluna inteira (ex.: 'Base - Recebimentos'!$D:$D) em vez de range
    fixo (ex.: $D$2:$D$8497) — o range fixo de "Base - Pagar Aberto" usado nas
    abas antigas ($J$2:$J$1091) cobria só ~45% das ~2400 linhas atuais dessa
    base, subestimando saídas previstas. Coluna inteira nunca mais precisa ser
    reajustada conforme a base cresce.

IMPORTANTE — o que este módulo NÃO mexe:
  - "Projecao Mensal Ago-Dez26" (cenários Base/Conservador/Ação de Cobrança) é
    um modelo de planejamento com premissas editáveis à mão — não é tocado
    automaticamente. Quando um mês novo passa a ter dado real, normalmente
    alguém ajusta manualmente a célula "Saldo Acumulado REAL" daquele mês pra
    apontar pra aba "Fluxo Diario <Mes>" ao vivo (foi feito assim pra Ago/26 em
    05/08) — decisão de negócio, não automatizada aqui de propósito.
"""

from __future__ import annotations

import calendar
import copy
from datetime import date

MESES_PT = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
            "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
MESES_ABREV = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
               "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

# Linha, em "Fluxo Mensal Historico", de cada mês já reservado nessa planilha
# (layout atual do Oystr_Diagnostico_Consolidado.xlsx, 2026-08-07). Precisa
# crescer manualmente se a aba "Fluxo Mensal Historico" ganhar mais linhas
# pra 2027 em diante.
_LINHA_HISTORICO = {
    (2026, 7): 23, (2026, 8): 24, (2026, 9): 25, (2026, 10): 26,
    (2026, 11): 27, (2026, 12): 28,
}


def nome_aba_mensal(ano: int, mes: int) -> str:
    return f"Fluxo Diario {MESES_ABREV[mes]}-{ano}"


def _mes_anterior(ano: int, mes: int) -> tuple[int, int]:
    return (ano - 1, 12) if mes == 1 else (ano, mes - 1)


def _mes_seguinte(ano: int, mes: int) -> tuple[int, int]:
    return (ano + 1, 1) if mes == 12 else (ano, mes + 1)


def criar_aba_fluxo_diario(wb, ano: int, mes: int, limite_conta_garantida: float, index: int | None = None):
    """Cria (ou recria do zero) a aba 'Fluxo Diario <Mes>-<Ano>' 100% fórmula,
    lendo direto das abas Base -. calendar.monthrange cobre 28/29/30/31 dias
    automaticamente. Retorna (worksheet, última_linha_de_dia)."""
    nome = nome_aba_mensal(ano, mes)
    if nome in wb.sheetnames:
        del wb[nome]
    ws = wb.create_sheet(nome, index=index)

    dias_no_mes = calendar.monthrange(ano, mes)[1]
    ultima_linha = 5 + dias_no_mes  # linha 6 = dia 1

    ano_ant, mes_ant = _mes_anterior(ano, mes)
    nome_ant = nome_aba_mensal(ano_ant, mes_ant)
    ultima_linha_ant = 5 + calendar.monthrange(ano_ant, mes_ant)[1]
    tem_mes_anterior = nome_ant in wb.sheetnames

    template = wb["Fluxo Diario Jul-2026"] if "Fluxo Diario Jul-2026" in wb.sheetnames else None

    def aplicar_estilo(cell, origem_coord):
        if template is None:
            return
        origem = template[origem_coord]
        cell.font = copy.copy(origem.font)
        cell.fill = copy.copy(origem.fill)
        cell.border = copy.copy(origem.border)
        cell.number_format = origem.number_format
        cell.alignment = copy.copy(origem.alignment)

    ws["A1"] = (f"Fluxo de Caixa Diário — {MESES_PT[mes]}/{str(ano)[2:]} "
                f"(Real + Previsto, fonte: rotina automática — 100% fórmula viva)")
    ws["G1"] = "Dia de corte (dados reais até):"
    # BUG REAL encontrado e CORRIGIDO (2026-08-26, achado do Rodrigo: "Saldo
    # Acumulado" de "Fluxo Diario Set-2026" fixo em R$378.303 em todos os
    # dias). A fórmula original só distinguia 2 casos: mês CORRENTE (corte =
    # dia de hoje) e "qualquer outro mês" (corte = último dia do mês). Isso
    # está certo pra mês PASSADO/fechado (tudo já realizado de verdade, faz
    # sentido confiar só no realizado o mês inteiro) — mas é o oposto do
    # certo pra mês FUTURO ainda não começado (ex.: "Fluxo Diario Set-2026",
    # criado com antecedência pela rotina do dia 20): nesse caso NADA foi
    # realizado ainda, então corte deveria ser 0 (usa E = previsto+realizado
    # em TODOS os dias), não o último dia do mês (que fazia quase o mês
    # inteiro cair na coluna F = só realizado, que fica vazia/zerada por não
    # ter nenhum recebimento/pagamento de verdade ainda — daí o saldo
    # acumulado empacado no valor de abertura, sem nunca variar dia a dia).
    # Fix: 3º ramo — se o dia 1 do mês é DEPOIS de hoje (mês futuro, ainda
    # não começou), corte = 0. Autocorrige sozinho quando o mês vira
    # "corrente" (atualizar_mes_atual reconstrói a aba do zero todo refresh).
    ws["H1"] = (
        f"=IF(AND(YEAR(TODAY())={ano},MONTH(TODAY())={mes}),DAY(TODAY()),"
        f"IF(DATE({ano},{mes},1)>TODAY(),0,"
        f"DAY(EOMONTH(DATE({ano},{mes},1),0))))"
    )
    ws["A2"] = (
        "Aba 100% fórmula (reconstruída/gerada automaticamente). Puxa direto de "
        "'Base - Recebimentos'/'Base - Pagamentos' (realizado, campo Data de "
        "Crédito/Débito) e 'Base - Receber Aberto'/'Base - Pagar Aberto' (previsto, "
        "pelo campo Previsão do Omie, não Vencimento — Rodrigo confirmou em 2026-08-08 "
        "que fluxo de caixa deve usar Previsão) — mesma lógica do fluxo_caixa.py: antes "
        "do dia de corte só realizado, do dia de corte em diante realizado do dia + previsto."
    )
    ws["J1"] = "Saldo de abertura (fecha mês anterior) (R$):"
    ws["K1"] = f"='{nome_ant}'!$G${ultima_linha_ant}" if tem_mes_anterior else 0
    if not tem_mes_anterior:
        ws["A3"] = ("ATENÇÃO: aba do mês anterior não encontrada — saldo de abertura "
                     "ficou zerado, preencher manualmente em K1 se necessário.")
    ws["J3"] = "Limite de conta garantida disponível (R$):"
    ws["K3"] = limite_conta_garantida

    headers = ["Dia", "Tipo", "Entrada (R$)", "Saída (R$)", "Saldo do Dia (R$)",
               "Saldo do Dia (Realizado) (R$)", "Saldo Real Acumulado (R$)", "Margem até o limite (R$)"]
    for col, valor in enumerate(headers, start=1):
        cell = ws.cell(row=5, column=col)
        if valor is not None:
            cell.value = valor
        aplicar_estilo(cell, "A5" if col != 3 else "C5")
    ws.column_dimensions["F"].hidden = True  # coluna auxiliar (ver F{r} abaixo), não é
    # mais "Saldo Acumulado (relativo)" (removida a pedido do Rodrigo em 2026-08-07) —
    # reaproveitada em 2026-08-13 (fix do saldo acumulado, ver comentário no loop abaixo).

    for i in range(1, dias_no_mes + 1):
        r = 5 + i
        ws.cell(row=r, column=1, value=i)
        ws.cell(row=r, column=2, value=f'=IF($A{r}<$H$1,"Realizado",IF($A{r}=$H$1,"Hoje","Previsto"))')
        # A parte "previsto" (títulos em aberto) bucketiza pelo campo Previsão
        # do Omie ('Base - Receber Aberto'!$M:$M / 'Base - Pagar Aberto'!$L:$L),
        # NÃO por Vencimento ($D:$D) — confirmado por Rodrigo em 2026-08-08:
        # pra fluxo de caixa, Previsão é o campo certo (é a data que o Omie usa
        # de fato pra projetar quando o dinheiro deve entrar/sair, podendo já
        # vir ajustada — ex. pulando fim de semana — diferente do Vencimento
        # cru do título). Antes desse fix, bucketizar por Vencimento explicava
        # parte da divergência dia a dia contra fluxo_caixa.py (que projeta a
        # partir do extrato bancário, já ajustado) nos dias 15-17/08 e o caso
        # do título do Facebook Ads (venc. 11/08) — ver claude/proos-omie-mcp.md.
        # Terceiro termo (contratos recorrentes ainda não faturados) só
        # entra no lado PREVISTO — essa receita nunca "realiza" nesta aba:
        # quando o título de verdade é gerado, o contrato sai da lista no
        # próximo refresh (passa a estar em Base - Receber Aberto/
        # Recebimentos) e some daqui, sem dupla contagem. Ver "Receita
        # recorrente ainda não faturada" no docstring de oystr_diagnostico.py.
        #
        # BUG REAL encontrado e CORRIGIDO (2026-08-13): as fórmulas de C/D
        # tinham um IF que só somava "Aberto"/"Contratos Nao Faturados" a
        # PARTIR do dia de corte ($H$1 = hoje) — dias ANTES de hoje somavam
        # só Recebimentos/Pagamentos, assumindo que tudo que devia
        # acontecer num dia passado já tinha sido baixado de verdade. Isso
        # é falso pra título vencido e ainda não pago (inadimplência) — o
        # relatório nativo do Omie ("Fluxo de Caixa por Categoria Diário")
        # continua mostrando esse valor como PREVISTO no dia original,
        # mesmo com o dia já no passado, até o título ser efetivamente
        # baixado. Achado comparando um pivot fresco do Omie (13/08/2026)
        # contra esta aba: dias 5, 10, 11 e 12 (todos antes do corte=13)
        # divergiam por exatamente o valor de títulos em aberto com
        # Previsão nesses dias (ex.: dia 10, diff de R$6.715,54 — um
        # título vencido em 10/08 que ainda não tinha sido pago em
        # 13/08). Como um título só pode estar em UMA base por vez
        # (Aberto OU Recebimentos/Pagamentos — nunca as duas ao mesmo
        # tempo), somar as duas SEMPRE, pra QUALQUER dia (passado ou
        # futuro), nunca conta o mesmo título 2x — só reflete corretamente
        # que ele ainda está pendente. Fix: removido o IF condicionado ao
        # dia de corte — soma Recebimentos/Pagamentos + Aberto (+ Contratos
        # Nao Faturados + OS Nao Faturadas, só na Entrada) em TODO dia, sem
        # exceção. A coluna "Tipo" (Realizado/Hoje/Previsto) continua
        # mostrando o rótulo normalmente — só a SOMA que deixou de depender
        # dele.
        #
        # Quarto termo (2026-08-13, bug #7): "Base - OS Nao Faturadas" —
        # receita PONTUAL/avulsa (ex.: OS Adicional de Contrato) ainda não
        # faturada, categoria separada de "Contratos Nao Faturados" (que é
        # só a recorrência mensal do contrato em si) — ver
        # montar_os_nao_faturadas_via_extrato() em oystr_diagnostico.py.
        # Mesma lógica de nunca duplicar: quando o título de verdade é
        # gerado, a OS sai dessa lista no próximo refresh (passa a estar em
        # Base - Receber Aberto/Recebimentos) e some daqui.
        ws.cell(row=r, column=3, value=(
            f"=SUMIFS('Base - Recebimentos'!$I:$I,'Base - Recebimentos'!$D:$D,DATE({ano},{mes},$A{r}))"
            f"+SUMIFS('Base - Receber Aberto'!$J:$J,'Base - Receber Aberto'!$M:$M,DATE({ano},{mes},$A{r}))"
            f"+SUMIFS('Base - Contratos Nao Faturados'!$E:$E,"
            f"'Base - Contratos Nao Faturados'!$F:$F,DATE({ano},{mes},$A{r}))"
            f"+SUMIFS('Base - OS Nao Faturadas'!$E:$E,"
            f"'Base - OS Nao Faturadas'!$F:$F,DATE({ano},{mes},$A{r}))"
        ))
        ws.cell(row=r, column=4, value=(
            f"=SUMIFS('Base - Pagamentos'!$I:$I,'Base - Pagamentos'!$D:$D,DATE({ano},{mes},$A{r}))"
            f"+SUMIFS('Base - Pagar Aberto'!$J:$J,'Base - Pagar Aberto'!$L:$L,DATE({ano},{mes},$A{r}))"
        ))
        # D é positivo (magnitude da saída) — mesma convenção do resto da planilha
        # (ex.: 'Fluxo Mensal Historico', linhas 5-22, "Saídas Reais" também positivo).
        # BUG CORRIGIDO 2026-08-07: a versão anterior negava D na própria fórmula
        # ("-(SUMIFS(...))"), e como E usava "=C-D" (herdado do padrão do resto da
        # planilha, que espera D positivo), C-D com D já negativo virava C+|D| —
        # somava entrada e saída em vez de subtrair, inflando o saldo acumulado
        # (chegou a projetar R$1,68mi de saldo no fim de agosto; Rodrigo percebeu
        # comparando com o fluxo_caixa.py, que mostrava saldo NEGATIVO no período).
        ws.cell(row=r, column=5, value=f"=C{r}-D{r}")
        # Coluna F (2026-08-13, fix do saldo acumulado): mesma ideia de C/D, mas
        # SÓ com Recebimentos/Pagamentos (nada de Aberto/Contratos/OS) — ou seja,
        # só o que JÁ entrou/saiu de verdade no banco, batendo com "6. RESULTADO
        # ACUMULADO REALIZADO" do relatório nativo do Omie. Achado real (Rodrigo,
        # 2026-08-13): "Saldo Real Acumulado" (G) estava usando E (que, desde o
        # fix do bug #4 acima, inclui título vencido e ainda não pago no dia
        # ORIGINAL da previsão, mesmo já no passado) pra acumular o saldo de
        # caixa — contando como se o dinheiro já tivesse entrado, quando na
        # verdade ainda está em aberto (ex.: contrato de R$17.791,54 da PEREIRA
        # GIONEDIS, previsto pra 05/08, ainda não pago em 13/08). Confirmado
        # comparando contra a linha "6. RESULTADO ACUMULADO REALIZADO" de um
        # pivot Omie fresco (13/08/2026): dia 10 batia exato em R$104.149,19 só
        # usando o valor REALIZADO isolado, não o combinado. E continua correta
        # (bate 100% com "5.1. Resultado Previsto" do Omie) — só o acumulado (G)
        # muda de fonte conforme o dia.
        ws.cell(row=r, column=6, value=(
            f"=SUMIFS('Base - Recebimentos'!$I:$I,'Base - Recebimentos'!$D:$D,DATE({ano},{mes},$A{r}))"
            f"-SUMIFS('Base - Pagamentos'!$I:$I,'Base - Pagamentos'!$D:$D,DATE({ano},{mes},$A{r}))"
        ))
        # G: antes do dia de corte, acumula só o realizado (F) — do dia de corte
        # em diante (inclusive "Hoje"), acumula o combinado (E), como antes.
        delta = f"IF($A{r}<$H$1,F{r},E{r})"
        ws.cell(row=r, column=7, value=(f"={delta}+$K$1" if i == 1 else f"=G{r-1}+{delta}"))
        ws.cell(row=r, column=8, value=f"=G{r}+$K$3")
        for col, origem in [(1, "A6"), (2, "B6"), (3, "C6"), (4, "C6"), (5, "C6"), (6, "C6"), (7, "G6"), (8, "H6")]:
            aplicar_estilo(ws.cell(row=r, column=col), origem)

    ws[f"A{ultima_linha+2}"] = "Pior dia do mês (menor saldo REAL acumulado):"
    ws[f"B{ultima_linha+2}"] = f"=INDEX(A6:A{ultima_linha},MATCH(MIN(G6:G{ultima_linha}),G6:G{ultima_linha},0))"
    ws[f"A{ultima_linha+3}"] = "Saldo real no pior dia:"
    ws[f"B{ultima_linha+3}"] = f"=MIN(G6:G{ultima_linha})"
    ws[f"A{ultima_linha+4}"] = "Margem até o limite no pior dia:"
    ws[f"B{ultima_linha+4}"] = f"=MIN(G6:G{ultima_linha})+$K$3"

    for col_letter, width in {"A": 8.0, "B": 14.0, "C": 18.0, "G": 22.0,
                               "H": 20.0, "J": 30.0, "K": 12.0}.items():
        ws.column_dimensions[col_letter].width = width

    return ws, ultima_linha


def _atualizar_linha_historico(wb, ano: int, mes: int, ultima_linha: int) -> bool:
    """Se 'Fluxo Mensal Historico' já tem uma linha reservada pra esse mês
    (ver _LINHA_HISTORICO), troca a fórmula dessa linha pra puxar da aba
    'Fluxo Diario <Mes>' ao vivo, no mesmo padrão já usado pra Jul/Ago-26.
    Retorna True se atualizou, False se não havia linha reservada (nesse caso
    quem mantém a planilha precisa adicionar/ajustar essa aba manualmente)."""
    linha = _LINHA_HISTORICO.get((ano, mes))
    if linha is None or "Fluxo Mensal Historico" not in wb.sheetnames:
        return False
    ws = wb["Fluxo Mensal Historico"]
    nome = nome_aba_mensal(ano, mes)
    ws.cell(row=linha, column=2, value=f"=C{linha}")  # B: Faturado no Mês ~= Entradas
    ws.cell(row=linha, column=3, value=f"=SUM('{nome}'!$C$6:$C${ultima_linha})")
    ws.cell(row=linha, column=4, value=f"=SUM('{nome}'!$D$6:$D${ultima_linha})")
    ws.cell(row=linha, column=5, value=f"=C{linha}-D{linha}")
    ws.cell(row=linha, column=6, value=f"='{nome}'!$G${ultima_linha}")
    return True


def atualizar_mes_atual(wb, hoje: date | None = None) -> str:
    """Reconstrói do zero a aba 'Fluxo Diario <Mes atual>-<Ano>', toda vez
    que o refresh roda com --modo escrever — diferente de
    criar_proximo_mes_se_necessario (que só cria a aba do mês SEGUINTE, e só
    a partir do dia 20), esta função sempre recria a aba do mês CORRENTE.

    Por quê: como a aba é gerada por código (não editada à mão), qualquer
    mudança de fórmula em criar_aba_fluxo_diario (ex.: trocar de bucketizar
    por Vencimento pra Previsão, 2026-08-08) só se propaga pra aba do mês
    atual se ela for reconstruída — senão fica com a fórmula antiga
    "congelada" até o próximo rollover de mês. Idempotente e seguro rodar
    toda vez: preserva o limite de conta garantida (K3) e a posição da aba
    na planilha, se ela já existia.

    Retorna o nome da aba (sempre recria, nunca retorna None)."""
    hoje = hoje or date.today()
    nome_atual = nome_aba_mensal(hoje.year, hoje.month)

    limite = 61500  # default, caso a aba ainda não exista (primeira vez)
    idx = None
    if nome_atual in wb.sheetnames:
        ws_atual = wb[nome_atual]
        limite = ws_atual["K3"].value or limite
        idx = wb.sheetnames.index(nome_atual)  # mesma posição, após del+recriar

    _, ultima_linha = criar_aba_fluxo_diario(wb, hoje.year, hoje.month, limite, index=idx)
    _atualizar_linha_historico(wb, hoje.year, hoje.month, ultima_linha)
    return nome_atual


def criar_proximo_mes_se_necessario(wb, hoje: date | None = None, dia_gatilho: int = 20) -> str | None:
    """A partir do dia `dia_gatilho` do mês (padrão dia 20), garante que a
    aba 'Fluxo Diario <Mes seguinte>-<Ano>' já existe, criando-a (fórmula
    viva, ver criar_aba_fluxo_diario) se ainda não existir. Não faz nada
    antes do dia 20, nem se a aba do mês seguinte já existir (idempotente —
    seguro rodar toda vez que o refresh normal rodar).

    Retorna o nome da aba criada, ou None se não criou nada (ainda não é
    dia 20+, ou a aba já existia)."""
    hoje = hoje or date.today()
    if hoje.day < dia_gatilho:
        return None

    ano_prox, mes_prox = _mes_seguinte(hoje.year, hoje.month)
    nome_prox = nome_aba_mensal(ano_prox, mes_prox)
    if nome_prox in wb.sheetnames:
        return None

    nome_atual = nome_aba_mensal(hoje.year, hoje.month)
    limite = 61500  # default, caso a aba do mês atual não exista/não tenha K3
    idx = None
    if nome_atual in wb.sheetnames:
        ws_atual = wb[nome_atual]
        limite = ws_atual["K3"].value or limite
        idx = wb.sheetnames.index(nome_atual) + 1  # logo depois do mês atual

    _, ultima_linha = criar_aba_fluxo_diario(wb, ano_prox, mes_prox, limite, index=idx)
    _atualizar_linha_historico(wb, ano_prox, mes_prox, ultima_linha)
    return nome_prox
