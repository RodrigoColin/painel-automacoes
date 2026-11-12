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

from caixa.variacao import montar_variacao  # noqa: E402


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


if __name__ == "__main__":
    for nome, teste in list(globals().items()):
        if nome.startswith("teste_"):
            teste()
            print(f"ok  {nome}")
