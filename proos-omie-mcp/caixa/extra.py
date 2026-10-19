"""
Agregados da tela "Fluxo de caixa" (o antigo extra.json).

Portado de scripts/build_extra_dashboard_caixa.py — mesma conta, com o que era
fixo da Oystr trocado por dado da empresa:

  - ano corrente e anterior no lugar de 2026/2025;
  - saldo de abertura do histórico = saldo real do banco em 1º de janeiro do
    ano anterior (extrato["abertura"]), e não mais R$ 774.857,13 digitado;
  - meses fechados calculados pelas bases, salvo os que vierem em
    `historico_fixo` (a Oystr mantém o 2025 conferido contra o Omie);
  - categoria em branco vira "Sem categoria" (era "RPA Recorrente");
  - linhas de receita do gráfico de faturamento vêm de `linhas_receita`;
  - recebimento efetivo, padrão de entradas ao longo do mês e os cenários de
    estresse passam a ser medidos no histórico de cada empresa (eram números
    da Oystr fixos no template).
"""

from __future__ import annotations

import calendar
import re
from typing import Any

import pandas as pd

# Mesma regra de dividirCategoria()/splitCat() (frontend) e de
# categoria_titulo() (omie_mcp/reports/oystr_diagnostico.py): decompõe
# categoria composta por rateio, tipo "RPA Recorrente (56,73%); Presto
# Recorrente (43,57%)", em [(nome, fração), ...]. Sem percentual: [(texto, 1.0)].
_RE_CATEGORIA_SPLIT = re.compile(r"([^;()]+?)\s*\(([\d.,]+)%\)")


def _dividir_categoria(texto: str) -> list[tuple[str, float]]:
    ms = _RE_CATEGORIA_SPLIT.findall(str(texto))
    if not ms:
        return [(str(texto), 1.0)]
    return [(nome.strip(), float(pct.replace(",", ".")) / 100) for nome, pct in ms]


COLUNAS = {
    "recebimentos": ["Cliente", "Emissão", "Vencimento", "Data de Crédito ou Débito (No Extrato)",
                     "Categoria", "Documento", "Conta Corrente", "Valor da Conta", "Recebido"],
    "pagamentos": ["Fornecedor", "Emissão", "Vencimento", "Data de Crédito ou Débito (No Extrato)",
                   "Categoria", "Documento", "Conta Corrente", "Valor da Conta", "Valor Pago"],
    "receber_aberto": ["Razão Social", "CNPJ/CPF", "Emissão", "Vencimento", "Categoria", "Documento",
                       "Conta Corrente", "Valor da Conta", "Recebido", "Valor a Receber Real", "Previsão"],
    "pagar_aberto": ["Razão Social", "CNPJ/CPF", "Emissão", "Vencimento", "Categoria", "Documento",
                     "Conta Corrente", "Valor da Conta", "Valor Pago", "Previsão"],
    "contratos_nao_faturados": ["Razão Social", "Contrato", "Categoria", "Valor Mensal", "Data Prevista"],
    "os_nao_faturadas": ["Razão Social", "OS", "Categoria", "Valor", "Data Prevista"],
    "status_contratos": ["Cliente", "Status mapeado", "Valor Mensal (R$)"],
}

SEM_CATEGORIA_RECEITA = "Sem categoria"
SEM_CATEGORIA_DESPESA = "Administrativas (sem categoria)"


def _df(bases: dict[str, list[dict[str, Any]]], nome: str) -> pd.DataFrame:
    df = pd.DataFrame(bases.get(nome) or [])
    for coluna in COLUNAS[nome]:
        if coluna not in df.columns:
            df[coluna] = pd.Series(dtype="object")
    return df


def _num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce").fillna(0.0)


def _data(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, errors="coerce")


def _mes(s: pd.Series) -> pd.Series:
    return s.dt.to_period("M").astype(str)


def _r(v: float) -> float:
    return round(float(v), 2)


def _linha_receita(categoria: str, linhas: list[dict[str, Any]]) -> str:
    c = str(categoria).lower()
    for linha in linhas:
        if any(str(t).lower() in c for t in linha.get("termos") or [] if str(t).strip()):
            return linha["nome"]
    if not linhas and "recorrente" in c:
        return "Receita recorrente"
    return "Outras receitas"


def montar_extra(
    bases: dict[str, list[dict[str, Any]]],
    D: dict[str, Any],
    ref: str,
    *,
    historico_fixo: list[dict[str, Any]] | None = None,
    linhas_receita: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    REF = pd.Timestamp(ref)
    ANO = REF.year
    MES_CUR = REF.strftime("%Y-%m")
    INI_ANO = pd.Timestamp(f"{ANO}-01-01")
    INI_PROX = pd.Timestamp(f"{ANO + 1}-01-01")
    linhas_receita = linhas_receita or []

    # Previsto para HOJE vem direto do extrato (mesma granularidade da aba
    # Diário) — receber_aberto/pagar_aberto não concordam byte a byte com o
    # extrato sobre o que cai hoje (achado 28/09/2026).
    no_caixa = {c["codigo"] for c in D["contas"] if c["somaNoCaixa"]}
    MOVS_HOJE_RECEBER: dict[str, float] = {}
    MOVS_HOJE_PAGAR: dict[str, float] = {}
    for m in D.get("movimentos", []):
        if m["conta"] not in no_caixa or m["data"] != D["hoje"] or m["realizado"]:
            continue
        alvo = MOVS_HOJE_RECEBER if m["valor"] > 0 else MOVS_HOJE_PAGAR
        alvo[m["categoria"]] = alvo.get(m["categoria"], 0.0) + abs(m["valor"])

    rec, pag = _df(bases, "recebimentos"), _df(bases, "pagamentos")
    ra, pa = _df(bases, "receber_aberto"), _df(bases, "pagar_aberto")
    cnf, osn, sc = _df(bases, "contratos_nao_faturados"), _df(bases, "os_nao_faturadas"), _df(bases, "status_contratos")

    for df in (rec, pag):
        df["d"] = _data(df["Data de Crédito ou Débito (No Extrato)"])
        df["venc"] = _data(df["Vencimento"])
        df["em"] = _data(df["Emissão"])
    rec["v"] = _num(rec["Recebido"])
    pag["v"] = _num(pag["Valor Pago"])
    rec["Valor da Conta"] = _num(rec["Valor da Conta"])
    for df in (ra, pa):
        df["venc"] = _data(df["Vencimento"])
        df["em"] = _data(df["Emissão"])
        df["Valor da Conta"] = _num(df["Valor da Conta"])
    ra["A Receber"] = ra["Valor da Conta"] - _num(ra["Recebido"])
    pa["A Pagar"] = pa["Valor da Conta"] - _num(pa["Valor Pago"])
    # Saldo real a receber (líquido de retenção e já recebido parcial), só para
    # a inadimplência. Pacote antigo não tem a coluna → cai no "A Receber".
    _tem_a_receber_real = any("Valor a Receber Real" in r for r in (bases.get("receber_aberto") or []))
    ra["A Receber Real"] = _num(ra["Valor a Receber Real"]) if _tem_a_receber_real else ra["A Receber"]
    ra = ra[ra["A Receber"] > 0].copy()
    pa = pa[pa["A Pagar"] > 0].copy()
    # Contas a pagar: para o caixa vale a PREVISÃO de pagamento, não o vencimento.
    pa["prev"] = _data(pa["Previsão"]).fillna(pa["venc"])
    pa["venc_orig"] = pa["venc"]
    pa["venc"] = pa["prev"]
    ra["dias"] = (REF - ra["venc"]).dt.days
    pa["dias"] = (REF - pa["venc"]).dt.days
    # Recebíveis contam pela PREVISÃO de recebimento (corrige vencimento que cai
    # em fim de semana e renegociações), não pelo vencimento — decisão do usuário
    # 2026-10-19 (inadimplência) estendida ao fluxo de caixa em 2026-10-19 após
    # medir o impacto na Oystr. `ra["prev"]` vira a data do caixa e da
    # inadimplência; `ra["venc"]` original é preservado só para o faturamento por
    # linha de receita (que é por vencimento) e exibido como referência. Contas a
    # pagar já usam previsão no próprio "venc", logo acima.
    ra["prev"] = _data(ra["Previsão"]).fillna(ra["venc"])
    ra["venc_orig"] = ra["venc"]
    ra["dias_prev"] = (REF - ra["prev"]).dt.days
    cnf["dp"] = _data(cnf["Data Prevista"])
    osn["dp"] = _data(osn["Data Prevista"])
    cnf["Valor Mensal"] = _num(cnf["Valor Mensal"])
    osn["Valor"] = _num(osn["Valor"])
    # pacotes de antes do complemento de vigência vencida (bases.py) não têm essa coluna --
    # trata como "nenhuma complementar".
    if "Complementar" not in cnf.columns:
        cnf["Complementar"] = False
    cnf["Complementar"] = cnf["Complementar"].fillna(False)
    rec["m"], pag["m"] = _mes(rec["d"]), _mes(pag["d"])
    # ra["m"] = mês da PREVISÃO (não do vencimento): é o mês em que o recebível
    # projeta entrada no fluxo de caixa. pa["venc"] já é previsão (acima).
    ra["m"], pa["m"] = _mes(ra["prev"]), _mes(pa["venc"])
    cnf["m"], osn["m"] = _mes(cnf["dp"]), _mes(osn["dp"])
    rec["mem"], ra["mem"] = _mes(rec["em"]), _mes(ra["em"])

    # ---------- categoria em branco: a mais frequente do cliente ----------
    for df in (rec, pag, ra, pa, cnf, osn):
        df["Categoria"] = df["Categoria"].fillna("").astype(str).str.strip()
    hist_cat = pd.concat([
        rec[["Cliente", "Categoria"]].rename(columns={"Cliente": "n"}),
        ra[["Razão Social", "Categoria"]].rename(columns={"Razão Social": "n"}),
    ])
    hist_cat = hist_cat[hist_cat["Categoria"] != ""]
    moda = hist_cat.groupby("n")["Categoria"].agg(lambda s: s.value_counts().index[0]).to_dict() if len(hist_cat) else {}
    for df, col in ((rec, "Cliente"), (ra, "Razão Social")):
        vazio = df["Categoria"] == ""
        df.loc[vazio, "Categoria"] = df.loc[vazio, col].map(moda).fillna(SEM_CATEGORIA_RECEITA)
    for df in (pag, pa):
        df.loc[df["Categoria"] == "", "Categoria"] = SEM_CATEGORIA_DESPESA
    for df in (cnf, osn):
        df.loc[df["Categoria"] == "", "Categoria"] = SEM_CATEGORIA_RECEITA

    fat_em = pd.concat([rec[["mem", "Valor da Conta"]], ra[["mem", "Valor da Conta"]]]).groupby("mem")["Valor da Conta"].sum()
    ent_m = rec.groupby("m")["v"].sum()
    sai_m = pag.groupby("m")["v"].sum()
    dias = D["dias"]

    # categoria composta (rateio): título com Categoria tipo "RPA Recorrente (56,73%);
    # Presto Recorrente (43,57%)" (rateio entre categorias, ver categoria_titulo() em
    # omie_mcp/reports/oystr_diagnostico.py) virava uma categoria NOVA inteira no catmes
    # em vez de dividir o valor pelas categorias reais -- mesma regra de
    # dividirCategoria()/splitCat() (frontend), portada aqui. Achado real, Oystr,
    # 04/10/2026 (mesmo fix aplicado em build_extra_dashboard_caixa.py, pipeline antigo).
    def _somar_por_categoria(df: pd.DataFrame, col_valor: str) -> dict[str, float]:
        out: dict[str, float] = {}
        for cat, v in zip(df["Categoria"], df[col_valor]):
            for nome, frac in _dividir_categoria(cat):
                out[nome] = out.get(nome, 0.0) + float(v) * frac
        return out

    def _somar_por_categoria_cliente(df: pd.DataFrame, col_cliente: str, col_valor: str) -> dict[tuple[str, str], float]:
        out: dict[tuple[str, str], float] = {}
        for cat, cli, v in zip(df["Categoria"], df[col_cliente], df[col_valor]):
            for nome, frac in _dividir_categoria(cat):
                chave = (nome, cli)
                out[chave] = out.get(chave, 0.0) + float(v) * frac
        return out

    # ---------- catmes do ano corrente (categoria x mês) ----------
    catmes: dict[str, dict[str, float]] = {}
    meses_ano = [f"{ANO}-{i:02d}" for i in range(1, 13)]
    ref_iso = REF.strftime("%Y-%m-%d")
    for mes in meses_ano:
        c: dict[str, float] = {}

        def add(cat: str, v: float) -> None:
            c[cat] = c.get(cat, 0.0) + float(v)

        if mes <= MES_CUR:
            for cat, v in _somar_por_categoria(rec[rec["m"] == mes], "v").items():
                add(cat, v)
            for cat, v in _somar_por_categoria(pag[pag["m"] == mes], "v").items():
                add(cat, -v)
        if mes >= MES_CUR:
            for cat, v in _somar_por_categoria(ra[(ra["m"] == mes) & (ra["prev"] > REF)], "A Receber").items():
                add(cat, v)
            for cat, v in _somar_por_categoria(pa[(pa["m"] == mes) & (pa["venc"] > REF)], "A Pagar").items():
                add(cat, -v)
            for cat, v in _somar_por_categoria(cnf[(cnf["m"] == mes) & (cnf["dp"] > REF)], "Valor Mensal").items():
                add(cat, v)
            for cat, v in _somar_por_categoria(osn[(osn["m"] == mes) & (osn["dp"] > REF)], "Valor").items():
                add(cat, v)
            if mes == MES_CUR:
                for cat, v in MOVS_HOJE_RECEBER.items():
                    add(cat, v)
                for cat, v in MOVS_HOJE_PAGAR.items():
                    add(cat, -v)
        # Mês futuro coberto por inteiro pelo extrato diário: o total de saídas
        # segue o extrato (que inclui previsões nativas fora das bases de
        # títulos), mantendo a divisão por categoria.
        if mes > MES_CUR:
            dm_ = [d for d in dias if d["data"].startswith(mes)]
            ndias = calendar.monthrange(int(mes[:4]), int(mes[5:7]))[1]
            if len(dm_) == ndias:
                alvo = sum(d["saidas"] for d in dm_)
                tot = -sum(v for v in c.values() if v < 0)
                if tot > 0 and alvo > 0:
                    for k in list(c):
                        if c[k] < 0:
                            c[k] *= alvo / tot
        catmes[mes] = {k: _r(v) for k, v in c.items() if abs(v) > 0.005}

    # ---------- porCliente: mesmo recorte do catmes acima, mas com detalhe por
    # fornecedor/cliente -- usado no popup de histórico anual por categoria (clique no
    # nome da categoria na aba Por Categoria, modo "Por mês"). Ao contrário do extrato
    # diário (D["movimentos"], só ~53 dias, hoje a +45), rec/pag/ra/pa/cnf/osn cobrem o
    # histórico inteiro (desde o início do ano anterior), então aqui dá pra ter detalhe
    # por cliente até em meses fechados e no mês seguinte/dezembro também. Porte exato de
    # scripts/build_extra_dashboard_caixa.py (pipeline antigo), que já tinha isso.
    por_cliente: dict[str, dict[str, dict[str, float]]] = {}
    for mes in meses_ano:
        cm: dict[str, dict[str, float]] = {}

        def addc(cat: str, cliente: Any, v: float) -> None:
            nome_cli = cliente if isinstance(cliente, str) and cliente.strip() else "(sem nome)"
            cm.setdefault(cat, {})
            cm[cat][nome_cli] = cm[cat].get(nome_cli, 0.0) + float(v)

        if mes <= MES_CUR:
            for (cat, cli), v in _somar_por_categoria_cliente(rec[rec["m"] == mes], "Cliente", "v").items():
                addc(cat, cli, v)
            for (cat, cli), v in _somar_por_categoria_cliente(pag[pag["m"] == mes], "Fornecedor", "v").items():
                addc(cat, cli, -v)
        if mes >= MES_CUR:
            for (cat, cli), v in _somar_por_categoria_cliente(ra[(ra["m"] == mes) & (ra["prev"] > REF)], "Razão Social", "A Receber").items():
                addc(cat, cli, v)
            for (cat, cli), v in _somar_por_categoria_cliente(pa[(pa["m"] == mes) & (pa["venc"] > REF)], "Razão Social", "A Pagar").items():
                addc(cat, cli, -v)
            for (cat, cli), v in _somar_por_categoria_cliente(cnf[(cnf["m"] == mes) & (cnf["dp"] > REF)], "Razão Social", "Valor Mensal").items():
                addc(cat, cli, v)
            for (cat, cli), v in _somar_por_categoria_cliente(osn[(osn["m"] == mes) & (osn["dp"] > REF)], "Razão Social", "Valor").items():
                addc(cat, cli, v)
            if mes == MES_CUR:
                for _m in D.get("movimentos", []):
                    if _m["conta"] not in no_caixa or _m["data"] != D["hoje"] or _m["realizado"]:
                        continue
                    addc(_m["categoria"], _m.get("nome"), _m["valor"])
        por_cliente[mes] = {cat: {cli: _r(v) for cli, v in clis.items() if abs(v) > 0.005} for cat, clis in cm.items()}
        por_cliente[mes] = {cat: clis for cat, clis in por_cliente[mes].items() if clis}

    # ---------- base por categoria pra regra do dashboard (média dos últimos 6 meses
    # fechados) ----------
    # Exposta à parte (NÃO mutamos catmes aqui) -- quem aplica o preenchimento por categoria é
    # o frontend (src/lib/fluxo-caixa/calculos.ts, catmesAjustado()), porque a tela tem um
    # toggle "usaRegra" que liga/desliga essa regra; se a gente já tivesse somado aqui, desligar
    # o toggle no navegador não teria efeito nenhum. A Omie só pré-gera a próxima parcela não
    # faturada de cada contrato aos poucos (não os 3 meses de uma vez) -- a cobertura de
    # contrato/título em catmes fica rala pra meses mais distantes, mesmo quando o cliente segue
    # faturando no ritmo normal; sem completar, um mês como dezembro aparece bem abaixo da média
    # só por falta de dado ainda cadastrado na Omie, não por queda real de receita. Achado real
    # na Oystr, 01/10/2026 (commits b10d686/c012587/974f123 no pipeline antigo).
    parametros = _parametros(rec, ra, REF)
    fechados_recentes = sorted(m for m in meses_ano if m < MES_CUR and float(fat_em.get(m, 0)) > 0)[-6:]
    cat_base: dict[str, float] = {}
    for m in fechados_recentes:
        for cat, v in catmes.get(m, {}).items():
            if v > 0:
                cat_base[cat] = cat_base.get(cat, 0.0) + v
    for cat in cat_base:
        cat_base[cat] = _r(cat_base[cat] / len(fechados_recentes))

    # ---------- hist: ano anterior + ano corrente ----------
    fixo = {h["mes"]: h for h in (historico_fixo or [])}
    hist: list[dict[str, Any]] = []
    acum = float(D.get("abertura") or 0.0)
    for ano in (ANO - 1, ANO):
        for i in range(1, 13):
            mes = f"{ano}-{i:02d}"
            fat_mes = float(fat_em.get(mes, 0))
            if mes < MES_CUR and mes in fixo:
                h = fixo[mes]
                ent, sai, acum = float(h["ent"]), float(h["sai"]), float(h["acum"])
                hist.append({"mes": mes, "fat": _r(fat_mes), "ent": _r(ent), "sai": _r(sai),
                             "saldo": _r(ent - sai), "acum": _r(acum), "status": "fechado"})
                continue
            if mes < MES_CUR:
                ent, sai, fat = float(ent_m.get(mes, 0)), float(sai_m.get(mes, 0)), fat_mes
                status = "fechado"
            elif mes == MES_CUR:
                # Realizado + previsto depois de hoje + previsto PARA hoje, e o acumulado
                # ancorado no saldo real do banco hoje (achado 28/09/2026: nunca encadear de
                # mês anterior, que acumula resíduo de título ao longo dos meses).
                #
                # O "resto do mês" (depois de hoje) vem das MESMAS bases de título que catmes
                # usa (ra/pa/cnf/osn com vencimento/previsão > hoje) -- antes vinha do extrato
                # nativo (D["dias"]), que não sabe de contratos com vigência vencida (bases.py,
                # "Complementar") nem sempre bate com a base de títulos por diferença de
                # categorização/timing entre as duas consultas na Omie -- "SALDO NO FIM DO
                # PERÍODO" do mês corrente (Por Categoria/Visão Mensal, que usam hist direto)
                # ficava bem diferente da aba Diário (que já reconcilia com catmes no
                # navegador) -- achado real, 02/10/2026: -R$ 260k no Diário vs -R$ 8k em Por
                # Categoria pro mesmo outubro. Assim, hist e catmes usam exatamente a mesma
                # fonte pro mês corrente -- nunca mais divergem por construção.
                aberto_receber_hoje = sum(MOVS_HOJE_RECEBER.values())
                aberto_pagar_hoje = sum(MOVS_HOJE_PAGAR.values())
                resto_receber = (
                    float(ra[(ra["m"] == mes) & (ra["prev"] > REF)]["A Receber"].sum())
                    + float(cnf[(cnf["m"] == mes) & (cnf["dp"] > REF)]["Valor Mensal"].sum())
                    + float(osn[(osn["m"] == mes) & (osn["dp"] > REF)]["Valor"].sum())
                )
                resto_pagar = float(pa[(pa["m"] == mes) & (pa["venc"] > REF)]["A Pagar"].sum())
                ent = float(ent_m.get(mes, 0)) + aberto_receber_hoje + resto_receber
                sai = float(sai_m.get(mes, 0)) + aberto_pagar_hoje + resto_pagar
                fat = fat_mes + float(cnf[(cnf["m"] == mes) & (cnf["dp"] > REF)]["Valor Mensal"].sum()) + float(
                    osn[(osn["m"] == mes) & (osn["dp"] > REF)]["Valor"].sum()
                )
                anterior = acum
                acum = D["caixaProprio"] + aberto_receber_hoje - aberto_pagar_hoje + resto_receber - resto_pagar
                hist.append({"mes": mes, "fat": _r(fat), "ent": _r(ent), "sai": _r(sai),
                             "saldo": _r(acum - anterior), "acum": _r(acum), "status": "em_curso"})
                continue
            else:
                valores = catmes.get(mes, {}).values()
                ent = sum(v for v in valores if v > 0)
                sai = -sum(v for v in valores if v < 0)
                fat = ent
                status = "projetado"
            acum += ent - sai
            hist.append({"mes": mes, "fat": _r(fat), "ent": _r(ent), "sai": _r(sai),
                         "saldo": _r(ent - sai), "acum": _r(acum), "status": status})

    saidas = {mes: _r(-sum(v for v in catmes[mes].values() if v < 0)) for mes in meses_ano if mes > MES_CUR}

    # ---------- inadimplência (vencimentos do ano corrente) ----------
    # Na inadimplência, "A Receber" passa a ser o saldo REAL (líquido de retenção
    # e do que já foi recebido parcialmente — ver "A Receber Real"). `ov` é uma
    # cópia, então o fluxo (ra["A Receber"] cheio) fica intacto.
    # Vencido = passou da PREVISÃO (não do vencimento). Dentro deste bloco,
    # "dias"/"venc"/"m" de `ov` passam a ser pela previsão; o `venc` original
    # fica em "venc_orig" (exibido como referência). O `ra` do fluxo de caixa
    # continua intacto no vencimento.
    ov = ra[ra["dias_prev"] > 0].copy()
    ov["A Receber"] = ov["A Receber Real"]
    ov["dias"] = ov["dias_prev"]
    ov["venc_orig"] = ov["venc"]
    ov["venc"] = ov["prev"]
    ov["m"] = _mes(ov["prev"])
    ov_ano = ov[ov["venc"] >= INI_ANO].copy()

    def faixa(d: int) -> str:
        return ("1) 1-30 dias" if d <= 30 else "2) 31-60 dias" if d <= 60 else "3) 61-90 dias" if d <= 90
                else "4) 91-180 dias" if d <= 180 else "5) +180 dias")

    ov_ano["faixa"] = ov_ano["dias"].map(faixa)
    faixas = [{"faixa": k, "valor": _r(g["A Receber"].sum()), "n": int(len(g))} for k, g in ov_ano.groupby("faixa")]
    por_cli_ano = ov_ano.groupby("Razão Social").agg(valor=("A Receber", "sum"), n=("A Receber", "count"),
                                                     dias=("dias", "max"), antigo=("venc", "min"))
    por_cli_all = ov.groupby("Razão Social").agg(vencidoTotal=("A Receber", "sum"), titulosTotal=("A Receber", "count"))
    top = [{"cliente": c, "valor": _r(r["valor"]), "n": int(r["n"]), "dias": int(r["dias"]),
            "antigo": r["antigo"].strftime("%Y-%m-%d"),
            "vencidoTotal": _r(por_cli_all.loc[c, "vencidoTotal"]), "titulosTotal": int(por_cli_all.loc[c, "titulosTotal"])}
           for c, r in por_cli_ano.sort_values("valor", ascending=False).iterrows()]
    pormes = [{"mes": k, "valor": _r(v)} for k, v in ov_ano.groupby("m")["A Receber"].sum().items()]
    meses_venc = sorted(ov_ano["m"].unique())
    cxm = []
    for c, g in ov_ano.groupby("Razão Social"):
        linha: dict[str, Any] = {"cliente": c, "tot": _r(g["A Receber"].sum())}
        for mn, v in g.groupby("m")["A Receber"].sum().items():
            linha[mn] = _r(v)
        cxm.append(linha)
    cxm.sort(key=lambda r: -r["tot"])
    fat_ano = sum(h["fat"] for h in hist if h["mes"].startswith(f"{ANO}-") and h["mes"] <= MES_CUR)
    inad = {"ref": ref_iso, "ano": ANO, "total": _r(ov_ano["A Receber"].sum()), "n": int(len(ov_ano)),
            "clientes": int(ov_ano["Razão Social"].nunique()),
            "avencer": _r(ra[(ra["dias_prev"] <= 0) & (ra["prev"] < INI_PROX)]["A Receber Real"].sum()),
            "faixas": faixas, "top": top, "pormes": pormes, "cxm": cxm, "meses": meses_venc,
            "fatAno": _r(fat_ano), "top5": _r(sum(t["valor"] for t in top[:5]))}

    # ---------- atrasos (venceu e não entrou: 7/15/30 dias) ----------
    def fx(n: int) -> dict[str, Any]:
        s = ov[ov["dias"] <= n]
        return {"valor": _r(s["A Receber"].sum()), "n": int(len(s)), "clientes": int(s["Razão Social"].nunique())}

    it = ov[ov["dias"] <= 30].sort_values("A Receber", ascending=False)
    atrasos = {"ref": ref_iso, "faixas": {str(n): fx(n) for n in (7, 15, 30)},
               "itens": [{"cliente": x["Razão Social"], "venc": x["venc"].strftime("%Y-%m-%d"),
                          "vencOrig": x["venc_orig"].strftime("%Y-%m-%d") if pd.notna(x["venc_orig"]) else None,
                          "dias": int(x["dias"]),
                          "valor": _r(x["A Receber"]), "categoria": str(x["Categoria"]),
                          "doc": str(x["Documento"]) if pd.notna(x["Documento"]) else ""}
                         for _, x in it.iterrows()]}

    # ---------- inadx: recuperação, legado, reincidentes ----------
    def norm(s: Any) -> str:
        return str(s).strip().upper()

    sc["Valor Mensal (R$)"] = _num(sc["Valor Mensal (R$)"])
    ativos_sc = sc[sc["Status mapeado"] == "Ativo"]
    mrr_n: dict[str, float] = {}
    for k, v in ativos_sc.groupby("Cliente")["Valor Mensal (R$)"].sum().items():
        mrr_n[norm(k)] = mrr_n.get(norm(k), 0) + float(v)
    rec["atraso"] = (rec["d"] - rec["venc"]).dt.days
    r12 = rec[rec["d"] >= REF - pd.Timedelta(days=365)]
    recup = []
    for nome, lo, hi in [("1-30", 0, 30), ("31-60", 30, 60), ("61-90", 60, 90), ("91-180", 90, 180), ("+180", 180, 10**6)]:
        paid = r12[r12["atraso"] > lo]["v"].sum()
        opn = ov[ov["dias"] > lo]["A Receber"].sum()
        taxa = paid / (paid + opn) if paid + opn else 0
        v_ano = ov_ano[(ov_ano["dias"] > lo) & (ov_ano["dias"] <= hi)]["A Receber"].sum()
        vall = ov[(ov["dias"] > lo) & (ov["dias"] <= hi)]["A Receber"].sum()
        recup.append({"faixa": nome, "taxa": round(float(taxa), 3), "vencidoAno": _r(v_ano), "vencidoTotal": _r(vall),
                      "esperadoAno": _r(v_ano * taxa), "esperadoTotal": _r(vall * taxa)})
    late = r12[r12["atraso"] > 15]
    reinc = []
    for c, g in late.groupby("Cliente"):
        meses_n = g["venc"].dt.to_period("M").nunique()
        if meses_n >= 3:
            reinc.append({"cliente": c, "meses": int(meses_n), "atrasoMedio": int(g["atraso"].mean()),
                          "recebidoMes": _r(r12[r12["Cliente"] == c]["v"].sum() / 12),
                          "vencido": _r(ov[ov["Razão Social"].map(norm) == norm(c)]["A Receber"].sum()),
                          "mrr": _r(mrr_n.get(norm(c), 0))})
    reinc.sort(key=lambda x: (-x["meses"], -x["recebidoMes"]))
    leg = ov[ov["venc"] < INI_ANO]
    inadx = {"ref": ref_iso, "vencidoTotal": _r(ov["A Receber"].sum()), "nTotal": int(len(ov)),
             "clientesTotal": int(ov["Razão Social"].nunique()),
             "legado": _r(leg["A Receber"].sum()), "legadoN": int(len(leg)), "legadoCli": int(leg["Razão Social"].nunique()),
             "legadoDias": int(leg["dias"].mean()) if len(leg) else 0,
             "recuperacao": recup, "reincidentes": reinc}

    # ---------- acurácia da previsão (30 e 90 dias) ----------
    pag["atraso"] = (pag["d"] - pag["venc"]).dt.days

    def analisa(d: pd.DataFrame, ab: pd.DataFrame, col: str, ini: pd.Timestamp, fim: pd.Timestamp) -> dict[str, Any]:
        prev_w = d[(d["venc"] >= ini) & (d["venc"] <= fim)]
        ab_w = ab[(ab["venc"] >= ini) & (ab["venc"] <= fim)]
        previsto = prev_w["v"].sum() + ab_w[col].sum()
        real_w = d[(d["d"] >= ini) & (d["d"] <= fim)]
        atraso = (prev_w["d"] - prev_w["venc"]).dt.days
        return dict(previsto=_r(previsto), realizado=_r(real_w["v"].sum()),
                    noDia=_r(prev_w[prev_w["d"] <= prev_w["venc"]]["v"].sum()),
                    ate5=_r(prev_w[(atraso > 0) & (atraso <= 5)]["v"].sum()),
                    dep5=_r(prev_w[atraso > 5]["v"].sum()), aberto=_r(ab_w[col].sum()),
                    deAntes=_r(real_w[real_w["venc"] < ini]["v"].sum()), n=int(len(prev_w) + len(ab_w)))

    ini = REF - pd.Timedelta(days=30)
    fim = REF - pd.Timedelta(days=1)
    sem = []
    for k in range(4):
        a_ = ini + pd.Timedelta(days=7 * k)
        b_ = min(a_ + pd.Timedelta(days=6), fim)
        e = analisa(rec, ra, "A Receber", a_, b_)
        s = analisa(pag, pa, "A Pagar", a_, b_)
        sem.append({"ini": a_.strftime("%Y-%m-%d"), "fim": b_.strftime("%Y-%m-%d"),
                    "entPrev": e["previsto"], "entReal": e["realizado"], "saiPrev": s["previsto"], "saiReal": s["realizado"]})
    pa_venc = pa[pa["venc"] < REF].sort_values("A Pagar", ascending=False)
    acur = {"ini": ini.strftime("%Y-%m-%d"), "fim": fim.strftime("%Y-%m-%d"),
            "ent": analisa(rec, ra, "A Receber", ini, fim), "sai": analisa(pag, pa, "A Pagar", ini, fim), "semanas": sem,
            "ent90": analisa(rec, ra, "A Receber", REF - pd.Timedelta(days=90), fim),
            "sai90": analisa(pag, pa, "A Pagar", REF - pd.Timedelta(days=90), fim),
            "saiAbertos": [{"nome": r["Razão Social"], "venc": r["venc"].strftime("%Y-%m-%d"),
                            "vencOrig": r["venc_orig"].strftime("%Y-%m-%d") if pd.notna(r["venc_orig"]) else None,
                            "categoria": r["Categoria"], "valor": _r(r["A Pagar"])} for _, r in pa_venc.iterrows()]}

    # ---------- faturamento por linha de receita (vencimentos do ano até o mês corrente) ----------
    t = pd.concat([
        rec[["Cliente", "venc", "Valor da Conta", "Categoria"]],
        ra[["Razão Social", "venc", "Valor da Conta", "Categoria"]].rename(columns={"Razão Social": "Cliente"}),
    ])
    t = t[(t["venc"] >= INI_ANO) & (t["venc"] < pd.Timestamp(MES_CUR + "-01") + pd.offsets.MonthBegin(1))].copy()
    t["m"] = _mes(t["venc"])
    t["g"] = t["Categoria"].map(lambda c: _linha_receita(c, linhas_receita))
    meses_f = sorted(t["m"].unique())
    piv = t.pivot_table(index="g", columns="m", values="Valor da Conta", aggfunc="sum").fillna(0) if len(t) else pd.DataFrame()
    fat_linhas = {"meses": meses_f,
                  "linhas": {g: [_r(piv.loc[g, mm]) if mm in piv.columns else 0 for mm in meses_f] for g in piv.index}}

    return {
        "ref": ref_iso,
        "ano": ANO,
        "hist": hist,
        "catmes": catmes,
        "porCliente": por_cliente,
        "catBase": cat_base,
        "saidas": saidas,
        "inad": inad,
        "atrasos": atrasos,
        "inadx": inadx,
        "acur": acur,
        "faturamentoPorLinha": fat_linhas,
        "parametros": {**parametros, "contratosAtivos": int(len(ativos_sc))},
    }


def _parametros(rec: pd.DataFrame, ra: pd.DataFrame, REF: pd.Timestamp) -> dict[str, Any]:
    """Números que o template tinha fixos da Oystr, medidos nos últimos 12
    meses fechados da empresa."""
    ini_mes_ref = REF.to_period("M").to_timestamp()
    janela_ini = ini_mes_ref - pd.DateOffset(months=12)

    # Recebimento efetivo: do valor com vencimento na janela, quanto entrou.
    rec_w = rec[(rec["venc"] >= janela_ini) & (rec["venc"] < ini_mes_ref)]
    ra_w = ra[(ra["venc"] >= janela_ini) & (ra["venc"] < ini_mes_ref)]
    faturado = float(rec_w["Valor da Conta"].sum() + ra_w["Valor da Conta"].sum())
    recebido = float(rec_w["v"].sum() + (ra_w["Valor da Conta"] - ra_w["A Receber"]).sum())
    rec_efetivo = min(1.0, max(0.5, recebido / faturado)) if faturado > 0 else 1.0

    # Padrão intramensal: peso de cada dia do mês nas entradas recebidas.
    rec_12 = rec[(rec["d"] >= janela_ini) & (rec["d"] < ini_mes_ref)]
    por_dia = rec_12.groupby(rec_12["d"].dt.day)["v"].sum()
    padrao = [round(float(por_dia.get(d, 0.0)), 2) for d in range(1, 32)]
    if sum(padrao) <= 0:
        padrao = [1.0] * 31

    # Cenários: parte do valor que venceu em cada mês e entrou com mais de 15
    # dias de atraso ou segue em aberto além disso. Conservador = média dos
    # meses; pessimista = pior mês, com 30 dias de atraso.
    fracoes = []
    for k in range(12, 0, -1):
        m_ini = ini_mes_ref - pd.DateOffset(months=k)
        m_fim = m_ini + pd.DateOffset(months=1)
        r_m = rec[(rec["venc"] >= m_ini) & (rec["venc"] < m_fim)]
        a_m = ra[(ra["venc"] >= m_ini) & (ra["venc"] < m_fim)]
        total = float(r_m["Valor da Conta"].sum() + a_m["Valor da Conta"].sum())
        if total <= 0:
            continue
        atrasado = float(r_m[(r_m["d"] - r_m["venc"]).dt.days > 15]["v"].sum()
                         + a_m[(REF - a_m["venc"]).dt.days > 15]["A Receber"].sum())
        fracoes.append({"mes": m_ini.strftime("%Y-%m"), "frac": atrasado / total})
    if fracoes:
        media = sum(f["frac"] for f in fracoes) / len(fracoes)
        pior = max(fracoes, key=lambda f: f["frac"])
    else:
        media, pior = 0.0, {"mes": None, "frac": 0.0}

    return {
        "recEfetivo": round(rec_efetivo, 4),
        "padraoIntramensal": padrao,
        "cenarios": {
            "conservador": {"frac": round(media, 3), "atraso": 15, "meses": len(fracoes)},
            "pessimista": {"frac": round(pior["frac"], 3), "atraso": 30, "mes": pior["mes"]},
        },
    }
