"""
Testes do motor de variação (caixa/variacao.py), com dois snapshots `extra`
montados à mão — verdade conhecida, para provar a RECONCILIAÇÃO.

    python tests/test_variacao.py
"""
from __future__ import annotations

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from caixa.variacao import montar_causas, montar_variacao, variacao_para_refs  # noqa: E402


def _hist(mes, ent, sai, acum, status="projetado"):
    return {"mes": mes, "ent": ent, "sai": sai, "saldo": ent - sai, "acum": acum, "status": status, "fat": ent}


def perto(a, b, rotulo):
    assert abs(float(a) - float(b)) < 0.02, f"{rotulo}: esperado {a} x obtido {b}"


# Snapshot A (mais antigo): set corrente acum 300; out/nov/dez projetados.
EXTRA_A = {
    "hist": [
        _hist("2026-09", 100, 120, 300, "em_curso"),
        _hist("2026-10", 100, 110, 290),
        _hist("2026-11", 100, 130, 260),
        _hist("2026-12", 100, 140, 220),
    ],
    "catmes": {
        "2026-10": {"RPA Recorrente": 100, "Salarios": -110},
        "2026-11": {"RPA Recorrente": 100, "Salarios": -130},
        "2026-12": {"RPA Recorrente": 100, "Salarios": -140},
    },
}

# Snapshot B (mais recente): recebeu +10 no mês corrente; +20 de receita nova em nov;
# rescisão nova de -50 em dez. Nada mais mudou.
EXTRA_B = {
    "hist": [
        _hist("2026-09", 100, 120, 310, "em_curso"),
        _hist("2026-10", 100, 110, 300),
        _hist("2026-11", 120, 130, 290),
        _hist("2026-12", 100, 190, 200),
    ],
    "catmes": {
        "2026-10": {"RPA Recorrente": 100, "Salarios": -110},
        "2026-11": {"RPA Recorrente": 120, "Salarios": -130},
        "2026-12": {"RPA Recorrente": 100, "Salarios": -140, "Rescisoes": -50},
    },
}


def teste_alvos_fim_mes_e_fim_ano():
    v = montar_variacao(EXTRA_A, EXTRA_B, "2026-09")
    perto(v["alvos"]["2026-09"]["delta"], 10, "delta do mês corrente (set)")
    perto(v["alvos"]["2026-12"]["delta"], -20, "delta de fim de ano (dez)")
    assert v["fimAno"] == "2026-12"


def teste_reconciliacao_fecha():
    """A soma das partes TEM de bater com a variação total (MECE) — a trava do motor."""
    v = montar_variacao(EXTRA_A, EXTRA_B, "2026-09")
    r = v["reconciliacao"]
    # fim de ano = delta do corrente + soma dos resultados futuros
    perto(r["deltaCorrente"], 10, "delta corrente")
    perto(r["somaFuturos"], -30, "soma dos futuros (+20 nov, -50 dez)")
    perto(r["fimAnoReconciliado"], -20, "fim de ano reconciliado")
    perto(r["residuoFimAno"], 0, "resíduo de fim de ano (tem de ser 0)")
    # cada mês futuro reconcilia com a soma das suas categorias
    assert r["residuoPorMesFuturo"] == [], f"meses futuros não fecharam: {r['residuoPorMesFuturo']}"


def teste_por_mes():
    v = montar_variacao(EXTRA_A, EXTRA_B, "2026-09")
    por_mes = {p["mes"]: p for p in v["porMes"]}
    perto(por_mes["2026-09"]["delta"], 10, "set (corrente)")
    assert "2026-10" not in por_mes, "outubro não mudou, não deveria aparecer"
    perto(por_mes["2026-11"]["delta"], 20, "nov (+20 receita nova)")
    perto(por_mes["2026-12"]["delta"], -50, "dez (-50 rescisão)")
    assert por_mes["2026-11"]["tipo"] == "futuro"


def teste_por_categoria():
    v = montar_variacao(EXTRA_A, EXTRA_B, "2026-09")
    cats = {(c["mes"], c["categoria"]): c["delta"] for c in v["porCategoria"]}
    perto(cats[("2026-11", "RPA Recorrente")], 20, "receita nova de nov por categoria")
    perto(cats[("2026-12", "Rescisoes")], -50, "rescisão nova de dez por categoria")
    # categorias sem mudança não entram
    assert ("2026-10", "RPA Recorrente") not in cats
    assert ("2026-12", "Salarios") not in cats


# ---------------------------------------------------------------------------
# Incremento 2: classificação por CAUSA (com porCliente).
# Cenário (set corrente; out/nov/dez futuros):
#   ALFA  — RPA move de out(15) p/ nov(15)        -> TIMING (net 0)
#   OMNI  — RPA aparece em nov(+20), não existia   -> NOVO lançamento (receita)
#   BETA  — RPA em dez cai de 100 p/ 80            -> MUDANÇA REAL (perda -20)
#   FULANO— Rescisões em dez(-50), nova            -> NOVO lançamento (despesa)
#   GAMA  — RPA no mês corrente sobe 50->60        -> REALIZAÇÃO (+10)
# Δ acum fim de ano esperado: -40 (realização +10, novo -30, mudança real -20).
PC_A = {
    "hist": [
        _hist("2026-09", 0, 0, 300, "em_curso"),
        _hist("2026-10", 15, 0, 315),
        _hist("2026-11", 0, 0, 315),
        _hist("2026-12", 100, 140, 275),
    ],
    "catmes": {
        "2026-09": {"RPA Recorrente": 50},
        "2026-10": {"RPA Recorrente": 15},
        "2026-12": {"RPA Recorrente": 100, "Salarios": -140},
    },
    "porCliente": {
        "2026-09": {"RPA Recorrente": {"GAMA": 50}},
        "2026-10": {"RPA Recorrente": {"ALFA": 15}},
        "2026-12": {"RPA Recorrente": {"BETA": 100}, "Salarios": {"FOLHA": -140}},
    },
}
PC_B = {
    "hist": [
        _hist("2026-09", 0, 0, 310, "em_curso"),
        _hist("2026-10", 0, 0, 310),
        _hist("2026-11", 35, 0, 345),
        _hist("2026-12", 80, 190, 235),
    ],
    "catmes": {
        "2026-09": {"RPA Recorrente": 60},
        "2026-11": {"RPA Recorrente": 35},
        "2026-12": {"RPA Recorrente": 80, "Salarios": -140, "Rescisoes": -50},
    },
    "porCliente": {
        "2026-09": {"RPA Recorrente": {"GAMA": 60}},
        "2026-11": {"RPA Recorrente": {"ALFA": 15, "OMNI": 20}},
        "2026-12": {"RPA Recorrente": {"BETA": 80}, "Salarios": {"FOLHA": -140}, "Rescisoes": {"FULANO": -50}},
    },
}


def teste_causas_reconciliam():
    c = montar_causas(PC_A, PC_B, "2026-09")
    perto(c["deltaFimAno"], -40, "Δ acum fim de ano")
    perto(c["realizacao"]["total"], 10, "realização (mês corrente)")
    perto(c["ancoragem"], 0, "ancoragem (catmes bate com acum)")
    perto(c["novoLancamento"]["total"], -30, "novos lançamentos (OMNI +20, FULANO -50)")
    perto(c["mudancaReal"]["total"], -20, "mudança real (BETA -20)")
    perto(c["deslocamentoTiming"], 15, "timing (ALFA moveu 15 out->nov)")
    perto(c["residuo"], 0, "resíduo (tudo explicado)")


def _clientes_de(bloco, categoria):
    for it in bloco["itens"]:
        if it["categoria"] == categoria:
            return {c["cliente"] for c in it["clientes"]}
    return set()


def teste_causas_timing_nao_e_novo_nem_perda():
    """ALFA só mudou de mês — não pode virar nem novo nem mudança real."""
    c = montar_causas(PC_A, PC_B, "2026-09")
    assert "ALFA" not in _clientes_de(c["novoLancamento"], "RPA Recorrente")
    assert "ALFA" not in _clientes_de(c["mudancaReal"], "RPA Recorrente")
    assert "OMNI" in _clientes_de(c["novoLancamento"], "RPA Recorrente"), "OMNI deveria ser novo lançamento"
    assert "FULANO" in _clientes_de(c["novoLancamento"], "Rescisoes"), "FULANO (rescisão) deveria ser novo"
    assert "BETA" in _clientes_de(c["mudancaReal"], "RPA Recorrente"), "BETA deveria ser mudança real"
    # itens por categoria: a soma dos deltas das categorias = total da causa (reconciliação da tela)
    for causa in ("realizacao", "novoLancamento", "mudancaReal"):
        soma = sum(i["delta"] for i in c[causa]["itens"])
        perto(soma, c[causa]["total"], f"{causa}: soma das categorias = total")


def teste_variacao_embute_causas():
    """montar_variacao expõe o bloco de causas já reconciliado."""
    v = montar_variacao(PC_A, PC_B, "2026-09")
    assert "causas" in v
    perto(v["causas"]["residuo"], 0, "causas reconciliam dentro de montar_variacao")


def teste_itens_tem_natureza_e_timing_detalhado():
    """Cada categoria de causa diz se é receita ou despesa; o timing lista cliente e de→para."""
    c = montar_causas(PC_A, PC_B, "2026-09")
    por_cat = {i["categoria"]: i for b in (c["novoLancamento"], c["mudancaReal"]) for i in b["itens"]}
    assert por_cat["RPA Recorrente"]["natureza"] == "receita"
    assert por_cat["Rescisoes"]["natureza"] == "despesa"
    ti = c["deslocamentoTimingItens"]
    assert len(ti) == 1 and ti[0]["cliente"] == "ALFA"
    perto(ti[0]["valor"], 15, "valor do timing do ALFA")
    assert ti[0]["de"] == "2026-10" and ti[0]["para"] == "2026-11", f"de/para errados: {ti[0]}"


# Timing CROSS-MÊS (corrente → futuro), padrão PEREIRA out→nov: o título sai do mês
# corrente (realização negativa) e reaparece num mês futuro no mesmo valor. O net do ano
# é zero — o timing detalhado tem de apontar o cliente e o de→para mesmo assim.
TIM_A = {
    "hist": [_hist("2026-09", 30, 0, 300, "em_curso"), _hist("2026-12", 0, 0, 300)],
    "catmes": {"2026-09": {"RPA Recorrente": 30}},
    "porCliente": {"2026-09": {"RPA Recorrente": {"MOVE": 30}}},
}
TIM_B = {
    "hist": [_hist("2026-09", 10, 0, 280, "em_curso"), _hist("2026-12", 20, 0, 300)],
    "catmes": {"2026-09": {"RPA Recorrente": 10}, "2026-12": {"RPA Recorrente": 20}},
    "porCliente": {"2026-09": {"RPA Recorrente": {"MOVE": 10}}, "2026-12": {"RPA Recorrente": {"MOVE": 20}}},
}


def teste_timing_cross_mes_corrente_para_futuro():
    c = montar_causas(TIM_A, TIM_B, "2026-09")
    perto(c["deltaFimAno"], 0, "fim de ano não muda (só timing)")
    perto(c["residuo"], 0, "reconcilia")
    ti = c["deslocamentoTimingItens"]
    assert len(ti) == 1 and ti[0]["cliente"] == "MOVE"
    perto(ti[0]["valor"], 20, "valor movido")
    assert ti[0]["de"] == "2026-09" and ti[0]["para"] == "2026-12"


# Timing de DESPESA: a seta inverte — o pagamento sai do mês cuja saída DIMINUIU e vai
# para o mês cuja saída AUMENTOU. Caso: pagamento de FOLHA que estava em nov passa p/ dez.
TIMD_A = {
    "hist": [_hist("2026-09", 0, 0, 300, "em_curso"), _hist("2026-11", 0, 10, 290), _hist("2026-12", 0, 0, 290)],
    "catmes": {"2026-11": {"Salarios": -10}},
    "porCliente": {"2026-11": {"Salarios": {"FOLHA": -10}}},
}
TIMD_B = {
    "hist": [_hist("2026-09", 0, 0, 300, "em_curso"), _hist("2026-11", 0, 0, 300), _hist("2026-12", 0, 10, 290)],
    "catmes": {"2026-12": {"Salarios": -10}},
    "porCliente": {"2026-12": {"Salarios": {"FOLHA": -10}}},
}


def teste_timing_despesa_seta_e_totais_por_natureza():
    c = montar_causas(TIMD_A, TIMD_B, "2026-09")
    ti = c["deslocamentoTimingItens"]
    assert len(ti) == 1 and ti[0]["natureza"] == "despesa"
    assert ti[0]["de"] == "2026-11" and ti[0]["para"] == "2026-12", f"seta de despesa errada: {ti[0]}"
    perto(c["deslocamentoTimingPagamentos"], 10, "total de pagamentos movidos")
    perto(c["deslocamentoTimingRecebimentos"], 0, "sem recebimento movido")


# Incremento 3: a causa PREMISSA (regra do dashboard) e o número "com regra".
# Único que muda de A->B é a média (catBase: 80 -> 100). Os títulos são iguais, então o
# delta "sem regra" é 0; toda a variação "com regra" (+20) vem da premissa.
RULE_A = {
    "hist": [_hist("2026-11", 0, 0, 100, "em_curso"), _hist("2026-12", 50, 0, 150)],
    "catmes": {"2026-12": {"RPA Recorrente": 50}},
    "catBase": {"RPA Recorrente": 80},
    "parametros": {"recEfetivo": 1.0},
}
RULE_B = {
    "hist": [_hist("2026-11", 0, 0, 100, "em_curso"), _hist("2026-12", 50, 0, 150)],
    "catmes": {"2026-12": {"RPA Recorrente": 50}},
    "catBase": {"RPA Recorrente": 100},
    "parametros": {"recEfetivo": 1.0},
}


def teste_premissa_e_numero_com_regra():
    v = montar_variacao(RULE_A, RULE_B, "2026-11")
    # sem regra: títulos iguais -> 0; com regra (média rolou 80->100): +20
    perto(v["alvos"]["2026-12"]["delta"], 0, "delta sem regra (títulos iguais)")
    perto(v["alvos"]["2026-12"]["deltaComRegra"], 20, "delta COM regra (média rolou)")
    c = v["causas"]
    perto(c["premissa"], 20, "causa premissa")
    perto(c["deltaFimAnoComRegra"], 20, "fim de ano com regra")
    perto(c["residuo"], 0, "reconcilia com a premissa incluída")


def teste_premissa_zero_sem_catbase():
    """Sem catBase/parametros (pacote simples), a regra não muda nada -> premissa 0 e os
    dois números (com e sem regra) coincidem."""
    c = montar_causas(PC_A, PC_B, "2026-09")
    perto(c["premissa"], 0, "sem catBase não há premissa")
    perto(c["deltaFimAnoComRegra"], c["deltaFimAno"], "com e sem regra coincidem")


def teste_variacao_para_refs_compacta_e_reconcilia():
    """O que vai pré-gravado no pacote: compacto, rotulado, e ainda reconcilia."""
    refs = [
        {"rotulo": "7d", "data": "2026-09-20", "extra": PC_A},
        {"rotulo": "15d", "data": "2026-09-12", "extra": None},  # ref sem snapshot: ignorada
    ]
    out = variacao_para_refs(PC_B, "2026-09", refs)
    assert set(out) == {"7d"}, "ref sem extra não deve entrar"
    assert out["7d"]["refData"] == "2026-09-20" and out["7d"]["refRotulo"] == "7d"
    perto(out["7d"]["causas"]["residuo"], 0, "reconcilia após compactar")
    assert "porCategoriaTotal" in out["7d"], "guarda o total mesmo truncando a lista"


if __name__ == "__main__":
    for nome, teste in list(globals().items()):
        if nome.startswith("teste_"):
            teste()
            print(f"ok  {nome}")
