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
        "reconciliacao": {
            "deltaCorrente": delta_corrente,
            "somaFuturos": soma_futuros,
            "fimAnoReconciliado": fim_ano_reconc,
            "residuoFimAno": residuo_fim_ano,
            "residuoPorMesFuturo": residuo_por_mes,
        },
    }
