"""
Testes do caixa/extra.py com um pacote sintético (sem rede, sem Omie).

Em 2026-09-29, antes de o build_extra_dashboard_caixa.py antigo sair do
repositório, esta função foi comparada número a número com ele (mesmo
pacote, configuração da Oystr): hist, catmes, inadimplência, atrasos,
acurácia e faturamento por linha bateram.

    python tests/test_caixa_extra.py
"""

from __future__ import annotations

import random
import sys
from datetime import date, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from caixa.extra import montar_extra  # noqa: E402

REF = date(2026, 9, 28)
ABERTURA_2025 = 774857.13
NOMES25 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
LINHAS_OYSTR = [
    {"nome": "RPA Recorrente", "termos": ["rpa recorrente"]},
    {"nome": "Presto Recorrente", "termos": ["presto recorrente"]},
    {"nome": "Excedentes", "termos": ["excedente"]},
    {"nome": "Projetos", "termos": ["execu", "desenvolv"]},
]


def iso(d: date) -> str:
    return d.isoformat()


def pacote_sintetico(rng: random.Random):
    clientes = [f"CLIENTE {c}" for c in "ABCDEFGHIJ"]
    fornecedores = ["FOLHA", "INSS GPS", "AWS", "BANCO", "CONTADOR"]
    cat_rec = ["RPA Recorrente", "Presto Recorrente", "RPA Excedentes", "Desenvolvimento", "Execucao Unica", ""]
    cat_pag = ["Salários", "INSS", "Software e licenças", "Tarifas bancárias", "13º Salário", "Aluguel", ""]

    rec, pag, ra, pa = [], [], [], []
    d = date(2025, 1, 2)
    while d <= REF - timedelta(days=1):
        for _ in range(rng.randint(0, 3)):
            venc = d - timedelta(days=rng.choice([0, 0, 0, 3, 10, 20, 45]))
            valor = round(rng.uniform(500, 30000), 2)
            rec.append({"Cliente": rng.choice(clientes), "Emissão": iso(venc - timedelta(days=15)),
                        "Vencimento": iso(venc), "Data de Crédito ou Débito (No Extrato)": iso(d),
                        "Categoria": rng.choice(cat_rec), "Documento": rng.choice(["Boleto", "PIX"]),
                        "Conta Corrente": "Itaú", "Valor da Conta": valor, "Recebido": valor})
        for _ in range(rng.randint(0, 3)):
            venc = d - timedelta(days=rng.choice([0, 0, 2, 7]))
            valor = round(rng.uniform(200, 25000), 2)
            pag.append({"Fornecedor": rng.choice(fornecedores), "Emissão": iso(venc - timedelta(days=10)),
                        "Vencimento": iso(venc), "Data de Crédito ou Débito (No Extrato)": iso(d),
                        "Categoria": rng.choice(cat_pag), "Documento": "Boleto", "Conta Corrente": "Itaú",
                        "Valor da Conta": valor, "Valor Pago": valor})
        d += timedelta(days=1)

    for _ in range(60):  # em aberto: vencidos (inclusive de 2025) e a vencer
        venc = REF + timedelta(days=rng.randint(-400, 90))
        valor = round(rng.uniform(300, 20000), 2)
        ra.append({"Razão Social": rng.choice(clientes), "CNPJ/CPF": "", "Emissão": iso(venc - timedelta(days=20)),
                   "Vencimento": iso(venc), "Categoria": rng.choice(cat_rec), "Documento": rng.choice(["Boleto", "PIX"]),
                   "Conta Corrente": "Itaú", "Valor da Conta": valor,
                   "Recebido": rng.choice([0, 0, 0, round(valor / 3, 2)]), "Previsão": iso(venc)})
    for _ in range(40):
        venc = REF + timedelta(days=rng.randint(-20, 90))
        valor = round(rng.uniform(300, 40000), 2)
        prev = venc + timedelta(days=rng.choice([0, 0, 3]))
        pa.append({"Razão Social": rng.choice(fornecedores), "CNPJ/CPF": "", "Emissão": iso(venc - timedelta(days=5)),
                   "Vencimento": iso(venc), "Categoria": rng.choice(cat_pag), "Documento": "Boleto",
                   "Conta Corrente": "Itaú", "Valor da Conta": valor, "Valor Pago": 0, "Previsão": iso(prev)})

    cnf = [{"Razão Social": rng.choice(clientes), "CNPJ/CPF": "", "Contrato": str(i), "Categoria": "RPA Recorrente",
            "Valor Mensal": round(rng.uniform(1000, 9000), 2),
            "Data Prevista": iso(REF + timedelta(days=rng.randint(1, 90)))} for i in range(25)]
    osn = [{"Razão Social": rng.choice(clientes), "CNPJ/CPF": "", "OS": str(i), "Categoria": "Desenvolvimento",
            "Valor": round(rng.uniform(1000, 9000), 2),
            "Data Prevista": iso(REF + timedelta(days=rng.randint(1, 60)))} for i in range(8)]
    sc = [{"Cliente": c, "nCodCli": i, "nCodCtr": i, "cCodSit (cru)": "10", "Status mapeado": "Ativo",
           "Valor Mensal (R$)": round(rng.uniform(1000, 9000), 2), "Vigência Início": None, "Vigência Fim": None}
          for i, c in enumerate(clientes[:6])]

    inicio, fim = REF - timedelta(days=7), REF + timedelta(days=45)
    dias, movimentos, dia = [], [], inicio
    saldo = 300000.0
    while dia <= fim:
        tipo = "realizado" if dia < REF else "hoje" if dia == REF else "previsto"
        e, s = round(rng.uniform(0, 60000), 2), round(rng.uniform(0, 50000), 2)
        saldo += e - s
        dias.append({"data": iso(dia), "tipo": tipo, "entradas": e, "saidas": s, "saldo": round(saldo, 2)})
        dia += timedelta(days=1)
    for cat, valor, realizado in [("RPA Recorrente", 12000.0, False), ("Salários", -8000.0, False),
                                  ("INSS", -3000.0, False), ("RPA Recorrente", 5000.0, True)]:
        movimentos.append({"id": cat, "data": iso(REF), "vencimento": iso(REF), "conta": 1628924843, "nome": "X",
                           "categoria": cat, "documento": "", "origem": "Conta a Receber", "valor": valor,
                           "realizado": realizado})
    extrato = {"hoje": iso(REF), "consultadoEm": f"{iso(REF)}T10:00:00-03:00", "saldoMinimo": None,
               "contas": [{"codigo": 1628924843, "descricao": "Itaú", "tipo": "corrente", "limite": 61500,
                           "saldo": 250000.0, "somaNoCaixa": True, "conciliadoAte": iso(REF), "pendentesConciliacao": 0}],
               "dias": dias, "movimentos": movimentos, "caixaProprio": 250000.0, "limiteLivre": 0,
               "abertura": ABERTURA_2025, "avisos": []}

    hist25, acum = [], ABERTURA_2025
    for i in range(12):
        ent, sai = round(rng.uniform(500000, 900000), 2), round(rng.uniform(450000, 880000), 2)
        acum += ent - sai
        hist25.append({"mes": f"{NOMES25[i]}/25", "ent": ent, "sai": sai, "acum": round(acum, 2)})

    bases = {"recebimentos": rec, "pagamentos": pag, "receber_aberto": ra, "pagar_aberto": pa,
             "contratos_nao_faturados": cnf, "os_nao_faturadas": osn, "status_contratos": sc}
    return bases, extrato, hist25


def perto(a, b, rotulo: str) -> None:
    assert abs(float(a) - float(b)) < 0.02, f"{rotulo}: esperado {a} x obtido {b}"


def teste_historico_fixo_prevalece() -> None:
    """Meses em historico_fixo (o 2025 conferido da Oystr) valem mais que o cálculo."""
    bases, extrato, hist25 = pacote_sintetico(random.Random(42))
    fixo = [{"mes": f"2025-{i + 1:02d}", "ent": h["ent"], "sai": h["sai"], "acum": h["acum"]} for i, h in enumerate(hist25)]
    novo = montar_extra(bases, extrato, iso(REF), historico_fixo=fixo, linhas_receita=LINHAS_OYSTR)
    dez = next(h for h in novo["hist"] if h["mes"] == "2025-12")
    perto(hist25[-1]["acum"], dez["acum"], "acumulado de dez/25")
    jan26 = next(h for h in novo["hist"] if h["mes"] == "2026-01")
    perto(dez["acum"] + jan26["ent"] - jan26["sai"], jan26["acum"], "jan/26 encadeia do 2025 fixo")
    assert set(novo["faturamentoPorLinha"]["linhas"]) <= {l["nome"] for l in LINHAS_OYSTR} | {"Outras receitas"}


def teste_empresa_sem_historico_fixo() -> None:
    """Sem 2025 fixo, o ano anterior é calculado pelas bases a partir da abertura."""
    rng = random.Random(7)
    bases, extrato, _ = pacote_sintetico(rng)
    novo = montar_extra(bases, extrato, iso(REF))
    jan = novo["hist"][0]
    assert jan["mes"] == "2025-01" and jan["status"] == "fechado"
    perto(jan["acum"], ABERTURA_2025 + jan["ent"] - jan["sai"], "acumulado de jan/25")
    atual = next(h for h in novo["hist"] if h["status"] == "em_curso")
    assert atual["mes"] == "2026-09"
    # Sem linhas configuradas: só recorrente x outras.
    assert set(novo["faturamentoPorLinha"]["linhas"]) <= {"Receita recorrente", "Outras receitas"}
    p = novo["parametros"]
    assert 0.5 <= p["recEfetivo"] <= 1.0
    assert len(p["padraoIntramensal"]) == 31
    assert p["cenarios"]["pessimista"]["frac"] >= p["cenarios"]["conservador"]["frac"]


def teste_bases_vazias() -> None:
    """Empresa nova, sem título nenhum: não pode quebrar."""
    _, extrato, _ = pacote_sintetico(random.Random(1))
    vazio = {k: [] for k in ("recebimentos", "pagamentos", "receber_aberto", "pagar_aberto",
                             "contratos_nao_faturados", "os_nao_faturadas", "status_contratos")}
    novo = montar_extra(vazio, extrato, iso(REF))
    assert novo["inad"]["total"] == 0 and novo["inad"]["top"] == []
    assert novo["parametros"]["recEfetivo"] == 1.0


if __name__ == "__main__":
    for nome, teste in list(globals().items()):
        if nome.startswith("teste_"):
            teste()
            print(f"ok  {nome}")
