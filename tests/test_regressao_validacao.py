"""Regressao das falhas encontradas na validacao adversarial de 2026-09-20.

Cada caso aqui foi um bug real confirmado antes da correcao. Se algum voltar a
falhar, e regressao — nao mexer no teste, mexer no motor.
"""
from __future__ import annotations
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from omie_mcp.conciliacao import *  # noqa
from omie_mcp.conciliacao import aprendizado as ap, escrita_omie as eo, ofx

falhas = []
def checar(n, c, d=""):
    print(("  ok   " if c else "  FALHA ") + n + ("" if c else f" — {d}"))
    if not c: falhas.append(n)
def L(id,dia,v,nat,desc,conta="A",**k):
    return LinhaExtrato(id=id,conta_id=conta,data=date(2026,9,dia),valor=Decimal(v),natureza=nat,descricao=desc,banco="itau",**k)
def T(id,tipo,dia,v,p,**k):
    return Titulo(id=id,tipo=tipo,vencimento=date(2026,9,dia),valor=Decimal(v),parceiro_nome=p,**k)
def run(ls,ts=(),**k): return conciliar(Contexto(linhas=ls,titulos=list(ts),hoje=date(2026,9,20),**k),Config())

print("\nF1. Valores proximos em contas diferentes NAO sao transferencia")
rs=run([L("a",10,"1000.00",Natureza.DEBITO,"PAGTO FORNECEDOR X",conta="A"),
        L("b",10,"1010.00",Natureza.CREDITO,"PIX RECEBIDO CLIENTE Y",conta="B")],
       [T("t1","CP",10,"1000.00","FORNECEDOR X"),T("t2","CR",10,"1010.00","CLIENTE Y")])
checar("cada linha casou com seu titulo", all(r.desfecho is Desfecho.TITULO for r in rs), [r.desfecho.value for r in rs])

print("\nF2. Valor exato igual sem indicio: titulo ganha; sem titulo vira REVISAO, nunca automatico")
rs=run([L("a",10,"5000.00",Natureza.DEBITO,"PAGTO ALUGUEL IMOBILIARIA",conta="A"),
        L("b",10,"5000.00",Natureza.CREDITO,"TED RECEBIDA CLIENTE Z",conta="B")],
       [T("t1","CP",10,"5000.00","IMOBILIARIA"),T("t2","CR",10,"5000.00","CLIENTE Z")])
checar("titulos prevalecem", all(r.desfecho is Desfecho.TITULO for r in rs), [r.desfecho.value for r in rs])
rs=run([L("a",10,"5000.00",Natureza.DEBITO,"PAGTO",conta="A"),
        L("b",10,"5000.00",Natureza.CREDITO,"CREDITO",conta="B")])
checar("sem titulo e sem indicio -> transferencia em revisao",
       rs[0].desfecho is Desfecho.TRANSFERENCIA and rs[0].faixa is Faixa.REVISAO, (rs[0].desfecho, rs[0].faixa))

print("\nF2b. Com indicio textual continua automatico")
rs=run([L("a",10,"5000.00",Natureza.DEBITO,"TRANSF ENTRE CONTAS",conta="A"),
        L("b",10,"5000.00",Natureza.CREDITO,"CREDITO",conta="B")])
checar("automatico", rs[0].faixa is Faixa.AUTOMATICO, rs[0].faixa)

print("\nF2c. Contraparte = CNPJ da propria empresa conta como indicio")
rs=run([L("a",10,"5000.00",Natureza.DEBITO,"PIX ENVIADO",conta="A",contraparte_documento="11.222.333/0001-44"),
        L("b",10,"5000.00",Natureza.CREDITO,"PIX RECEBIDO",conta="B")], documento_empresa="11222333000144")
checar("automatico via CNPJ proprio", rs[0].desfecho is Desfecho.TRANSFERENCIA and rs[0].faixa is Faixa.AUTOMATICO, (rs[0].desfecho, rs[0].faixa))

print("\nF3. Regra de lancamento direto NAO ignora titulo existente")
rs=run([L("a",10,"450.00",Natureza.DEBITO,"DEBITO AUTOMATICO COPEL")],
       [T("t1","CP",10,"450.00","COPEL DISTRIBUICAO")],
       regras=[RegraCliente(padrao="COPEL",desfecho=Desfecho.LANCAMENTO_DIRETO,categoria="Energia",confirmacoes=5)])
checar("titulo prevalece", rs[0].desfecho is Desfecho.TITULO and rs[0].candidato.titulo.id=="t1", rs[0].desfecho)
rs=run([L("a",10,"450.00",Natureza.DEBITO,"DEBITO AUTOMATICO COPEL")],
       regras=[RegraCliente(padrao="COPEL",desfecho=Desfecho.LANCAMENTO_DIRETO,categoria="Energia",confirmacoes=5)])
checar("sem titulo, regra decide", rs[0].desfecho is Desfecho.LANCAMENTO_DIRETO and rs[0].faixa is Faixa.AUTOMATICO)

print("\nF4. Regra casa por palavra inteira")
rs=run([L("a",10,"300.00",Natureza.DEBITO,"PAGTO MODELLO MOVEIS")],
       regras=[RegraCliente(padrao="DELL",desfecho=Desfecho.LANCAMENTO_DIRETO,categoria="TI",confirmacoes=5)])
checar("'DELL' nao casa 'MODELLO'", rs[0].desfecho is Desfecho.FILA, rs[0].desfecho)

print("\nF5. Regra de TITULO nao curto-circuita; vira bonus de parceiro")
regras=[RegraCliente(padrao="ACME",desfecho=Desfecho.TITULO,confirmacoes=5)]
rs=run([L("a",10,"700.00",Natureza.DEBITO,"PAGTO ACME")],
       [T("t7","CP",10,"700.00","ACME LTDA"),T("t8","CP",10,"700.00","BETA LTDA")],regras=regras)
checar("candidato real escolhido", rs[0].candidato is not None and rs[0].candidato.titulo.id=="t7", rs[0].candidato)
checar("bonus de regra aplicado", any(e.nome=="regra_parceiro" for e in rs[0].candidato.evidencias))
checar("desempatou a ambiguidade", rs[0].tipo_excecao is None, rs[0].tipo_excecao)

print("\nF6. Pagamento parcial vai para revisao, titulo fica disponivel")
rs=run([L("a",10,"500.00",Natureza.DEBITO,"PAGTO PARCIAL ACME")],[T("t1","CP",10,"1000.00","ACME SERVICOS")])
checar("titulo em revisao", rs[0].desfecho is Desfecho.TITULO and rs[0].faixa is Faixa.REVISAO, (rs[0].desfecho, rs[0].faixa))
checar("explicado como parcial", rs[0].candidato.explicacao_diferenca=="pagamento parcial")
checar("parcial irrisorio (5%) nao e candidato",
       run([L("b",10,"50.00",Natureza.DEBITO,"PAGTO ACME")],[T("t1","CP",10,"1000.00","ACME SERVICOS")])[0].desfecho is Desfecho.FILA)

print("\nF8. Titulo pre-selecionado em revisao nao e oferecido duas vezes")
rs=run([L("a",12,"1045.00",Natureza.DEBITO,"PAGTO BOLETO ACME"),L("b",13,"1045.00",Natureza.DEBITO,"PAGTO BOLETO ACME")],[T("t1","CP",10,"1000.00","ACME SERVICOS")])
checar("primeira em revisao com t1", rs[0].faixa is Faixa.REVISAO and rs[0].candidato.titulo.id=="t1")
checar("segunda NAO recebe t1 (ja reservado)", rs[1].candidato is None or rs[1].candidato.titulo.id!="t1", rs[1].candidato)

print("\nF9. FITID repetido em transacoes distintas nao perde linha")
o="""<OFX><STMTTRN><DTPOSTED>20260910<TRNAMT>-10.00<FITID>X<MEMO>A</STMTTRN>
<STMTTRN><DTPOSTED>20260910<TRNAMT>-20.00<FITID>X<MEMO>B</STMTTRN>
<STMTTRN><DTPOSTED>20260910<TRNAMT>-20.00<FITID>X<MEMO>B</STMTTRN></OFX>"""
ls=ofx.ler_texto(o,"c")
checar("2 linhas (3a e duplicata real)", len(ls)==2, len(ls))
checar("ids unicos", len({l.id for l in ls})==2, [l.id for l in ls])

print("\nF11. Segunda ponta da transferencia nao pode virar titulo por coincidencia")
rs=run(
    [L("a",12,"50000.00",Natureza.DEBITO,"TRANSF ENTRE CONTAS",conta="A"),
     L("b",12,"50000.00",Natureza.CREDITO,"TRANSF ENTRE CONTAS",conta="B")],
    [T("t1","CR",12,"50000.00","QUALQUER CLIENTE")],
)
checar("primeira linha e transferencia", rs[0].desfecho is Desfecho.TRANSFERENCIA, rs[0].desfecho)
checar("segunda linha continua transferencia (nao vira titulo por coincidencia de valor)",
       rs[1].desfecho is Desfecho.TRANSFERENCIA, rs[1].desfecho)
checar("segunda linha nao consumiu o titulo", rs[1].candidato is None, rs[1].candidato)
checar("destino da segunda linha aponta de volta pra primeira conta",
       rs[1].conta_destino_id == "A", rs[1].conta_destino_id)

print("\nF12. Titulo parcial fica disponivel so pelo saldo restante")
rs=run(
    [L("a",10,"700.00",Natureza.DEBITO,"PAGTO PARCIAL ACME 1"),
     L("b",10,"300.00",Natureza.DEBITO,"PAGTO PARCIAL ACME 2"),
     L("c",10,"999.00",Natureza.DEBITO,"PAGTO PARCIAL ACME 3")],
    [T("t1","CP",10,"1000.00","ACME SERVICOS")],
)
checar("primeira linha casa parcial (700 de 1000)",
       rs[0].desfecho is Desfecho.TITULO and rs[0].candidato.parcial,
       (rs[0].desfecho, rs[0].candidato))
checar("segunda linha fecha o SALDO restante (300), nao os 1000 cheios",
       rs[1].desfecho is Desfecho.TITULO and rs[1].candidato is not None
       and rs[1].candidato.diferenca == Decimal("0"),
       (rs[1].desfecho, rs[1].candidato.diferenca if rs[1].candidato else None))
checar("titulo esgotado: terceira linha nao encontra mais candidato (sem baixa acima do total)",
       rs[2].candidato is None, rs[2].candidato)

print("\nF13. Deteccao de termo fiscal exige palavra inteira")
from omie_mcp.conciliacao.motor import _explicar_diferenca  # noqa: E402
linha_falso_positivo = L("x", 10, "950.00", Natureza.DEBITO, "PAGTO COMISSAO VENDEDOR")
checar("'ISS' dentro de 'COMISSAO' NAO explica retencao (era falso positivo)",
       _explicar_diferenca(Decimal("-50"), linha_falso_positivo, 0) is None)
linha_termo_real = L("y", 10, "950.00", Natureza.DEBITO, "PAGTO COM RETENCAO DE ISS")
checar("'ISS' como palavra inteira continua explicando retencao",
       _explicar_diferenca(Decimal("-50"), linha_termo_real, 0) == "retencao de imposto na fonte")

print("\nF14. CHECKNUM (numero de controle do banco) nao e confundido com CPF/CNPJ")
o_checknum = """<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260803<TRNAMT>-640.00
<FITID>20260803001<CHECKNUM>20260803001<MEMO>PIX ENVIADO W&R 49.165.796/0001-21</STMTTRN></OFX>"""
ls_checknum = ofx.ler_texto(o_checknum, "c")
checar("CNPJ do MEMO extraido, nao o CHECKNUM (que por coincidencia tem 11 digitos)",
       ls_checknum[0].contraparte_documento == "49.165.796/0001-21",
       ls_checknum[0].contraparte_documento)

print("\nF15. CPF colado sem pontuacao no nome do titulo nao rebaixa o match de nome")
from omie_mcp.conciliacao.motor import _similaridade_nome  # noqa: E402
# Dado sintetico — o padrao real (nome de PF + CPF colado sem pontuacao no
# cadastro, formatado com pontuacao na descricao do banco) foi confirmado
# rodando ao vivo contra a Proos em 2026-09-21; nome/CPF aqui sao fake.
linha_fake = L("z", 5, "4200.00", Natureza.DEBITO,
               "PIX ENVIADO FULANO DA SILVA SOUZA 026.074.391-75")
sim = _similaridade_nome("FULANO DA SILVA SOUZA 02607439175", linha_fake)
checar("nome bate 100% mesmo com o CPF formatado diferente",
       sim == 1.0, sim)

print("\nF16. Cascata de parceiro: pagamento parcelado drena fila de titulos")
# Caso real (achado com dado sintetico, padrao confirmado com a Proos em
# 2026-09-21): distribuicao de lucro/pro-labore paga em parcelas ao longo do
# mes contra uma fila de titulos do mesmo parceiro+categoria — cada parcela
# drena o mais antigo aberto ate zerar, o excedente segue pro proximo.
titulos_cascata = [
    T("c1", "CP", 1, "3000.00", "FULANO DE TAL", categoria="2.08.99"),
    T("c2", "CP", 10, "3000.00", "FULANO DE TAL", categoria="2.08.99"),
    T("c3", "CP", 20, "3000.00", "FULANO DE TAL", categoria="2.08.99"),
]
rs = run(
    [L("p1", 3, "3000.00", Natureza.DEBITO, "PIX ENVIADO FULANO DE TAL"),
     L("p2", 12, "4500.00", Natureza.DEBITO, "PIX ENVIADO FULANO DE TAL")],
    titulos_cascata,
)
checar("primeira parcela fecha exata com o titulo mais antigo (sem precisar de cascata)",
       rs[0].desfecho is Desfecho.TITULO and rs[0].candidato.titulo.id == "c1"
       and len(rs[0].candidato.cascata) == 0, rs[0].candidato)
checar("segunda parcela (maior que um titulo) dreno em cascata: c2 inteiro + parte de c3",
       rs[1].desfecho is Desfecho.TITULO and len(rs[1].candidato.cascata) == 2, rs[1].candidato)
if rs[1].candidato and len(rs[1].candidato.cascata) == 2:
    checar("cascata drena o mais antigo (c2) primeiro, ate zerar",
           rs[1].candidato.cascata[0].titulo.id == "c2"
           and rs[1].candidato.cascata[0].valor == Decimal("3000.00"),
           rs[1].candidato.cascata)
    checar("excedente vai pro proximo da fila (c3), so pela diferenca",
           rs[1].candidato.cascata[1].titulo.id == "c3"
           and rs[1].candidato.cascata[1].valor == Decimal("1500.00"),
           rs[1].candidato.cascata)
checar("cascata nunca e faixa automatica (sempre revisao)",
       rs[1].faixa is Faixa.REVISAO, rs[1].faixa)

print("\nF17. Titulo com valor exato nunca perde pro dicionario, mesmo com score baixo")
# Achado real (Scopo, 2026-09-21): empresa lanca tarifa/mensalidade bancaria
# como Contas a Pagar em vez de lancamento direto. "TARIFA X" batia no
# dicionario com score 90 (automatico) enquanto o titulo certo (mesmo valor,
# mesma data, banco sem nome batendo no texto) tinha score baixo e era
# descartado. Agora valor exato forca revisao, nunca deixa o automatico
# do dicionario "furar a fila".
rs = run(
    [L("a", 5, "39.00", Natureza.DEBITO, "TARIFA RENOVACAO CADASTRO")],
    [T("t1", "CP", 5, "39.00", "BANCO EXEMPLO SA")],
)
checar("vai para titulo em revisao, nao lancamento direto automatico",
       rs[0].desfecho is Desfecho.TITULO and rs[0].faixa is Faixa.REVISAO,
       (rs[0].desfecho, rs[0].faixa))
checar("candidato e o titulo certo, mesmo com score baixo",
       rs[0].candidato is not None and rs[0].candidato.titulo.id == "t1",
       rs[0].candidato)

print("\nF10. Fila escapa HTML")
h=open(Path(__file__).resolve().parents[1]/"fila_conciliacao.html").read() if (Path(__file__).resolve().parents[1]/"fila_conciliacao.html").exists() else open("/mnt/user-data/outputs/fila_conciliacao.html").read()
checar("funcao esc definida e usada", "const esc" in h and h.count("esc(")>10, h.count("esc("))
checar("descricao escapada", "esc(r.descricao)" in h)

print("\n"+"="*50)
if falhas: print(f"{len(falhas)} FALHA(S): {falhas}"); sys.exit(1)
print("Todos os testes passaram.")
