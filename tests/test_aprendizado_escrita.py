"""Testes do aprendizado (regras + calibracao) e da escrita no Omie."""

from __future__ import annotations

import asyncio
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.conciliacao import (  # noqa: E402
    Config, Contexto, Desfecho, Faixa, LinhaExtrato, Natureza,
    RegraCliente, Titulo, conciliar,
)
from omie_mcp.conciliacao import aprendizado as ap  # noqa: E402
from omie_mcp.conciliacao import escrita_omie as eo  # noqa: E402

def gravar_sync(*args, **kwargs):
    """`eo.gravar` e async (o OmieClient real e async) — os testes aqui nao
    tem loop proprio, entao so rodam a corrotina ate o fim."""
    return asyncio.run(eo.gravar(*args, **kwargs))


falhas = []


def checar(nome, cond, detalhe=""):
    if cond:
        print(f"  ok   {nome}")
    else:
        print(f"  FALHA {nome} — {detalhe}")
        falhas.append(nome)


def linha(id, dia, valor, natureza, descricao, conta="cc-itau"):
    return LinhaExtrato(
        id=id, conta_id=conta, data=date(2026, 9, dia), valor=Decimal(valor),
        natureza=natureza, descricao=descricao, banco="itau",
    )


print("\n== A. Extracao do padrao estavel da descricao ==")
casos = [
    ("PIX ENVIADO 12/09 JOSE SILVA ME 123456", "JOSE SILVA"),
    ("PAGTO DELL NF 4471", "DELL"),
    ("DEBITO AUTOMATICO COPEL 1.234,56", "AUTOMATICO COPEL"),
    ("TED 20/09/2026 ACME CONSULTORIA LTDA", "ACME CONSULTORIA"),
]
for bruto, esperado in casos:
    obtido = ap.extrair_padrao(bruto)
    checar(f"'{bruto[:32]}...' -> {obtido}", obtido == esperado,
           f"esperado {esperado}")

print("\n== B. Decisao vira regra e reforca ==")
regras: list[RegraCliente] = []
for i, dia in enumerate((3, 10, 17), start=1):
    d = ap.Decisao(
        linha=linha(f"C{i}", dia, "450.00", Natureza.DEBITO,
                    f"DEBITO AUTOMATICO COPEL {dia}/09"),
        desfecho=Desfecho.LANCAMENTO_DIRETO,
        categoria="Energia Eletrica",
    )
    r = ap.registrar_decisao(d, regras)
checar("uma unica regra criada", len(regras) == 1, len(regras))
checar("3 confirmacoes", regras[0].confirmacoes == 3, regras[0].confirmacoes)
checar("categoria guardada", regras[0].categoria == "Energia Eletrica")

print("\n== C. A regra aprendida faz o motor decidir sozinho ==")
r = conciliar(
    Contexto(
        linhas=[linha("C4", 24, "450.00", Natureza.DEBITO,
                      "DEBITO AUTOMATICO COPEL 24/09")],
        titulos=[], regras=regras, hoje=date(2026, 9, 25),
    ),
    Config(),
)[0]
checar("desfecho pela regra", r.desfecho is Desfecho.LANCAMENTO_DIRETO, r.desfecho)
checar("automatica com 3 confirmacoes", r.faixa is Faixa.AUTOMATICO, r.faixa)
checar("categoria herdada", r.categoria_sugerida == "Energia Eletrica")

print("\n== D. Decisao que contraria a regra zera a confianca ==")
d = ap.Decisao(
    linha=linha("C5", 25, "450.00", Natureza.DEBITO, "DEBITO AUTOMATICO COPEL"),
    desfecho=Desfecho.TITULO, titulo_id="T99",
)
ap.registrar_decisao(d, regras)
checar("ainda uma regra", len(regras) == 1, len(regras))
checar("confianca zerada", regras[0].confirmacoes == 1, regras[0].confirmacoes)
checar("desfecho trocado", regras[0].desfecho is Desfecho.TITULO)

print("\n== E. Calibracao: retrabalho alto manda subir o corte ==")
def decisao_auto(id, confirma):
    ln = linha(id, 10, "100.00", Natureza.DEBITO, "X")
    tit = Titulo(id="T1", tipo="CP", vencimento=date(2026, 9, 10),
                 valor=Decimal("100"), parceiro_nome="X")
    from omie_mcp.conciliacao.modelos import Candidato, Resultado
    sug = Resultado(linha=ln, desfecho=Desfecho.TITULO, faixa=Faixa.AUTOMATICO,
                    score=95, candidato=Candidato(titulo=tit, score=95))
    return ap.Decisao(linha=ln, desfecho=Desfecho.TITULO,
                      titulo_id="T1" if confirma else "T2", sugestao_motor=sug)

cal = ap.calibrar([decisao_auto(f"D{i}", i < 15) for i in range(20)], corte_atual=90)
checar("retrabalho calculado", abs(cal.retrabalho - 0.25) < 0.01, cal.retrabalho)
checar("manda subir", "SUBIR" in cal.recomendacao, cal.recomendacao)
checar("corte sugerido 95", cal.corte_sugerido == 95, cal.corte_sugerido)

print("\n== F. Calibracao: revisao sempre confirmada manda baixar ==")
def decisao_rev(id, score):
    ln = linha(id, 10, "100.00", Natureza.DEBITO, "X")
    tit = Titulo(id="T1", tipo="CP", vencimento=date(2026, 9, 10),
                 valor=Decimal("100"), parceiro_nome="X")
    from omie_mcp.conciliacao.modelos import Candidato, Resultado
    sug = Resultado(linha=ln, desfecho=Desfecho.TITULO, faixa=Faixa.REVISAO,
                    score=score, candidato=Candidato(titulo=tit, score=score))
    return ap.Decisao(linha=ln, desfecho=Desfecho.TITULO, titulo_id="T1",
                      sugestao_motor=sug)

cal = ap.calibrar([decisao_rev(f"E{i}", 72 + i % 5) for i in range(25)], corte_atual=90)
checar("manda baixar", "BAIXAR" in cal.recomendacao, cal.recomendacao)
checar("corte no menor score confirmado", cal.corte_sugerido == 72, cal.corte_sugerido)

print("\n== G. Escrita: dry-run nao toca no ERP ==")
cfg = eo.ConfigEscrita(conta_corrente_omie="1628924843",
                       codigo_categoria_padrao="2.99.99")
resultados = conciliar(
    Contexto(
        linhas=[
            linha("G1", 10, "1500.00", Natureza.DEBITO, "PAGTO DELL NF 4471"),
            linha("G2", 12, "89.90", Natureza.DEBITO, "TAR PCT SERVICOS"),
            linha("G3", 16, "3200.00", Natureza.DEBITO, "PIX ENVIADO JOSE SILVA"),
        ],
        titulos=[Titulo(id="481", tipo="CP", vencimento=date(2026, 9, 10),
                        valor=Decimal("1500.00"),
                        parceiro_nome="DELL COMPUTADORES DO BRASIL LTDA",
                        numero_documento="4471")],
        hoje=date(2026, 9, 20),
    ),
    Config(),
)
falso = eo.ClienteFalso()
rel = gravar_sync(resultados, cfg, client=falso, executar=False)
checar("nada foi chamado", len(falso.chamadas) == 0, falso.chamadas)
checar("2 gravacoes planejadas", len(rel.planejadas) == 2, rel.resumo())
checar("a da fila foi pulada",
       any("fila" in m for _, m in rel.puladas), rel.puladas)

print("\n== H. Escrita: payloads corretos por desfecho ==")
por_op = {g.operacao: g for g in rel.planejadas}
checar("baixa de CP", "LancarPagamento" in por_op, list(por_op))
checar("lancamento direto", "IncluirLancCC" in por_op, list(por_op))
pg = por_op["LancarPagamento"]
checar("titulo certo no payload", pg.payload["codigo_lancamento"] == 481,
       pg.payload)
checar("data em dd/mm/aaaa", pg.payload["data"] == "10/09/2026", pg.payload["data"])
checar("conta corrente no payload",
       pg.payload["codigo_conta_corrente"] == 1628924843)
lc = por_op["IncluirLancCC"]
checar("tipo D na saida", lc.payload["cabecalho"]["cTipo"] == "D")
checar("categoria do dicionario",
       lc.payload["detalhes"]["cCodCateg"] == "Despesas Bancarias",
       lc.payload["detalhes"])
checar("auditoria: evidencias gravadas", len(pg.evidencias) > 0)

print("\n== I. Escrita: juros viram campo proprio na baixa ==")
rs = conciliar(
    Contexto(
        linhas=[linha("I1", 15, "1045.00", Natureza.DEBITO, "PAGTO BOLETO ACME")],
        titulos=[Titulo(id="900", tipo="CP", vencimento=date(2026, 9, 10),
                        valor=Decimal("1000.00"), parceiro_nome="ACME SERVICOS")],
        hoje=date(2026, 9, 20),
    ),
    Config(corte_automatico=60),
)
g = eo.planejar(rs[0], cfg)
checar("juros no payload", g.payload.get("juros") == 45.0, g.payload)
checar("sem desconto", "desconto" not in g.payload)

print("\n== J. Execucao real (cliente falso) + idempotencia ==")
ja = set()
rel = gravar_sync(resultados, cfg, client=falso, executar=True, ja_gravadas=ja)
checar("2 chamadas feitas", len(falso.chamadas) == 2, len(falso.chamadas))
checar("2 executadas", len(rel.executadas) == 2, rel.resumo())
checar("id do Omie capturado", all(g.id_omie for g in rel.executadas))
checar("chaves de idempotencia guardadas", len(ja) == 2, ja)

rel2 = gravar_sync(resultados, cfg, client=falso, executar=True, ja_gravadas=ja)
checar("segunda rodada nao regrava", len(rel2.executadas) == 0, rel2.resumo())
checar("total de chamadas segue 2", len(falso.chamadas) == 2, len(falso.chamadas))

print("\n== K. Falha do Omie nao derruba o lote ==")
falso2 = eo.ClienteFalso(falhar_em=["IncluirLancCC"])
rel3 = gravar_sync(resultados, cfg, client=falso2, executar=True, ja_gravadas=set())
checar("uma executada", len(rel3.executadas) == 1, rel3.resumo())
checar("uma falha registrada", len(rel3.falhas) == 1, rel3.resumo())
checar("erro descrito", "recusou" in (rel3.falhas[0].erro or ""), rel3.falhas[0].erro)

print("\n== L. Revisao nao grava sozinha ==")
rs = conciliar(
    Contexto(
        linhas=[linha("L1", 15, "4850.00", Natureza.CREDITO,
                      "CREDITO CLIENTE ALFA IRRF RETIDO")],
        titulos=[Titulo(id="700", tipo="CR", vencimento=date(2026, 9, 15),
                        valor=Decimal("5000.00"), parceiro_nome="CLIENTE ALFA LTDA")],
        hoje=date(2026, 9, 20),
    ),
    Config(),
)
checar("caiu em revisao", rs[0].faixa is Faixa.REVISAO, rs[0].faixa)
rel4 = gravar_sync(rs, cfg, client=eo.ClienteFalso(), executar=True)
checar("nao gravou", len(rel4.executadas) == 0, rel4.resumo())

print("\n== M. Round-trip das regras em JSON ==")
dados = ap.regras_para_json(regras)
voltou = ap.regras_de_json(dados)
checar("mesmo numero", len(voltou) == len(regras))
checar("mesmo padrao", voltou[0].padrao == regras[0].padrao)
checar("mesmo desfecho", voltou[0].desfecho is regras[0].desfecho)

print("\n" + "=" * 50)
if falhas:
    print(f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("Todos os testes passaram.")
