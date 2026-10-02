"""
Gera extra.json (X2) do dashboard "Fluxo de caixa · Oystr" a partir do Diagnóstico Consolidado
(proos-omie-mcp) e do data.json (extrato diário, extrair_fluxo_caixa_portal.py).

    python build_extra_dashboard_caixa.py --pacote dados/oystr/AAAA-MM-DD [--out extra.json]      (padrão desde 2026-09-25)
    python build_extra_dashboard_caixa.py <Oystr_Diagnostico_Consolidado_AAAAMMDD_HHMMSS.xlsx>   (legado, Excel)

--pacote: pasta gerada por scripts/exportar_pacote_caixa.py (7 bases em JSON, mesmas colunas das abas
"Base -") + extrato.json (saída do extrair_fluxo_caixa_portal.py). O histórico fechado de 2025 vem de
historico_2025.json na pasta do cliente (dados/oystr/), fixo — 2025 está fechado.

Não depende das abas de fórmula do Diagnóstico (Fluxo Mensal Historico etc.), só das abas "Base - *":
tudo é recalculado das bases, o que evita placeholders e a coluna "Categoria (mapa)" desalinhada.
Se o data.json trouxer "historicoMensal" (extrair_fluxo_caixa_portal.py com --historico_desde), os meses
fechados (entradas, saídas, saldo, categorias) vêm do extrato — igual ao relatório nativo do Omie.
Opcional: --omie <export do relatório "Fluxo de Caixa por Categoria Mensal"> para conferência/alinhamento.
"""
import sys, json, re, argparse
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("xlsx", nargs="?", default=None, help="(legado) Diagnóstico em Excel")
ap.add_argument("--pacote", default=None, help="pasta do pacote JSON (exportar_pacote_caixa.py)")
ap.add_argument("--ref", default=None, help="data de referência (padrão: data do pacote ou do nome do arquivo)")
ap.add_argument("--data", default=None, help="extrato diário (padrão: <pacote>/extrato.json, ou data.json)")
ap.add_argument("--usar-historico-extrato", action="store_true",
                help="alinhar meses fechados ao historicoMensal do extrato (DESLIGADO: em 24/09/2026 esse histórico "
                     "não batia com o saldo real do banco — ago/26 R$ 1,18 mi vs ≈ R$ 400 mil)")
ap.add_argument("--out", default="extra.json")
ap.add_argument("--omie", default=None, help="export do relatório Omie 'Fluxo de Caixa por Categoria Mensal' (realizado) para alinhar os meses fechados")
args = ap.parse_args()

import os
if not args.pacote and not args.xlsx:
    ap.error("informe --pacote <pasta> (ou, legado, o arquivo .xlsx)")
if args.pacote:
    MANIF = json.load(open(os.path.join(args.pacote, "manifesto.json"), encoding="utf-8"))
    REF = pd.Timestamp(args.ref or MANIF["ref"])
    data_path = args.data or os.path.join(args.pacote, "extrato.json")
else:
    m = re.search(r"(\d{4})(\d{2})(\d{2})_\d{6}", args.xlsx)
    REF = pd.Timestamp(args.ref) if args.ref else pd.Timestamp(f"{m.group(1)}-{m.group(2)}-{m.group(3)}")
    data_path = args.data or "data.json"
D = json.load(open(data_path, encoding="utf-8"))
HOJE = pd.Timestamp(D["hoje"])
MES_CUR = REF.strftime("%Y-%m")

# O que ainda está em aberto (não baixado) com previsão/vencimento exatamente HOJE, na
# granularidade que o painel usa pra fechar o dia (extrair_fluxo_caixa_portal.py) — não
# recalculado a partir de receber_aberto.json/pagar_aberto.json, porque essas duas fontes
# não concordam byte a byte (achado 28/09/2026: título com Vencimento e Previsão == hoje
# em receber_aberto.json que a consulta ao vivo do extrato não considera "previsto pra hoje",
# por critério do próprio Omie que não está nesses dois campos). Ler direto do extrato.json
# garante que a aba Diário e o hist/catmes daqui usam exatamente os mesmos números.
_no_caixa_contas = {c["codigo"] for c in D["contas"] if c["somaNoCaixa"]}
MOVS_HOJE_RECEBER, MOVS_HOJE_PAGAR = {}, {}
for _m in D.get("movimentos", []):
    if _m["conta"] not in _no_caixa_contas or _m["data"] != D["hoje"] or _m["realizado"]:
        continue
    alvo = MOVS_HOJE_RECEBER if _m["valor"] > 0 else MOVS_HOJE_PAGAR
    alvo[_m["categoria"]] = alvo.get(_m["categoria"], 0.0) + abs(_m["valor"])
SALDO_INICIAL_2025 = 774857.13  # saldo real de abertura em Jan/25 (Diagnóstico, aba Fluxo Mensal Historico)
NOMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NOMES26 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]  # como o template espera
f = args.xlsx
PACOTE_ARQ = {"Base - Recebimentos": "recebimentos", "Base - Pagamentos": "pagamentos",
              "Base - Receber Aberto": "receber_aberto", "Base - Pagar Aberto": "pagar_aberto",
              "Base - Contratos Nao Faturados": "contratos_nao_faturados",
              "Base - OS Nao Faturadas": "os_nao_faturadas", "Base - Status Contratos": "status_contratos"}
def rd(s):
    if not args.pacote:
        return pd.read_excel(f, sheet_name=s)
    df = pd.DataFrame(json.load(open(os.path.join(args.pacote, PACOTE_ARQ[s] + ".json"), encoding="utf-8")))
    for c in ("A Receber", "A Pagar"):  # no Excel eram fórmulas (H - I); aqui recompostas logo abaixo
        if s in ("Base - Receber Aberto", "Base - Pagar Aberto") and c not in df.columns:
            df[c] = float("nan")
    return df

rec = rd("Base - Recebimentos"); pag = rd("Base - Pagamentos")
ra = rd("Base - Receber Aberto"); pa = rd("Base - Pagar Aberto")
cnf = rd("Base - Contratos Nao Faturados"); osn = rd("Base - OS Nao Faturadas")
sc = rd("Base - Status Contratos")
for df in (rec, pag):
    df["d"] = pd.to_datetime(df["Data de Crédito ou Débito (No Extrato)"]); df["venc"] = pd.to_datetime(df["Vencimento"]); df["em"] = pd.to_datetime(df["Emissão"])
rec["v"] = rec["Recebido"]; pag["v"] = pag["Valor Pago"]
for df in (ra, pa):
    df["venc"] = pd.to_datetime(df["Vencimento"]); df["em"] = pd.to_datetime(df["Emissão"])
# "A Receber"/"A Pagar" são fórmulas no Diagnóstico (ficam vazias se o arquivo não foi recalculado no Excel): recompor
ra["A Receber"] = ra["A Receber"].where(ra["A Receber"].notna(), ra["Valor da Conta"].fillna(0) - ra["Recebido"].fillna(0))
pa["A Pagar"] = pa["A Pagar"].where(pa["A Pagar"].notna(), pa["Valor da Conta"].fillna(0) - pa["Valor Pago"].fillna(0))
ra = ra[ra["A Receber"] > 0].copy(); pa = pa[pa["A Pagar"] > 0].copy()
# Contas a pagar: a data que vale para o caixa é a PREVISÃO de pagamento (como no extrato/fluxo diário), não o vencimento
pa["prev"] = pd.to_datetime(pa["Previsão"], errors="coerce").fillna(pa["venc"])
pa["venc_orig"] = pa["venc"]; pa["venc"] = pa["prev"]
ra["dias"] = (REF - ra["venc"]).dt.days; pa["dias"] = (REF - pa["venc"]).dt.days
cnf["dp"] = pd.to_datetime(cnf["Data Prevista"]); osn["dp"] = pd.to_datetime(osn["Data Prevista"])
# pacotes antigos (antes de 01/10/2026) não têm a coluna — trata como "nenhuma complementar"
if "Complementar" not in cnf.columns:
    cnf["Complementar"] = False
cnf["Complementar"] = cnf["Complementar"].fillna(False)
per = lambda s: s.dt.to_period("M").astype(str)
rec["m"] = per(rec["d"]); pag["m"] = per(pag["d"]); ra["m"] = per(ra["venc"]); pa["m"] = per(pa["venc"]); cnf["m"] = per(cnf["dp"]); osn["m"] = per(osn["dp"])
rec["mem"] = per(rec["em"]); ra["mem"] = per(ra["em"])

# ---------- categoria: preencher em branco pela categoria mais frequente do cliente ----------
def fill_cat(df, cli_col):
    df["Categoria"] = df["Categoria"].fillna("").astype(str).str.strip()
    return df
rec = fill_cat(rec, "Cliente"); pag = fill_cat(pag, "Fornecedor"); ra = fill_cat(ra, "Razão Social"); pa = fill_cat(pa, "Razão Social")
hist_cat = pd.concat([rec[["Cliente", "Categoria"]].rename(columns={"Cliente": "n"}), ra[["Razão Social", "Categoria"]].rename(columns={"Razão Social": "n"})])
hist_cat = hist_cat[hist_cat["Categoria"] != ""]
moda = hist_cat.groupby("n")["Categoria"].agg(lambda s: s.value_counts().index[0]).to_dict()
def preencher(df, col):
    vazio = df["Categoria"] == ""
    df.loc[vazio, "Categoria"] = df.loc[vazio, col].map(moda).fillna("RPA Recorrente")
    return df
rec = preencher(rec, "Cliente"); ra = preencher(ra, "Razão Social")
pag.loc[pag["Categoria"] == "", "Categoria"] = "Administrativas (sem categoria)"; pa.loc[pa["Categoria"] == "", "Categoria"] = "Administrativas (sem categoria)"

# ---------- hist (Jan/25 .. Dez/26) ----------
fat_em = pd.concat([rec[["mem", "Valor da Conta"]], ra[["mem", "Valor da Conta"]]]).groupby("mem")["Valor da Conta"].sum()
ent_m = rec.groupby("m")["v"].sum(); sai_m = pag.groupby("m")["v"].sum()
dias = D["dias"]

# catmes 2026 (categoria x mês) — realizado para meses fechados, realizado+previsto no mês corrente, previsto out–dez
catmes = {}
meses26 = [f"2026-{i:02d}" for i in range(1, 13)]
for mes in meses26:
    c = {}
    def add(cat, v):
        c[cat] = c.get(cat, 0.0) + float(v)
    if mes <= MES_CUR:
        for cat, v in rec[rec["m"] == mes].groupby("Categoria")["v"].sum().items(): add(cat, v)
        for cat, v in pag[pag["m"] == mes].groupby("Categoria")["v"].sum().items(): add(cat, -v)
    if mes >= MES_CUR:
        cut = REF.strftime("%Y-%m-%d")
        for cat, v in ra[(ra["m"] == mes) & (ra["venc"] > REF)].groupby("Categoria")["A Receber"].sum().items(): add(cat, v)
        for cat, v in pa[(pa["m"] == mes) & (pa["venc"] > REF)].groupby("Categoria")["A Pagar"].sum().items(): add(cat, -v)
        for cat, v in cnf[(cnf["m"] == mes) & (cnf["dp"] > REF)].groupby("Categoria")["Valor Mensal"].sum().items(): add(cat, v)
        for cat, v in osn[(osn["m"] == mes) & (osn["dp"] > REF)].groupby("Categoria")["Valor"].sum().items(): add(cat, v)
        if mes == MES_CUR:
            # Hoje: usa direto o extrato (MOVS_HOJE_*), não título aberto por vencimento —
            # é o mesmo dado que a aba Diário usa, então bate byte a byte com ela.
            for cat, v in MOVS_HOJE_RECEBER.items(): add(cat, v)
            for cat, v in MOVS_HOJE_PAGAR.items(): add(cat, -v)
    # meses futuros cobertos por inteiro pelo extrato diário (data.json): alinhar o total de saídas ao extrato
    # (que inclui previsões nativas de pedidos/OS que não estão nas bases de títulos), mantendo a categorização
    if mes > MES_CUR:
        dm_ = [d for d in dias if d["data"].startswith(mes)]
        import calendar as _cal
        ndias = _cal.monthrange(int(mes[:4]), int(mes[5:7]))[1]
        if len(dm_) == ndias:
            alvo = sum(d["saidas"] for d in dm_); tot = -sum(v for v in c.values() if v < 0)
            if tot > 0 and alvo > 0:
                for k in list(c):
                    if c[k] < 0: c[k] *= alvo / tot
    catmes[mes] = {k: round(v, 2) for k, v in c.items() if abs(v) > 0.005}

# porCliente: mesmo recorte do catmes acima, mas com detalhe por fornecedor/cliente -- usado no
# popup de histórico anual por categoria (clique no nome da categoria na aba Por Categoria). Ao
# contrário do extrato diário (D["movimentos"], só ~53 dias, hoje a +45), rec/pag/ra/pa/cnf/osn
# cobrem o histórico inteiro (--desde 01/01/2025 em diante), então aqui dá pra ter detalhe por
# cliente até em meses fechados (jan-ago) e em dezembro, que o navegador sozinho não teria.
por_cliente = {}
for mes in meses26:
    cm: dict[str, dict[str, float]] = {}
    def addc(cat, cliente, v):
        cliente = cliente if isinstance(cliente, str) and cliente.strip() else "(sem nome)"
        cm.setdefault(cat, {})
        cm[cat][cliente] = cm[cat].get(cliente, 0.0) + float(v)
    if mes <= MES_CUR:
        for (cat, cli), v in rec[rec["m"] == mes].groupby(["Categoria", "Cliente"])["v"].sum().items(): addc(cat, cli, v)
        for (cat, cli), v in pag[pag["m"] == mes].groupby(["Categoria", "Fornecedor"])["v"].sum().items(): addc(cat, cli, -v)
    if mes >= MES_CUR:
        for (cat, cli), v in ra[(ra["m"] == mes) & (ra["venc"] > REF)].groupby(["Categoria", "Razão Social"])["A Receber"].sum().items(): addc(cat, cli, v)
        for (cat, cli), v in pa[(pa["m"] == mes) & (pa["venc"] > REF)].groupby(["Categoria", "Razão Social"])["A Pagar"].sum().items(): addc(cat, cli, -v)
        for (cat, cli), v in cnf[(cnf["m"] == mes) & (cnf["dp"] > REF)].groupby(["Categoria", "Razão Social"])["Valor Mensal"].sum().items(): addc(cat, cli, v)
        for (cat, cli), v in osn[(osn["m"] == mes) & (osn["dp"] > REF)].groupby(["Categoria", "Razão Social"])["Valor"].sum().items(): addc(cat, cli, v)
        if mes == MES_CUR:
            for _m in D.get("movimentos", []):
                if _m["conta"] not in _no_caixa_contas or _m["data"] != D["hoje"] or _m["realizado"]:
                    continue
                addc(_m["categoria"], _m.get("nome"), _m["valor"])
    por_cliente[mes] = {cat: {cli: round(v, 2) for cli, v in clis.items() if abs(v) > 0.005}
                         for cat, clis in cm.items()}
    por_cliente[mes] = {cat: clis for cat, clis in por_cliente[mes].items() if clis}

# 2025: entradas/saídas/acumulado vêm da aba "Fluxo Mensal Historico" (valores fixos, relatório nativo do Omie); 2026 é recalculado das bases e encadeado a partir de Dez/25
sheet = {}
try:
    if args.pacote:
        hp = os.path.join(os.path.dirname(os.path.abspath(args.pacote.rstrip("/\\"))), "historico_2025.json")
        for h in json.load(open(hp, encoding="utf-8")):
            sheet[h["mes"]] = (float(h["ent"]), float(h["sai"]), float(h["acum"]))
        raise StopIteration
    fh = pd.read_excel(f, sheet_name="Fluxo Mensal Historico", header=None)
    for _, r in fh.iterrows():
        k = str(r[0])
        if re.match(r"^[A-Z][a-z]{2}/25$", k) and pd.notna(r[2]) and pd.notna(r[3]):
            sheet[k] = (float(r[2]), float(r[3]), float(r[5]))
except StopIteration:
    pass
except Exception as e:
    print("aviso: histórico 2025 não lido:", e)
hist = []; acum = SALDO_INICIAL_2025
for y in (2025, 2026):
    for i in range(12):
        mes = f"{y}-{i+1:02d}"; nome = (NOMES if y == 2025 else NOMES26)[i] + "/" + str(y)[2:]
        if nome in sheet:
            ent, sai, acum_s = sheet[nome]; fat = float(fat_em.get(mes, 0)); saldo = ent - sai; acum = acum_s
            hist.append({"mes": nome, "fat": round(fat, 2), "ent": round(ent, 2), "sai": round(sai, 2), "saldo": round(saldo, 2), "acum": round(acum, 2)}); continue
        if mes < MES_CUR:
            ent, sai, fat = float(ent_m.get(mes, 0)), float(sai_m.get(mes, 0)), float(fat_em.get(mes, 0))
        elif mes == MES_CUR:
            # Hoje: soma o que ja foi baixado (ent_m/sai_m), o que o extrato marca como
            # previsto PRA HOJE (MOVS_HOJE_*, ver definicao no topo do arquivo) e o resto do
            # mes direto das bases de titulo (ra/pa/cnf/osn com vencimento/previsao > hoje) —
            # as MESMAS bases que catmes[mes] ja usa (ver bloco catmes acima), nao o extrato
            # nativo da Omie (D["dias"]/prev_dias, que nao sabe de contratos com vigencia
            # vencida e pode discordar da base de titulos por categorizacao/timing — achado
            # 02/10/2026, mesma classe de problema que gerou a reconciliacao em
            # complementoContratos() no template.html, agora pro hist/Visao Mensal tambem;
            # ver extra.py (tela nativa) commit 6c2487e, portado aqui pra nao divergir).
            aberto_receber_hoje = sum(MOVS_HOJE_RECEBER.values())
            aberto_pagar_hoje = sum(MOVS_HOJE_PAGAR.values())
            resto_receber = (
                float(ra[(ra["m"] == mes) & (ra["venc"] > REF)]["A Receber"].sum())
                + float(cnf[(cnf["m"] == mes) & (cnf["dp"] > REF)]["Valor Mensal"].sum())
                + float(osn[(osn["m"] == mes) & (osn["dp"] > REF)]["Valor"].sum())
            )
            resto_pagar = float(pa[(pa["m"] == mes) & (pa["venc"] > REF)]["A Pagar"].sum())
            ent = float(ent_m.get(mes, 0)) + aberto_receber_hoje + resto_receber
            sai = float(sai_m.get(mes, 0)) + aberto_pagar_hoje + resto_pagar
            fat = float(fat_em.get(mes, 0)) + float(cnf[(cnf["m"] == mes) & (cnf["dp"] > REF)]["Valor Mensal"].sum()) + float(osn[(osn["m"] == mes) & (osn["dp"] > REF)]["Valor"].sum())
            # Caixa acumulado do mes corrente NAO encadeia do mes fechado anterior (ent_m/sai_m
            # por titulo carregam um resíduo pequeno mas real: titulo baixado sem conciliar,
            # atraso de categorizacao — ver docs/HANDOFF, achado 28/09/2026). Em vez disso, usa
            # a MESMA ancora real que a aba Diario usa (saldo do banco agora + previsto), pra
            # nunca divergir dela. "Saldo do mes" fica sendo a diferenca pra bater com a linha
            # de cima — Entradas/Saidas continuam por titulo (fonte "Realizado até ontem +
            # previsto"/"Recebimento efetivo", que faz mais sentido por categoria).
            acum_anterior = acum
            acum = D["caixaProprio"] + aberto_receber_hoje - aberto_pagar_hoje + resto_receber - resto_pagar
            saldo = round(acum - acum_anterior, 2)
            hist.append({"mes": nome, "fat": round(fat, 2), "ent": round(ent, 2), "sai": round(sai, 2), "saldo": saldo, "acum": round(acum, 2)})
            continue
        else:
            ent = sum(v for v in catmes[mes].values() if v > 0); sai = -sum(v for v in catmes[mes].values() if v < 0); fat = ent
        saldo = ent - sai; acum += saldo
        hist.append({"mes": nome, "fat": round(fat, 2), "ent": round(ent, 2), "sai": round(sai, 2), "saldo": round(saldo, 2), "acum": round(acum, 2)})
# ---------- histórico mensal do extrato (extrair_fluxo_caixa_portal.py --historico_desde): mesma base do relatório nativo do Omie ----------
HM = {h["mes"]: h for h in (D.get("historicoMensal") or [])} if args.usar_historico_extrato else {}
if HM:
    n_al = 0
    for h in hist:
        mm = h["mes"]; iso = ("20" + mm[-2:] + "-" + {**{n: f"{i+1:02d}" for i, n in enumerate(NOMES)}, **{n: f"{i+1:02d}" for i, n in enumerate(NOMES26)}}[mm[:3]])
        if iso in HM and iso < MES_CUR:
            e, s = HM[iso]["entradas"], HM[iso]["saidas"]
            h["ent"], h["sai"], h["saldo"], h["acum"] = round(e, 2), round(s, 2), round(e - s, 2), round(HM[iso]["saldoFim"], 2); n_al += 1
            if iso in catmes and HM[iso].get("categorias"):
                catmes[iso] = {k: round(v, 2) for k, v in HM[iso]["categorias"].items() if abs(v) > 0.005}
    idx = [i for i, h in enumerate(hist) if h["mes"] == NOMES26[int(MES_CUR[5:7]) - 1] + "/" + MES_CUR[2:4]]
    if idx and idx[0] > 0:
        i = idx[0]
        for j in range(i, len(hist)): hist[j]["acum"] = round(hist[j - 1]["acum"] + hist[j]["saldo"], 2)
    print("meses alinhados ao histórico do extrato:", n_al)

# ---------- alinhar meses fechados ao relatório nativo do Omie (Fluxo de Caixa por Categoria Mensal), se informado ----------
if args.omie:
    om = pd.read_excel(args.omie, sheet_name=0, header=None)
    hdr = next(i for i in range(len(om)) if re.match(r"\d{4}/\d{2}", str(om.iloc[i, 1])) and re.match(r"\d{4}/\d{2}", str(om.iloc[i, 2])))
    cols = {}
    for c in range(1, om.shape[1]):
        v = str(om.iloc[hdr, c]); mm = re.match(r"(\d{4})/(\d{2})", v)
        if mm: cols[c] = f"{mm.group(1)}-{mm.group(2)}"
    lin = {str(om.iloc[i, 0]).strip()[:2]: i for i in range(len(om)) if str(om.iloc[i, 0]).strip()[:2] in ("3.", "4.", "6.")}
    ajust = 0
    for c, mes in cols.items():
        if mes >= MES_CUR: continue
        nome = NOMES26[int(mes[5:7]) - 1] + "/" + mes[2:4] if mes.startswith("2026") else NOMES[int(mes[5:7]) - 1] + "/" + mes[2:4]
        h = next((h for h in hist if h["mes"] == nome), None)
        if h is None: continue
        ent = float(om.iloc[lin["3."], c]); sai = -float(om.iloc[lin["4."], c]); acum_o = float(om.iloc[lin["6."], c])
        h["ent"], h["sai"], h["saldo"], h["acum"] = round(ent, 2), round(sai, 2), round(ent - sai, 2), round(acum_o, 2); ajust += 1
    # reencadear o mês corrente a partir do último fechado alinhado
    idx = [i for i, h in enumerate(hist) if h["mes"] == NOMES26[int(MES_CUR[5:7]) - 1] + "/" + MES_CUR[2:4]]
    if idx and idx[0] > 0:
        i = idx[0]; hist[i]["acum"] = round(hist[i - 1]["acum"] + hist[i]["saldo"], 2)
        for j in range(i + 1, len(hist)): hist[j]["acum"] = round(hist[j - 1]["acum"] + hist[j]["saldo"], 2)
    print("meses alinhados ao relatório Omie:", ajust)
saidas = {mes: round(-sum(v for v in catmes[mes].values() if v < 0), 2) for mes in meses26 if mes > MES_CUR}

# ---------- inadimplência (vencimentos de 2026) ----------
ov = ra[ra["dias"] > 0].copy(); ov26 = ov[ov["venc"] >= "2026-01-01"].copy()
faixa = lambda d: "1) 1-30 dias" if d <= 30 else "2) 31-60 dias" if d <= 60 else "3) 61-90 dias" if d <= 90 else "4) 91-180 dias" if d <= 180 else "5) +180 dias"
ov26["faixa"] = ov26["dias"].map(faixa)
faixas = [{"faixa": k, "valor": round(float(g["A Receber"].sum()), 2), "n": int(len(g))} for k, g in ov26.groupby("faixa")]
por_cli26 = ov26.groupby("Razão Social").agg(valor=("A Receber", "sum"), n=("A Receber", "count"), dias=("dias", "max"), antigo=("venc", "min"))
por_cli_all = ov.groupby("Razão Social").agg(vencidoTotal=("A Receber", "sum"), titulosTotal=("A Receber", "count"))
top = []
for c, r in por_cli26.sort_values("valor", ascending=False).iterrows():
    top.append({"cliente": c, "valor": round(float(r["valor"]), 2), "n": int(r["n"]), "dias": int(r["dias"]), "antigo": r["antigo"].strftime("%Y-%m-%d"),
                "vencidoTotal": round(float(por_cli_all.loc[c, "vencidoTotal"]), 2), "titulosTotal": int(por_cli_all.loc[c, "titulosTotal"])})
pormes = [{"mes": k, "valor": round(float(v), 2)} for k, v in ov26.groupby("m")["A Receber"].sum().items()]
ov26["mesn"] = ov26["venc"].dt.month.astype(str)
meses26n = sorted(ov26["mesn"].unique(), key=int)
cxm = []
for c, g in ov26.groupby("Razão Social"):
    row = {"cliente": c, "tot": round(float(g["A Receber"].sum()), 2)}
    for mn, v in g.groupby("mesn")["A Receber"].sum().items(): row[mn] = round(float(v), 2)
    cxm.append(row)
cxm.sort(key=lambda r: -r["tot"])
fat12 = sum(h["fat"] for h in hist if h["mes"].endswith("/26") and h["mes"][:3] in NOMES26[:int(MES_CUR[5:7])])
inad = {"ref": REF.strftime("%Y-%m-%d"), "total": round(float(ov26["A Receber"].sum()), 2), "n": int(len(ov26)), "clientes": int(ov26["Razão Social"].nunique()),
        "avencer": round(float(ra[(ra["dias"] <= 0) & (ra["venc"] < "2027-01-01")]["A Receber"].sum()), 2), "faixas": faixas, "top": top, "pormes": pormes, "cxm": cxm,
        "meses26": meses26n, "fat12": round(fat12, 2), "top5": round(sum(t["valor"] for t in top[:5]), 2), "escopo": "ano_atual_2026"}

# ---------- atrasos (venceu e não entrou, 7/15/30 dias) ----------
def fx(n):
    s = ov[ov["dias"] <= n]; return {"valor": round(float(s["A Receber"].sum()), 2), "n": int(len(s)), "clientes": int(s["Razão Social"].nunique())}
it = ov[ov["dias"] <= 30].sort_values("A Receber", ascending=False)
atrasos = {"ref": REF.strftime("%Y-%m-%d"), "faixas": {str(n): fx(n) for n in (7, 15, 30)},
           "itens": [{"cliente": x["Razão Social"], "venc": x["venc"].strftime("%Y-%m-%d"), "dias": int(x["dias"]), "valor": round(float(x["A Receber"]), 2), "categoria": str(x["Categoria"]), "doc": str(x["Documento"])} for _, x in it.iterrows()]}

# ---------- inadx (análise: recuperação, legado, ativos, reincidentes) ----------
norm = lambda s: str(s).strip().upper()
act = sc[sc["Status mapeado"] == "Ativo"]; mrr_n = {}
for k, v in act.groupby("Cliente")["Valor Mensal (R$)"].sum().items(): mrr_n[norm(k)] = mrr_n.get(norm(k), 0) + float(v)
rec["atraso"] = (rec["d"] - rec["venc"]).dt.days
r12 = rec[rec["d"] >= REF - pd.Timedelta(days=365)]
recup = []
for nome, lo, hi in [("1-30", 0, 30), ("31-60", 30, 60), ("61-90", 60, 90), ("91-180", 90, 180), ("+180", 180, 10**6)]:
    paid = r12[r12["atraso"] > lo]["v"].sum(); opn = ov[ov["dias"] > lo]["A Receber"].sum(); taxa = paid / (paid + opn) if paid + opn else 0
    v26 = ov26[(ov26["dias"] > lo) & (ov26["dias"] <= hi)]["A Receber"].sum(); vall = ov[(ov["dias"] > lo) & (ov["dias"] <= hi)]["A Receber"].sum()
    recup.append({"faixa": nome, "taxa": round(float(taxa), 3), "vencido26": round(float(v26), 2), "vencidoTotal": round(float(vall), 2), "esperado26": round(float(v26 * taxa), 2), "esperadoTotal": round(float(vall * taxa), 2)})
cli26 = ov26.groupby("Razão Social")["A Receber"].sum()
ativos = [(c, v, mrr_n.get(norm(c), 0)) for c, v in cli26.items()]
late = r12[r12["atraso"] > 15]; reinc = []
for c, g in late.groupby("Cliente"):
    meses = g["venc"].dt.to_period("M").nunique()
    if meses >= 3:
        reinc.append({"cliente": c, "meses": int(meses), "atrasoMedio": int(g["atraso"].mean()), "recebidoMes": round(float(r12[r12["Cliente"] == c]["v"].sum() / 12), 2),
                      "vencido": round(float(ov[ov["Razão Social"].map(norm) == norm(c)]["A Receber"].sum()), 2), "mrr": round(mrr_n.get(norm(c), 0), 2)})
reinc.sort(key=lambda x: (-x["meses"], -x["recebidoMes"]))
av = ra[(ra["dias"] <= 0) & (ra["dias"] >= -30)]; top1 = cli26.sort_values(ascending=False)
leg = ov[ov["venc"] < "2026-01-01"]
inadx = {"ref": REF.strftime("%Y-%m-%d"), "vencidoTotal": round(float(ov["A Receber"].sum()), 2), "nTotal": int(len(ov)), "clientesTotal": int(ov["Razão Social"].nunique()),
         "legado": round(float(leg["A Receber"].sum()), 2), "legadoN": int(len(leg)), "legadoCli": int(leg["Razão Social"].nunique()), "legadoDias": int(leg["dias"].mean()) if len(leg) else 0,
         "recuperacao": recup, "ativos": {"n": sum(1 for _, _, m_ in ativos if m_ > 0), "de": len(ativos), "mrr": round(sum(m_ for _, _, m_ in ativos if m_ > 0), 2), "vencido": round(sum(v for _, v, m_ in ativos if m_ > 0), 2)},
         "top1": {"cliente": top1.index[0], "vencido": round(float(top1.iloc[0]), 2), "mrr": round(mrr_n.get(norm(top1.index[0]), 0), 2)},
         "reincidentes": reinc, "avencer30": round(float(av["A Receber"].sum()), 2), "avencer30Inad": round(float(av[av["Razão Social"].isin(cli26.index)]["A Receber"].sum()), 2),
         "ticket1_30": round(float(ov[ov["dias"] <= 30]["A Receber"].mean()), 2) if len(ov[ov["dias"] <= 30]) else 0, "n1_30": int(len(ov[ov["dias"] <= 30])),
         "boletoPct": round(float(ov26[ov26["Documento"] == "Boleto"]["A Receber"].sum() / ov26["A Receber"].sum() * 100), 1) if len(ov26) else 0}

# ---------- acurácia da previsão (30 e 90 dias) ----------
pag["atraso"] = (pag["d"] - pag["venc"]).dt.days
def analisa(d, ab, col, ini, fim):
    prevW = d[(d["venc"] >= ini) & (d["venc"] <= fim)]; abW = ab[(ab["venc"] >= ini) & (ab["venc"] <= fim)]
    previsto = prevW["v"].sum() + abW[col].sum(); realW = d[(d["d"] >= ini) & (d["d"] <= fim)]
    return dict(previsto=round(float(previsto), 2), realizado=round(float(realW["v"].sum()), 2), noDia=round(float(prevW[prevW["d"] <= prevW["venc"]]["v"].sum()), 2),
                ate5=round(float(prevW[(prevW["d"] > prevW["venc"]) & ((prevW["d"] - prevW["venc"]).dt.days <= 5)]["v"].sum()), 2),
                dep5=round(float(prevW[(prevW["d"] - prevW["venc"]).dt.days > 5]["v"].sum()), 2), aberto=round(float(abW[col].sum()), 2),
                deAntes=round(float(realW[realW["venc"] < ini]["v"].sum()), 2), n=int(len(prevW) + len(abW)))
ini = REF - pd.Timedelta(days=30); fim = REF - pd.Timedelta(days=1)
sem = []
for k in range(4):
    a_ = ini + pd.Timedelta(days=7 * k); b_ = min(a_ + pd.Timedelta(days=6), fim)
    e = analisa(rec, ra, "A Receber", a_, b_); s = analisa(pag, pa, "A Pagar", a_, b_)
    sem.append({"ini": a_.strftime("%Y-%m-%d"), "fim": b_.strftime("%Y-%m-%d"), "entPrev": e["previsto"], "entReal": e["realizado"], "saiPrev": s["previsto"], "saiReal": s["realizado"]})
pa_venc = pa[pa["venc"] < REF].sort_values("A Pagar", ascending=False)
acur = {"ini": ini.strftime("%Y-%m-%d"), "fim": fim.strftime("%Y-%m-%d"), "ent": analisa(rec, ra, "A Receber", ini, fim), "sai": analisa(pag, pa, "A Pagar", ini, fim), "semanas": sem,
        "ent90": analisa(rec, ra, "A Receber", REF - pd.Timedelta(days=90), fim), "sai90": analisa(pag, pa, "A Pagar", REF - pd.Timedelta(days=90), fim),
        "saiAbertos": [{"nome": r["Razão Social"], "venc": r["venc"].strftime("%Y-%m-%d"), "vencOrig": r["venc_orig"].strftime("%Y-%m-%d"), "categoria": r["Categoria"], "valor": round(float(r["A Pagar"]), 2)} for _, r in pa_venc.iterrows()]}

# ---------- fatDrivers (títulos por vencimento, 2026 até o mês corrente) ----------
t = pd.concat([rec[["Cliente", "venc", "Valor da Conta", "Categoria"]], ra[["Razão Social", "venc", "Valor da Conta", "Categoria"]].rename(columns={"Razão Social": "Cliente"})])
t = t[(t["venc"] >= "2026-01-01") & (t["venc"] < pd.Timestamp(MES_CUR + "-01") + pd.offsets.MonthBegin(1))].copy(); t["m"] = per(t["venc"])
def grp(c):
    c = str(c).lower()
    if "presto recorrente" in c: return "Presto Recorrente"
    if "rpa recorrente" in c: return "RPA Recorrente"
    if "excedente" in c: return "Excedentes"
    if "execu" in c or "desenvolv" in c: return "Projetos"
    return "Outros"
t["g"] = t["Categoria"].map(grp); piv = t.pivot_table(index="g", columns="m", values="Valor da Conta", aggfunc="sum").fillna(0); mesesF = sorted(t["m"].unique())
g = t.pivot_table(index="Cliente", columns="m", values="Valor da Conta", aggfunc="sum").fillna(0)
u = mesesF[-2:]; a2 = mesesF[-4:-2]
g["ant"] = g[a2].sum(axis=1) / 2; g["rec"] = g[u].sum(axis=1) / 2; g["d"] = g["rec"] - g["ant"]
fatDrivers = {"meses": mesesF, "grupos": {gg: [round(float(piv.loc[gg, mm]), 2) if mm in piv.columns else 0 for mm in mesesF] for gg in piv.index},
              "cli": {"novos": round(float(g[g["ant"] == 0]["rec"].sum()), 2), "nNovos": int((g["ant"] == 0).sum()), "perdidos": round(float(-g[g["rec"] == 0]["ant"].sum()), 2), "nPerdidos": int((g["rec"] == 0).sum()),
                      "base": round(float(g[(g["ant"] > 0) & (g["rec"] > 0)]["d"].sum()), 2), "top": [{"cliente": i, "ant": round(float(x["ant"])), "rec": round(float(x["rec"]))} for i, x in g.sort_values("d", ascending=False).head(3).iterrows()]}}

# ---------- 13º do ano anterior ----------
d13 = pag[(pag["Categoria"] == "13º Salário") & (pag["d"] >= "2025-01-01") & (pag["d"] < "2026-01-01")].groupby("m")["v"].sum()
dec13 = {k: round(float(v)) for k, v in d13.items() if v > 1000}

X = {"ref": REF.strftime("%Y-%m-%d"), "hist": hist, "catmes": catmes, "porCliente": por_cliente, "saidas": saidas, "inad": inad, "atrasos": atrasos, "inadx": inadx, "acur": acur, "fatDrivers": fatDrivers, "dec13_2025": dec13}
json.dump(X, open(args.out, "w", encoding="utf-8"), ensure_ascii=False)  # utf-8 explícito: no Windows o padrão é cp1252
print("ref", REF.date(), "| hist:", [(h["mes"], round(h["fat"] / 1000), round(h["ent"] / 1000), round(h["sai"] / 1000), round(h["acum"] / 1000)) for h in hist if h["mes"].endswith("/26")])
print("saidas", saidas, "| inad total", inad["total"], inad["n"], inad["clientes"], "| atrasos7", atrasos["faixas"]["7"], "| a pagar vencido", acur["sai"]["aberto"])
