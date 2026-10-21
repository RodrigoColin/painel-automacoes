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


async def _listar_movimentos(client: OmieClient, params: dict[str, Any]) -> list[dict[str, Any]]:
    """Todas as páginas de ListarMovimentos com os filtros dados."""
    pagina = 1
    saida: list[dict[str, Any]] = []
    while True:
        r = await client.call(
            "financas/mf", "ListarMovimentos",
            params={"nPagina": pagina, "nRegPorPagina": 500, **params},
        )
        saida += r.get("movimentos") or []
        if pagina >= (r.get("nTotPaginas") or 1):
            return saida
        pagina += 1


async def _movimentos(client: OmieClient, tipo: str, de: str, ate: str) -> list[dict[str, Any]]:
    """Movimentos de um cTpLancamento no período (data de pagamento/crédito)."""
    return await _listar_movimentos(client, {"cTpLancamento": tipo, "dDtPagtoDe": de, "dDtPagtoAte": ate})


def _iso(data_br: str | None) -> str:
    """'13/07/2022' -> '2022-07-13' ('' se vier vazio/estranho)."""
    if not data_br or len(data_br) != 10:
        return ""
    return data_br[6:] + "-" + data_br[3:5] + "-" + data_br[:2]


def _e_receita_financeira(cat: Any) -> bool:
    """Receita financeira (DRE 1.02.xx: rendimento de aplicação, juros
    recebidos) NÃO é inadimplência de cliente — é a contrapartida de um crédito
    que o banco lançou (ex.: "REND PAGO APLIC", categoria 1.02.02). Entra no
    caixa como receita financeira, mas não é dívida a cobrar de ninguém, e o
    painel a exclui de propósito. Então o cruzamento de inadimplência tem que
    ignorá-la nos DOIS lados — senão a sombra acusa divergência eterna de um
    título que o painel (corretamente) nunca mostra. Mesmo espírito do
    "MANR sem NF fica fora" do lado do faturamento."""
    return str(cat or "").startswith("1.02")


def _conferir_inadimplencia(
    atrasados_omie: list[dict[str, Any]],
    receber_aberto: list[dict[str, Any]],
    hoje: date,
) -> dict[str, Any]:
    """Compara o CONJUNTO de títulos vencidos: painel (base receber_aberto,
    deduplicada por codigo_lancamento_omie — o rateio explode linhas) ×
    Omie (ListarMovimentos CR/ATRASADO, rota independente). Pega título
    sumido/duplicado, que valor nenhum pega. Valores são informativos: o
    painel mostra o LÍQUIDO (retenções descontadas), o Omie o bruto em
    aberto — comparar valor entre eles daria falso positivo."""
    hoje_iso = hoje.isoformat()

    omie: dict[int, dict[str, Any]] = {}
    for m in atrasados_omie:
        det = m.get("detalhes") or {}
        cod = det.get("nCodTitulo")
        aberto = float((m.get("resumo") or {}).get("nValAberto") or 0)
        if not cod or aberto <= 0.5:  # mesmo piso de centavos do lado do painel (abaixo)
            continue
        if _e_receita_financeira(det.get("cCodCateg")):
            continue  # rendimento de aplicação / juros não é dívida de cliente
        omie[int(cod)] = {
            "venc": _iso(det.get("dDtVenc")),
            "valorAberto": round(aberto, 2),
            "cliente": det.get("cCPFCNPJCliente") or "",
        }

    painel: dict[int, dict[str, Any]] = {}
    sem_codigo = 0
    for linha in receber_aberto:
        venc = str(linha.get("Vencimento") or "")[:10]
        aberto = float(linha.get("Valor da Conta") or 0) - float(linha.get("Recebido") or 0)
        if not venc or venc >= hoje_iso or aberto <= 0.5:
            continue
        if _e_receita_financeira(linha.get("Categoria")):
            continue  # simetria com o lado Omie: receita financeira fica fora
        cod = linha.get("codigo_lancamento_omie")
        if cod is None:
            sem_codigo += 1
            continue
        item = painel.setdefault(int(cod), {"venc": venc, "valorAberto": 0.0,
                                            "cliente": str(linha.get("Razão Social") or "")[:40]})
        item["valorAberto"] = round(item["valorAberto"] + aberto, 2)

    if sem_codigo and not painel:
        return {"status": "indisponivel",
                "nota": "base receber_aberto ainda sem codigo_lancamento_omie (pacote antigo)"}

    faltam = sorted(set(omie) - set(painel))
    sobram = sorted(set(painel) - set(omie))
    detalhe = lambda cods, lado: [  # noqa: E731
        {"codigo": c, **(omie.get(c) or painel.get(c) or {})} for c in cods[:10]
    ]
    status = "ok" if not faltam and not sobram else "divergente"
    return {
        "status": status,
        "titulosPainel": len(painel),
        "titulosOmie": len(omie),
        "vencidoPainel": round(sum(x["valorAberto"] for x in painel.values()), 2),
        "vencidoOmieBruto": round(sum(x["valorAberto"] for x in omie.values()), 2),
        "faltamNoPainel": detalhe(faltam, "omie"),
        "sobramNoPainel": detalhe(sobram, "painel"),
        "faltamTotal": len(faltam),
        "sobramTotal": len(sobram),
    }


async def conferir(
    settings: OmieSettings,
    bases: dict[str, Any],
    excluir_contas: set[int],
    hoje: date,
    fechamentos: dict[str, dict] | None = None,
) -> tuple[dict[str, Any], list[tuple[str, dict]]]:
    """Compara as bases do pacote com ListarMovimentos, mês fechado a mês
    fechado do ano corrente, e confronta os meses já CONGELADOS
    (`fechamentos`, de caixa_fechamento_mensal) com o Omie de agora para
    pegar reclassificação retroativa. Devolve (dict de `checagem.sombra`,
    meses a congelar como [("AAAA-MM", dados), ...])."""
    gerado_em = datetime.now().isoformat(timespec="seconds")
    fechamentos = fechamentos or {}
    ano = str(hoje.year)
    mes_cur = hoje.strftime("%Y-%m")
    if hoje.month == 1:
        return ({"geradoEm": gerado_em, "status": "ok", "meses": [],
                 "nota": "sem mês fechado no ano corrente ainda"}, [])

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
        atrasados = await _listar_movimentos(client, {"cTpLancamento": "CR", "cStatus": "ATRASADO"})

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

    # ---- reclassificação retroativa: Omie de agora × mês CONGELADO ----
    # O congelado é o lado Omie gravado na primeira rodada após o mês fechar
    # (caixa_fechamento_mensal). Mudou = alguém reclassificou no Omie depois.
    reclassificacoes: list[dict[str, Any]] = []
    for mes in meses:
        congelado = fechamentos.get(mes)
        if not congelado:
            continue
        for lado, atual, chave in (("ENT", ent_o[mes], "entPorCategoria"), ("SAI", sai_o[mes], "saiPorCategoria")):
            antes: dict[str, Any] = congelado.get(chave) or {}
            for cat in set(atual) | set(antes):
                dif = atual.get(cat, 0) - float(antes.get(cat, 0) or 0)
                if abs(dif) > TOLERANCIA:
                    reclassificacoes.append({
                        "mes": mes, "lado": lado, "categoria": cat,
                        "congelado": round(float(antes.get(cat, 0) or 0), 2),
                        "atual": round(atual.get(cat, 0), 2), "dif": round(dif, 2),
                    })
    reclassificacoes.sort(key=lambda d: -abs(d["dif"]))

    # ---- categoria nova: aparece no último mês fechado e em nenhum anterior ----
    novas: list[dict[str, Any]] = []
    if meses:
        ultimo = meses[-1]
        anteriores: set[str] = set()
        for mes in meses[:-1]:
            anteriores |= set(ent_o[mes]) | set(sai_o[mes])
        for dados in fechamentos.values():
            anteriores |= set(dados.get("entPorCategoria") or {}) | set(dados.get("saiPorCategoria") or {})
        for lado, agreg in (("ENT", ent_o[ultimo]), ("SAI", sai_o[ultimo])):
            for cat, valor in agreg.items():
                if cat not in anteriores and valor > TOLERANCIA:
                    novas.append({"mes": ultimo, "lado": lado, "categoria": cat, "valor": round(valor, 2)})

    # ---- meses fechados ainda sem snapshot → congelar (lado Omie) ----
    a_congelar: list[tuple[str, dict]] = [
        (mes, {
            "entPorCategoria": {c: round(v, 2) for c, v in ent_o[mes].items()},
            "saiPorCategoria": {c: round(v, 2) for c, v in sai_o[mes].items()},
            "totais": {"ent": round(sum(ent_o[mes].values()), 2), "sai": round(sum(sai_o[mes].values()), 2)},
            "fonte": "financas/mf ListarMovimentos (BX + CCE/CCS avulsos)",
            "congeladoEm": gerado_em,
        })
        for mes in meses if mes not in fechamentos
    ]

    # ---- resumo do último fechamento (p/ selo da tela, toda empresa) ----
    # Junta os já congelados com os que serão congelados nesta rodada e pega o
    # mês mais recente: é o "fechamento mensal automático" — nasce sozinho na
    # primeira rodada após o mês virar, sem ninguém pedir.
    ultimo_fechamento = None
    candidatos: dict[str, dict] = dict(fechamentos)
    candidatos.update({m: d for m, d in a_congelar})
    if candidatos:
        mes_f = max(candidatos)
        dados_f = candidatos[mes_f]
        tot_f = dados_f.get("totais") or {}
        ent_f = float(tot_f.get("ent") or 0)
        sai_f = float(tot_f.get("sai") or 0)
        ultimo_fechamento = {
            "mes": mes_f,
            "congeladoEm": dados_f.get("congeladoEm"),
            "ent": round(ent_f, 2),
            "sai": round(sai_f, 2),
            "resultado": round(ent_f - sai_f, 2),
            "congeladoAgora": any(m == mes_f for m, _ in a_congelar),
        }

    return ({
        "geradoEm": gerado_em,
        "fonte": "financas/mf ListarMovimentos (BX + CCE/CCS avulsos)",
        "janela": {"de": meses[0] if meses else None, "ate": meses[-1] if meses else None},
        "tolerancia": TOLERANCIA,
        "status": status,
        "meses": linhas_mes,
        "categoriasDivergentes": divergencias_cat[:_MAX_CATEGORIAS_LISTADAS],
        "categoriasDivergentesTotal": len(divergencias_cat),
        "reclassificacoesRetroativas": reclassificacoes[:_MAX_CATEGORIAS_LISTADAS],
        "reclassificacoesTotal": len(reclassificacoes),
        "categoriasNovas": novas,
        "ultimoFechamento": ultimo_fechamento,
        "inadimplencia": _conferir_inadimplencia(atrasados, bases.get("receber_aberto") or [], hoje),
        "movimentos": {"bx": len(bx), "cce": len(cce), "ccs": len(ccs)},
    }, a_congelar)
