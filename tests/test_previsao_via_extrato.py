"""
Teste sintético (sem rede) da nova arquitetura de projeção via
`ListarExtrato` (bug #7, 2026-08-13) — valida
`montar_contratos_nao_faturados_via_extrato()` e
`montar_os_nao_faturadas_via_extrato()` em
omie_mcp/reports/oystr_diagnostico.py usando os movimentos REAIS
dumpados por `scripts/debug_extrato_previsoes.py` (colados pelo Rodrigo
em 2026-08-13) para os dois clientes que motivaram a mudança:

- NANTES E MELLO: 3 ocorrências "Previsão de Contratos Mensais"
  (25/08, 25/09, 26/10 — a de outubro já ajustada pelo próprio Omie
  pra pular o fim de semana de 25/10, que caiu num domingo).
- PEREIRA GIONEDIS ADVOGADOS: o caso que expôs o bug real — o contrato
  2 (nCodLancamento=1860491405, R$17.791,54) estava sendo EXCLUÍDO de
  agosto pela lógica antiga (cNumeroContrato batendo com uma OS
  Adicional avulsa). Aqui ele deve aparecer normalmente em 28/08 e
  28/09, junto com o contrato 1 (1860490812, R$14.939,05) e o
  contrato 3 (2484448964, R$3.000,00, só a partir de 25/09 — não
  apareceu em agosto no dump real, consistente com a vigência/período
  buscado).
- NOBREGA FARIAS ADVOGADOS ASSOCIADOS: exemplo REAL de
  `cOrigem="Previsão de Ordem de Serviço"` (colado 2026-08-13, pedido
  ao Rodrigo especificamente pra confirmar esse shape, que até então só
  tinha sido visto em contagem). Confirmou o schema E revelou um achado
  real: a coluna "OS" deve usar `cNumero` (o número reconhecível na
  tela do Omie, "OS N° 18336"), não `nCodLancamento` (código interno de
  lançamento contábil, sem relação com o número da OS visível).

Rodar: python -m pytest tests/test_previsao_via_extrato.py -v
   ou: python tests/test_previsao_via_extrato.py
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.reports.oystr_diagnostico import (  # noqa: E402
    montar_contratos_nao_faturados_via_extrato,
    montar_os_nao_faturadas_via_extrato,
)

# -----------------------------------------------------------------------
# Movimentos REAIS colados pelo Rodrigo (debug_extrato_previsoes.py,
# 2026-08-13) — só os campos que a função usa foram mantidos.
# -----------------------------------------------------------------------

MOV_NANTES_AGO = {
    "cOrigem": "Previsão de Contratos Mensais",
    "cRazCliente": "NANTES E MELLO SOCIEDADE DE ADVOGADOS",
    "cDocCliente": "33.439.443/0001-32",
    "dDataLancamento": "25/08/2026",
    "nCodLancamento": 2524205639,
    "nValorDocumento": 2000,
    "cDesCategoria": "RPA Recorrente",
}
MOV_NANTES_SET = {**MOV_NANTES_AGO, "dDataLancamento": "25/09/2026"}
MOV_NANTES_OUT = {**MOV_NANTES_AGO, "dDataLancamento": "26/10/2026"}  # domingo 25/10 ajustado

MOV_PEREIRA_C1_AGO = {
    "cOrigem": "Previsão de Contratos Mensais",
    "cRazCliente": "PEREIRA GIONEDIS ADVOGADOS",
    "cDocCliente": "81.908.543/0001-03",
    "dDataLancamento": "28/08/2026",
    "nCodLancamento": 1860490812,
    "nValorDocumento": 14939.05,
    "cDesCategoria": "Presto Recorrente",
}
MOV_PEREIRA_C2_AGO = {
    # ESTE é o título que a lógica antiga excluía de agosto — bug real
    # que motivou a reescrita (ver docstring do módulo).
    **MOV_PEREIRA_C1_AGO,
    "nCodLancamento": 1860491405,
    "nValorDocumento": 17791.54,
}
MOV_PEREIRA_C1_SET = {**MOV_PEREIRA_C1_AGO, "dDataLancamento": "28/09/2026"}
MOV_PEREIRA_C2_SET = {**MOV_PEREIRA_C2_AGO, "dDataLancamento": "28/09/2026"}
MOV_PEREIRA_C3_SET = {
    **MOV_PEREIRA_C1_AGO,
    "nCodLancamento": 2484448964,
    "nValorDocumento": 3000,
    "dDataLancamento": "25/09/2026",
}

TODOS_CONTRATOS_MENSAIS = [
    MOV_NANTES_AGO, MOV_NANTES_SET, MOV_NANTES_OUT,
    MOV_PEREIRA_C1_AGO, MOV_PEREIRA_C2_AGO,
    MOV_PEREIRA_C1_SET, MOV_PEREIRA_C2_SET, MOV_PEREIRA_C3_SET,
]

# Movimento REAL colado pelo Rodrigo em 2026-08-13
# (debug_extrato_previsoes.py --busca "NOBREGA FARIAS") — confirma o
# shape de "Previsão de Ordem de Serviço" e, principalmente, que
# "cNumero" (não "nCodLancamento") é o número da OS reconhecível na
# tela do Omie ("OS N° 18336").
MOV_OS_NOBREGA_FARIAS = {
    "cCodCategoria": "1.01.01",
    "cDesCategoria": "RPA Recorrente",
    "cDesCliente": "NOBREGA FARIAS ADVOGADOS ASSOCIADOS",
    "cRazCliente": "NOBREGA FARIAS ADVOGADOS ASSOCIADOS",
    "cDocCliente": "03.672.963/0001-20",
    "cNatureza": "R",
    "cNumero": "18336",
    "cOrigem": "Previsão de Ordem de Serviço",
    "cSituacao": "Previsto",
    "cTipoDocumento": "Ordem de Serviço",
    "dDataLancamento": "13/08/2026",
    "nCodCliente": 1835266040,
    "nCodLancamento": 2541385746,
    "nValorDocumento": 5505.83,
}

# Movimento sintético SEM cNumero, pra confirmar o fallback pro código
# interno de lançamento quando o número "amigável" da OS não vier.
MOV_OS_SEM_NUMERO = {
    "cOrigem": "Previsão de Ordem de Serviço",
    "cRazCliente": "PEREIRA GIONEDIS ADVOGADOS",
    "cDocCliente": "81.908.543/0001-03",
    "dDataLancamento": "10/08/2026",
    "nCodLancamento": 9999999999,
    "nValorDocumento": 17791.54,
    "cDesCategoria": "OS Adicional de Contrato",
}


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print(f"  OK: {msg}")


def testar_nantes():
    print("\n=== NANTES E MELLO (3 meses, ago/set/out) ===")
    linhas = montar_contratos_nao_faturados_via_extrato(TODOS_CONTRATOS_MENSAIS)
    nantes = [l for l in linhas if "NANTES" in (l["Razão Social"] or "")]
    _assert(len(nantes) == 3, f"3 linhas de NANTES (achou {len(nantes)})")
    datas = sorted(l["Data Prevista"].strftime("%d/%m/%Y") for l in nantes)
    _assert(datas == ["25/08/2026", "25/09/2026", "26/10/2026"],
            f"datas corretas, incluindo o ajuste de fim de semana em outubro (achou {datas})")
    _assert(all(l["Valor Mensal"] == 2000.0 for l in nantes),
            "todos os 3 valores = R$2.000,00")


def testar_pereira_gionedis():
    print("\n=== PEREIRA GIONEDIS (o bug real: contrato 2 sumia de agosto) ===")
    linhas = montar_contratos_nao_faturados_via_extrato(TODOS_CONTRATOS_MENSAIS)
    pereira = [l for l in linhas if "PEREIRA" in (l["Razão Social"] or "")]
    _assert(len(pereira) == 5,
            f"5 linhas de PEREIRA GIONEDIS (2 contratos x ago+set, + contrato 3 só em set) "
            f"(achou {len(pereira)})")

    pereira_ago = [l for l in pereira if l["Data Prevista"].month == 8]
    _assert(len(pereira_ago) == 2, f"2 linhas em agosto (achou {len(pereira_ago)})")
    valores_ago = sorted(l["Valor Mensal"] for l in pereira_ago)
    _assert(valores_ago == [14939.05, 17791.54],
            f"agosto tem AMBOS os contratos, incluindo o R$17.791,54 que o bug antigo "
            f"excluía (achou {valores_ago})")

    pereira_set = [l for l in pereira if l["Data Prevista"].month == 9]
    _assert(len(pereira_set) == 3, f"3 linhas em setembro (achou {len(pereira_set)})")
    valores_set = sorted(l["Valor Mensal"] for l in pereira_set)
    _assert(valores_set == [3000.0, 14939.05, 17791.54],
            f"setembro tem os 3 contratos (achou {valores_set})")


def testar_os_nao_faturadas_nobrega_farias():
    print("\n=== OS Nao Faturadas — NOBREGA FARIAS (dado REAL, 2026-08-13) ===")
    linhas = montar_os_nao_faturadas_via_extrato([MOV_OS_NOBREGA_FARIAS])
    _assert(len(linhas) == 1, f"1 linha montada (achou {len(linhas)})")
    l = linhas[0]
    _assert(l["Razão Social"] == "NOBREGA FARIAS ADVOGADOS ASSOCIADOS", "Razão Social correta")
    _assert(l["CNPJ/CPF"] == "03.672.963/0001-20", "CNPJ correto")
    _assert(l["OS"] == "18336",
            f"coluna OS usa cNumero (\"18336\", o número visível na tela do Omie), "
            f"NÃO nCodLancamento (2541385746, código interno) (achou {l['OS']!r})")
    _assert(l["Categoria"] == "RPA Recorrente", "Categoria correta")
    _assert(l["Valor"] == 5505.83, f"Valor correto (achou {l['Valor']})")
    _assert(l["Data Prevista"] == datetime(2026, 8, 13), "Data Prevista correta")


def testar_os_nao_faturadas_fallback_sem_numero():
    print("\n=== OS Nao Faturadas — fallback pro código interno quando cNumero ausente ===")
    linhas = montar_os_nao_faturadas_via_extrato([MOV_OS_SEM_NUMERO])
    _assert(len(linhas) == 1, f"1 linha montada (achou {len(linhas)})")
    l = linhas[0]
    _assert(l["OS"] == 9999999999,
            f"sem cNumero, cai no fallback pro nCodLancamento (achou {l['OS']!r})")
    _assert(l["Valor"] == 17791.54, f"Valor correto (achou {l['Valor']})")


def testar_movimento_sem_data_e_ignorado():
    print("\n=== Movimento com dDataLancamento inválido/ausente é descartado, não quebra ===")
    mov_invalido = {**MOV_NANTES_AGO, "dDataLancamento": None}
    linhas = montar_contratos_nao_faturados_via_extrato([mov_invalido])
    _assert(linhas == [], f"lista vazia, sem exceção (achou {linhas})")


if __name__ == "__main__":
    testar_nantes()
    testar_pereira_gionedis()
    testar_os_nao_faturadas_nobrega_farias()
    testar_os_nao_faturadas_fallback_sem_numero()
    testar_movimento_sem_data_e_ignorado()
    print("\n" + "=" * 70)
    print("TODOS OS TESTES PASSARAM.")
