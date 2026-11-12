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

import re
from typing import Any

_RATEIO = re.compile(r"([^;()]+?)\s*\(([\d.,]+)%\)")


def _dividir_categoria(texto: str) -> list[tuple[str, float]]:
    """Porte de grupos.ts::dividirCategoria — 'A (60%); B (40%)' -> [(A,0.6),(B,0.4)]."""
    partes = _RATEIO.findall(str(texto))
    if not partes:
        return [(str(texto), 1.0)]
    return [(nome.strip(), float(peso.replace(",", ".")) / 100) for nome, peso in partes]


def _catmes_ajustado(extra: dict[str, Any], mes: str, mes_cur: str) -> dict[str, float]:
    """Porte de calculos.ts::catmesAjustado — a 'regra do dashboard'. Para meses FUTUROS,
    completa cada categoria de receita até a média (catBase) × recebimento efetivo. Mês
    corrente e fechados voltam como estão. É o que faz o número bater com a tela."""
    base = dict((extra.get("catmes", {}) or {}).get(mes, {}))
    if mes <= mes_cur:
        return base
    ja: dict[str, float] = {}
    for c, v in base.items():
        if v > 0:
            for cn, p in _dividir_categoria(c):
                ja[cn] = ja.get(cn, 0.0) + v * p
    rec_ef = float((extra.get("parametros", {}) or {}).get("recEfetivo", 1.0) or 1.0)
    for cn, media in (extra.get("catBase", {}) or {}).items():
        falta = float(media) * rec_ef - ja.get(cn, 0.0)
        if falta > 0:
            base[cn] = base.get(cn, 0.0) + falta
    return base


def _acum_com_regra(extra: dict[str, Any], alvo: str, mes_cur: str, ano: int) -> float:
    """Caixa acumulado no fim de `alvo` COM a regra do dashboard (o número que a tela
    mostra): ancora no acum real do mês corrente e encadeia os meses futuros pela
    projeção ajustada. Para `alvo` <= mês corrente, é o próprio acum do hist."""
    hist = _hist_por_mes(extra)
    if alvo <= mes_cur:
        return _acum(hist, alvo)
    acum = _acum(hist, mes_cur)
    for i in range(1, 13):
        m = f"{ano}-{i:02d}"
        if m <= mes_cur or m > alvo:
            continue
        acum += sum(_catmes_ajustado(extra, m, mes_cur).values())
    return acum


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
    # "comRegra" = com a regra do dashboard aplicada (o número que a tela mostra); o sem
    # sufixo é a base de títulos pura (o que o motor decompõe por causa). A diferença entre
    # os dois é a causa "premissa" (ver montar_causas).
    alvos: dict[str, dict[str, float]] = {}
    for mes in (mes_corrente, fim_ano):
        a, b = _acum(ha, mes), _acum(hb, mes)
        ar = _acum_com_regra(extra_a, mes, mes_corrente, ano)
        br = _acum_com_regra(extra_b, mes, mes_corrente, ano)
        alvos[mes] = {
            "acumA": _r(a), "acumB": _r(b), "delta": _r(b - a),
            "acumAComRegra": _r(ar), "acumBComRegra": _r(br), "deltaComRegra": _r(br - ar),
        }

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
    ti = causas.get("deslocamentoTimingItens")
    if isinstance(ti, list):
        causas["deslocamentoTimingItensTotal"] = len(ti)
        causas["deslocamentoTimingItens"] = ti[:top_itens]
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

    def _natureza(cat: str) -> str:
        """Receita ou despesa, pelo sinal da categoria nos dois snapshots (a soma do ano)."""
        tot = 0.0
        for m in meses:
            tot += float((cmb.get(m, {}) or {}).get(cat, 0.0)) + float((cma.get(m, {}) or {}).get(cat, 0.0))
        if abs(tot) < 0.005:
            return "receita"
        return "receita" if tot > 0 else "despesa"

    realizacao = {"total": 0.0, "itens": []}
    novo = {"total": 0.0, "itens": []}
    real = {"total": 0.0, "itens": []}
    timing_total = 0.0
    timing_itens: list[dict[str, Any]] = []

    for (cat, cli), md in deltas.items():
        nat = _natureza(cat)
        # mês corrente -> realização
        dcur = md.get(mes_corrente, 0.0)
        if abs(dcur) >= 0.005:
            realizacao["itens"].append({"categoria": cat, "cliente": cli, "delta": _r(dcur), "natureza": nat})
            realizacao["total"] += dcur
        # meses futuros -> net (real) + timing (contexto)
        fut = [v for m, v in md.items() if m in fut_set]
        pos = sum(v for v in fut if v > 0)
        neg = -sum(v for v in fut if v < 0)
        net = pos - neg
        if abs(net) >= 0.005:
            eh_novo = cli != SEM and abs(_aFut(cat, cli)) < 0.005
            alvo = novo if eh_novo else real
            alvo["itens"].append({"categoria": cat, "cliente": cli, "delta": _r(net), "natureza": nat})
            alvo["total"] += net
        # timing: vai-e-vem entre meses QUAISQUER (corrente incluso) que se cancela no ano —
        # ex.: título que escorregou de out p/ nov. Só contexto, não entra na soma das causas.
        pos_t = sum(v for v in md.values() if v > 0)
        neg_t = -sum(v for v in md.values() if v < 0)
        t = min(pos_t, neg_t)
        timing_total += t
        if t >= 0.005:
            de = min(md, key=lambda m: md[m])    # mês que mais perdeu
            para = max(md, key=lambda m: md[m])  # mês que mais ganhou
            timing_itens.append({"categoria": cat, "cliente": cli, "valor": _r(t), "de": de, "para": para, "natureza": nat})

    for b in (realizacao, novo, real):
        b["total"] = _r(b["total"])
        b["itens"].sort(key=lambda x: -abs(x["delta"]))
    timing_itens.sort(key=lambda x: -x["valor"])

    # ancoragem: o acum do mês corrente é o caixa real, pode diferir da soma do catmes do mês.
    d_corrente_acum = _acum(hb, mes_corrente) - _acum(ha, mes_corrente)
    ancoragem = _r(d_corrente_acum - realizacao["total"])

    total_fim_ano = _r(_acum(hb, fim_ano) - _acum(ha, fim_ano))
    explicado = _r(realizacao["total"] + ancoragem + novo["total"] + real["total"])

    # premissa: mudança da contribuição da REGRA DO DASHBOARD (a média de 6 meses rolou, o
    # recebimento efetivo mudou). É a ponte entre a base de títulos (sem regra) e o número
    # que a tela mostra (com regra).
    topup_a = _acum_com_regra(extra_a, fim_ano, mes_corrente, ano) - _acum(ha, fim_ano)
    topup_b = _acum_com_regra(extra_b, fim_ano, mes_corrente, ano) - _acum(hb, fim_ano)
    premissa = _r(topup_b - topup_a)
    delta_com_regra = _r(total_fim_ano + premissa)

    return {
        "fimAno": fim_ano,
        "deltaFimAno": total_fim_ano,
        "deltaFimAnoComRegra": delta_com_regra,
        "realizacao": realizacao,
        "ancoragem": ancoragem,
        "novoLancamento": novo,
        "mudancaReal": real,
        "premissa": premissa,
        "deslocamentoTiming": _r(timing_total),
        "deslocamentoTimingItens": timing_itens,
        "reconciliado": _r(explicado + premissa),
        "residuo": _r(delta_com_regra - (explicado + premissa)),
    }
