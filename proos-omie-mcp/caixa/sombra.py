"""
Conferência SOMBRA: valida o pacote recém-montado contra uma leitura
INDEPENDENTE do Omie — `financas/mf/ListarMovimentos` (BX = baixas de
títulos; CCE/CCS = lançamentos avulsos de conta corrente). É outro endpoint
e outra agregação que os das bases (contareceber/contapagar + lançamentos
CC), então um bug de completude num lado não se repete no outro.

Dois níveis, desenho validado no F0 de 07/10/2026 (scripts/
f0_sombra_prototipo.py no repo de desenvolvimento):

1. TOTAIS de entradas/saídas por mês fechado do ano corrente: têm de bater
   no centavo (tolerância R$ 1). Nos 9 meses fechados de 2026 bateu 0,00 em
   todos. É o detector de buraco de completude (lançamento perdido, conta
   errada, tipo de avulso novo).

2. POR CATEGORIA: a baixa (BX) carrega UMA categoria por movimento — não
   reparte título com rateio de `categorias[]` (o painel reparte, igual ao
   relatório "Fluxo de Caixa por Categoria" do Omie). Divergência por
   categoria que SE CANCELA dentro do mês é essa redistribuição esperada →
   vira "rateio_info" (informativo). Se o nível 1 estourar, é "divergente".

Quem chama (caixa/rodada.py) captura qualquer exceção e grava status
"erro" — a sombra nunca derruba a rodada.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from omie_mcp.client import OmieClient
from omie_mcp.config import OmieSettings

TOLERANCIA = 1.0  # R$ por mês/categoria (arredondamentos)
_MAX_CATEGORIAS_LISTADAS = 20


async def _movimentos(client: OmieClient, tipo: str, de: str, ate: str) -> list[dict[str, Any]]:
    """Todas as páginas de ListarMovimentos de um cTpLancamento no período
    (filtro por data de pagamento/crédito)."""
    pagina = 1
    saida: list[dict[str, Any]] = []
    while True:
        r = await client.call(
            "financas/mf", "ListarMovimentos",
            params={
                "nPagina": pagina, "nRegPorPagina": 500, "cTpLancamento": tipo,
                "dDtPagtoDe": de, "dDtPagtoAte": ate,
            },
        )
        saida += r.get("movimentos") or []
        if pagina >= (r.get("nTotPaginas") or 1):
            return saida
        pagina += 1


async def conferir(
    settings: OmieSettings,
    bases: dict[str, Any],
    excluir_contas: set[int],
    hoje: date,
) -> dict[str, Any]:
    """Compara as bases do pacote com ListarMovimentos, mês fechado a mês
    fechado do ano corrente. Devolve o dict que vai em `checagem.sombra`."""
    gerado_em = datetime.now().isoformat(timespec="seconds")
    ano = str(hoje.year)
    mes_cur = hoje.strftime("%Y-%m")
    if hoje.month == 1:
        return {"geradoEm": gerado_em, "status": "ok", "meses": [],
                "nota": "sem mês fechado no ano corrente ainda"}

    de = f"01/01/{ano}"
    ate = (date(hoje.year, hoje.month, 1) - timedelta(days=1)).strftime("%d/%m/%Y")

    async with OmieClient(settings) as client:
        categorias = await client.call_paginated(
            "geral/categorias", "ListarCategorias", params={},
            records_key=["categoria_cadastro", "cadastros"],
        )
        nome = {c.get("codigo"): c.get("descricao", c.get("codigo")) for c in categorias}
        bx = await _movimentos(client, "BX", de, ate)
        cce = await _movimentos(client, "CCE", de, ate)
        ccs = await _movimentos(client, "CCS", de, ate)

    # ---- lado Omie (independente) ----
    ent_o: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    sai_o: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for origem, movs in (("BX", bx), ("CCE", cce), ("CCS", ccs)):
        for m in movs:
            det = m.get("detalhes") or {}
            valor = (m.get("resumo") or {}).get("nValPago") or det.get("nValorMovCC") or 0
            if not valor or det.get("nCodCC") in excluir_contas:
                continue
            cat = det.get("cCodCateg") or ""
            if origem != "BX":
                if det.get("nCodBaixa") or det.get("nCodTitulo"):
                    continue  # mesma baixa já veio no BX — não duplicar
                if not cat or cat.startswith("0."):
                    continue  # transferência entre contas próprias / sem categoria
            dt = det.get("dDtPagamento") or det.get("dDtCredito") or ""
            if len(dt) != 10:
                continue
            mes = dt[6:] + "-" + dt[3:5]
            if not mes.startswith(ano) or mes >= mes_cur:
                continue
            natureza = det.get("cNatureza") or ("R" if origem == "CCE" else "P")
            alvo = ent_o if natureza == "R" else sai_o
            alvo[mes][nome.get(cat, cat)] += abs(float(valor))

    # ---- lado painel (bases do pacote) ----
    ent_p: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    sai_p: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for linha in bases.get("recebimentos") or []:
        mes = str(linha.get("Data de Crédito ou Débito (No Extrato)") or "")[:7]
        if mes.startswith(ano) and mes < mes_cur:
            ent_p[mes][str(linha.get("Categoria") or "")] += float(linha.get("Recebido") or 0)
    for linha in bases.get("pagamentos") or []:
        mes = str(linha.get("Data de Crédito ou Débito (No Extrato)") or "")[:7]
        if mes.startswith(ano) and mes < mes_cur:
            sai_p[mes][str(linha.get("Categoria") or "")] += float(linha.get("Valor Pago") or 0)

    # ---- comparação ----
    meses = sorted(set(ent_o) | set(sai_o) | set(ent_p) | set(sai_p))
    linhas_mes: list[dict[str, Any]] = []
    divergencias_cat: list[dict[str, Any]] = []
    for mes in meses:
        e_p = sum(ent_p[mes].values()); e_o = sum(ent_o[mes].values())
        s_p = sum(sai_p[mes].values()); s_o = sum(sai_o[mes].values())
        linhas_mes.append({
            "mes": mes,
            "entPainel": round(e_p, 2), "entOmie": round(e_o, 2), "difEnt": round(e_p - e_o, 2),
            "saiPainel": round(s_p, 2), "saiOmie": round(s_o, 2), "difSai": round(s_p - s_o, 2),
        })
        for lado, painel, omie in (("ENT", ent_p[mes], ent_o[mes]), ("SAI", sai_p[mes], sai_o[mes])):
            for cat in set(painel) | set(omie):
                dif = painel.get(cat, 0) - omie.get(cat, 0)
                if abs(dif) > TOLERANCIA:
                    divergencias_cat.append({
                        "mes": mes, "lado": lado, "categoria": cat,
                        "painel": round(painel.get(cat, 0), 2),
                        "omie": round(omie.get(cat, 0), 2), "dif": round(dif, 2),
                    })

    estourou_total = any(
        abs(l["difEnt"]) > TOLERANCIA or abs(l["difSai"]) > TOLERANCIA for l in linhas_mes
    )
    status = "divergente" if estourou_total else ("rateio_info" if divergencias_cat else "ok")
    divergencias_cat.sort(key=lambda d: -abs(d["dif"]))

    return {
        "geradoEm": gerado_em,
        "fonte": "financas/mf ListarMovimentos (BX + CCE/CCS avulsos)",
        "janela": {"de": meses[0] if meses else None, "ate": meses[-1] if meses else None},
        "tolerancia": TOLERANCIA,
        "status": status,
        "meses": linhas_mes,
        "categoriasDivergentes": divergencias_cat[:_MAX_CATEGORIAS_LISTADAS],
        "categoriasDivergentesTotal": len(divergencias_cat),
        "movimentos": {"bx": len(bx), "cce": len(cce), "ccs": len(ccs)},
    }
