"""
Motor de VARIAÇÃO (ponte) do fluxo de caixa.

Decompõe a mudança do caixa acumulado — fim do mês corrente e fim do ano — entre
dois snapshots do painel (linhas de `caixa_pacote_diario`), usando o bloco
`extra` de cada um. Comparar "o dia X" com "hoje" = comparar dois pacotes que já
estão no banco.

Base de cálculo: o `hist` (projeção por títulos). Para meses FUTUROS,
`resultado(m) = soma de catmes[m]`; para o mês corrente, o `hist` usa o saldo
real ancorado (caixaProprio), então pode sobrar um resíduo de ancoragem — medimos
a variação do mês corrente pelo `acum` direto e expomos esse resíduo à parte.

FASE 0 (este arquivo): o esqueleto estrutural — alvos, por mês e por categoria,
com RECONCILIAÇÃO garantida (a soma das partes bate com a variação total). A
classificação por CAUSA (timing×perda via porCliente, novo lançamento,
reprevisão, reclassificação retroativa, mudança de premissa) entra na fase
seguinte, por cima desta base.
"""
from __future__ import annotations

from typing import Any


def _hist_por_mes(extra: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {h["mes"]: h for h in extra.get("hist", [])}


def _resultado(h: dict[str, Any] | None) -> float:
    if not h:
        return 0.0
    return float(h.get("ent", 0.0)) - float(h.get("sai", 0.0))


def _acum(hist: dict[str, dict[str, Any]], mes: str) -> float:
    h = hist.get(mes)
    return float(h["acum"]) if h and h.get("acum") is not None else 0.0


def _r(v: float) -> float:
    return round(float(v), 2)


def montar_variacao(
    extra_a: dict[str, Any],
    extra_b: dict[str, Any],
    mes_corrente: str,
    ano: int | None = None,
) -> dict[str, Any]:
    """Variação de A (mais antigo) → B (mais recente).

    `mes_corrente` no formato 'aaaa-mm'. Alvos: fim do mês corrente e fim do ano.
    """
    ha, hb = _hist_por_mes(extra_a), _hist_por_mes(extra_b)
    if ano is None:
        ano = int(mes_corrente[:4])
    fim_ano = f"{ano}-12"
    meses = [f"{ano}-{i:02d}" for i in range(1, 13)]

    # ---- alvos: caixa acumulado fim do mês corrente e fim do ano ----
    alvos: dict[str, dict[str, float]] = {}
    for mes in (mes_corrente, fim_ano):
        a, b = _acum(ha, mes), _acum(hb, mes)
        alvos[mes] = {"acumA": _r(a), "acumB": _r(b), "delta": _r(b - a)}

    # ---- por mês: quanto cada mês contribui para a variação do acum de fim de ano ----
    # Fim de ano = acum(mês corrente) + soma dos resultados dos meses futuros.
    # mês corrente: variação medida pelo acum (inclui ancoragem no caixa real).
    # meses futuros: variação do resultado (ent − sai).
    # meses fechados (< corrente): variação do resultado = reclassificação/fechamento retroativo.
    por_mes: list[dict[str, Any]] = []
    for mes in meses:
        a, b = ha.get(mes), hb.get(mes)
        if a is None and b is None:
            continue
        if mes == mes_corrente:
            delta = _acum(hb, mes) - _acum(ha, mes)
            tipo = "corrente"
        elif mes > mes_corrente:
            delta = _resultado(b) - _resultado(a)
            tipo = "futuro"
        else:
            delta = _resultado(b) - _resultado(a)
            tipo = "fechado"
        if abs(delta) < 0.005:
            continue
        por_mes.append({"mes": mes, "tipo": tipo, "delta": _r(delta)})

    # ---- por categoria: Δ de cada categoria em cada mês (via catmes) ----
    cma, cmb = extra_a.get("catmes", {}) or {}, extra_b.get("catmes", {}) or {}
    por_categoria: list[dict[str, Any]] = []
    for mes in meses:
        cats = set(cma.get(mes, {})) | set(cmb.get(mes, {}))
        for cat in cats:
            va = float(cma.get(mes, {}).get(cat, 0.0))
            vb = float(cmb.get(mes, {}).get(cat, 0.0))
            delta = vb - va
            if abs(delta) < 0.005:
                continue
            por_categoria.append(
                {"mes": mes, "categoria": cat, "valorA": _r(va), "valorB": _r(vb), "delta": _r(delta)}
            )
    por_categoria.sort(key=lambda x: (x["mes"], -abs(x["delta"])))

    # ---- reconciliação (para a trava/teste e para a tela) ----
    # fimAno = acum(corrente) + Σ resultado dos meses futuros até dez.
    delta_corrente = alvos[mes_corrente]["delta"]
    soma_futuros = _r(sum(p["delta"] for p in por_mes if p["tipo"] == "futuro"))
    fim_ano_reconc = _r(delta_corrente + soma_futuros)
    residuo_fim_ano = _r(alvos[fim_ano]["delta"] - fim_ano_reconc)

    # por mês futuro, o delta tem de bater com a soma das categorias (hist futuro = Σ catmes).
    cat_por_mes: dict[str, float] = {}
    for c in por_categoria:
        cat_por_mes[c["mes"]] = cat_por_mes.get(c["mes"], 0.0) + c["delta"]
    residuo_por_mes: list[dict[str, Any]] = []
    for p in por_mes:
        if p["tipo"] != "futuro":
            continue
        res = _r(p["delta"] - cat_por_mes.get(p["mes"], 0.0))
        if abs(res) >= 0.01:
            residuo_por_mes.append({"mes": p["mes"], "residuo": res})

    return {
        "mesCorrente": mes_corrente,
        "fimAno": fim_ano,
        "alvos": alvos,
        "porMes": por_mes,
        "porCategoria": por_categoria,
        "causas": montar_causas(extra_a, extra_b, mes_corrente, ano),
        "reconciliacao": {
            "deltaCorrente": delta_corrente,
            "somaFuturos": soma_futuros,
            "fimAnoReconciliado": fim_ano_reconc,
            "residuoFimAno": residuo_fim_ano,
            "residuoPorMesFuturo": residuo_por_mes,
        },
    }


def _compactar(v: dict[str, Any], top_cat: int = 40, top_itens: int = 15) -> dict[str, Any]:
    """Enxuga a variação para caber no pacote sem inflar: limita as listas longas
    (porCategoria e os itens de cada causa) aos maiores por |delta|. O drill completo,
    se precisar, se recalcula on-demand a partir dos dois pacotes."""
    v = dict(v)
    cats = sorted(v.get("porCategoria", []), key=lambda c: -abs(c["delta"]))
    v["porCategoria"] = cats[:top_cat]
    v["porCategoriaTotal"] = len(cats)
    causas = dict(v.get("causas", {}))
    for chave in ("realizacao", "novoLancamento", "mudancaReal"):
        bloco = causas.get(chave)
        if isinstance(bloco, dict) and isinstance(bloco.get("itens"), list):
            b = dict(bloco)
            b["itensTotal"] = len(b["itens"])
            b["itens"] = b["itens"][:top_itens]
            causas[chave] = b
    v["causas"] = causas
    return v


def variacao_para_refs(
    extra_atual: dict[str, Any],
    mes_corrente: str,
    refs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Calcula a variação de cada ponto de referência -> hoje, para pré-gravar no
    pacote. `refs`: lista de {rotulo, data (iso), extra}. Ignora refs sem extra.
    """
    out: dict[str, Any] = {}
    for ref in refs:
        extra_ref = ref.get("extra")
        if not extra_ref:
            continue
        v = _compactar(montar_variacao(extra_ref, extra_atual, mes_corrente))
        v["refData"] = ref.get("data")
        v["refRotulo"] = ref.get("rotulo")
        out[ref["rotulo"]] = v
    return out


def _porcliente(extra: dict[str, Any]) -> dict[str, Any]:
    return extra.get("porCliente", {}) or {}


def montar_causas(
    extra_a: dict[str, Any],
    extra_b: dict[str, Any],
    mes_corrente: str,
    ano: int | None = None,
) -> dict[str, Any]:
    """Decompõe a variação do caixa acumulado de FIM DE ANO em CAUSAS, usando o
    detalhe por cliente (`porCliente`).

    Chave: no fim do ano, o que vale é o NET por (categoria, cliente). O vai-e-vem
    entre meses (timing/reprevisão) se cancela no net — então não muda o total do
    ano; é reportado à parte como contexto. O net que sobra é mudança REAL: ou um
    lançamento NOVO (cliente/categoria que não existia antes), ou um ganho/perda de
    quem já existia. O mês corrente entra como REALIZAÇÃO (ancorada no caixa real).

    Reconciliação: realizacao + ancoragem + novoLancamento + mudancaReal = Δ acum
    de fim de ano.
    """
    from collections import defaultdict

    ha, hb = _hist_por_mes(extra_a), _hist_por_mes(extra_b)
    if ano is None:
        ano = int(mes_corrente[:4])
    fim_ano = f"{ano}-12"
    meses = [f"{ano}-{i:02d}" for i in range(1, 13)]
    futuros = [m for m in meses if m > mes_corrente]
    fut_set = set(futuros)

    cma, cmb = extra_a.get("catmes", {}) or {}, extra_b.get("catmes", {}) or {}
    pca, pcb = _porcliente(extra_a), _porcliente(extra_b)

    SEM = "(sem detalhe por cliente)"
    # delta por (categoria, cliente) -> mês -> valor; residual por categoria fecha com catmes.
    deltas: dict[tuple[str, str], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for mes in meses:
        ca, cb = cma.get(mes, {}), cmb.get(mes, {})
        for cat in set(ca) | set(cb):
            pa = (pca.get(mes, {}) or {}).get(cat, {}) or {}
            pb = (pcb.get(mes, {}) or {}).get(cat, {}) or {}
            soma = 0.0
            for cli in set(pa) | set(pb):
                d = float(pb.get(cli, 0.0)) - float(pa.get(cli, 0.0))
                soma += d
                if abs(d) >= 0.005:
                    deltas[(cat, cli)][mes] += d
            resid = (float(cb.get(cat, 0.0)) - float(ca.get(cat, 0.0))) - soma
            if abs(resid) >= 0.005:
                deltas[(cat, SEM)][mes] += resid

    def _aFut(cat: str, cli: str) -> float:
        if cli == SEM:
            return sum(float((cma.get(m, {}) or {}).get(cat, 0.0)) for m in futuros)
        return sum(float((pca.get(m, {}) or {}).get(cat, {}).get(cli, 0.0)) for m in futuros)

    realizacao = {"total": 0.0, "itens": []}
    novo = {"total": 0.0, "itens": []}
    real = {"total": 0.0, "itens": []}
    timing_total = 0.0

    for (cat, cli), md in deltas.items():
        # mês corrente -> realização
        dcur = md.get(mes_corrente, 0.0)
        if abs(dcur) >= 0.005:
            realizacao["itens"].append({"categoria": cat, "cliente": cli, "delta": _r(dcur)})
            realizacao["total"] += dcur
        # meses futuros -> net (real) + timing (contexto)
        fut = [v for m, v in md.items() if m in fut_set]
        pos = sum(v for v in fut if v > 0)
        neg = -sum(v for v in fut if v < 0)
        timing_total += min(pos, neg)
        net = pos - neg
        if abs(net) >= 0.005:
            eh_novo = cli != SEM and abs(_aFut(cat, cli)) < 0.005
            alvo = novo if eh_novo else real
            alvo["itens"].append({"categoria": cat, "cliente": cli, "delta": _r(net)})
            alvo["total"] += net

    for b in (realizacao, novo, real):
        b["total"] = _r(b["total"])
        b["itens"].sort(key=lambda x: -abs(x["delta"]))

    # ancoragem: o acum do mês corrente é o caixa real, pode diferir da soma do catmes do mês.
    d_corrente_acum = _acum(hb, mes_corrente) - _acum(ha, mes_corrente)
    ancoragem = _r(d_corrente_acum - realizacao["total"])

    total_fim_ano = _r(_acum(hb, fim_ano) - _acum(ha, fim_ano))
    explicado = _r(realizacao["total"] + ancoragem + novo["total"] + real["total"])

    return {
        "fimAno": fim_ano,
        "deltaFimAno": total_fim_ano,
        "realizacao": realizacao,
        "ancoragem": ancoragem,
        "novoLancamento": novo,
        "mudancaReal": real,
        "deslocamentoTiming": _r(timing_total),
        "reconciliado": explicado,
        "residuo": _r(total_fim_ano - explicado),
    }
