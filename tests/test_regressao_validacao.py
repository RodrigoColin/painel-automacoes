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

print("\nF18. Renumerar id em lote multi-conta evita colisao de FITID entre contas")
# Achado real (Acordo Fechado, 2026-09-21): o Itau numera FITID como
# "AAAAMMDD"+sequencial DENTRO DO DIA, reiniciando do zero em cada conta —
# duas contas Itau da mesma empresa colidem no mesmo id ("20260806001" nas
# duas), fazendo o motor tratar linhas completamente diferentes como se
# fossem a mesma (pares de transferencia quebrados, idempotencia errada).
linhas_colisao = [
    LinhaExtrato(id="20260806001", conta_id="CC_A", data=date(2026, 8, 6),
                 valor=Decimal("20000.00"), natureza=Natureza.CREDITO,
                 descricao="USO CONTA GARANTIDA", banco="itau"),
    LinhaExtrato(id="20260806001", conta_id="CC_B", data=date(2026, 8, 6),
                 valor=Decimal("20000.00"), natureza=Natureza.DEBITO,
                 descricao="USO CONTA GARANTIDA", banco="itau"),
]
renumeradas = ofx.renumerar_para_lote_multiconta(linhas_colisao)
checar("ids diferentes depois de renumerar (prefixados pela conta)",
       renumeradas[0].id != renumeradas[1].id, [l.id for l in renumeradas])
checar("prefixo e o proprio conta_id, formato conta:id_original",
       renumeradas[0].id == "CC_A:20260806001" and renumeradas[1].id == "CC_B:20260806001",
       [l.id for l in renumeradas])

linha_unica = [LinhaExtrato(id="X1", conta_id="CC_A", data=date(2026, 8, 6),
                            valor=Decimal("10.00"), natureza=Natureza.DEBITO,
                            descricao="TARIFA", banco="itau")]
checar("single-conta (so 1 conta no lote) mantem o FITID original intacto",
       ofx.renumerar_para_lote_multiconta(linha_unica)[0].id == "X1")

rs_multiconta = run([renumeradas[0], renumeradas[1]])
checar("com ids unicos, o par de transferencia e identificado corretamente",
       rs_multiconta[0].desfecho is Desfecho.TRANSFERENCIA
       and rs_multiconta[1].desfecho is Desfecho.TRANSFERENCIA,
       [r.desfecho for r in rs_multiconta])

print("\nF19. Pagamento de fatura de cartao vira transferencia (automatica ou revisao)")
# Achado real (Scopo, 2026-09-21): a baixa dos titulos que compoem a fatura
# continua manual, feita depois — mas a transferencia em si (o dinheiro
# saindo da conta corrente pra conta do cartao) nao precisa esperar isso,
# nem esperar o extrato da conta do cartao (so a fatura discriminada, que
# chega depois). Confirmado com texto real de 4 bancos: casa quando tem
# ("FATURA" ou "FAT.") E "CART" juntos. "FATURA ITAU EMPRESAS..." (sem a
# palavra cartao) foi tratado como ambiguo demais ate 2026-09-21 — CORRIGIDO
# pelo usuario nessa data: no Itau essa frase exata E' o pagamento do cartao
# PJ, e' so um padrao do Itau que nao usa a palavra "cartao"; entra como
# entrada especifica do banco (nao no termos_e generico), com a mesma regra
# de sempre perguntar quando nao sabe qual cartao.
rs = run(
    [L("a", 10, "5000.00", Natureza.DEBITO, "DEBITO AUT. FAT.CARTAO MASTER CARD FINAL 8196")],
    contas_cartao={"A": "CARTAO_MC"},
)
checar("com a conta do cartao configurada, vira transferencia automatica",
       rs[0].desfecho is Desfecho.TRANSFERENCIA and rs[0].faixa is Faixa.AUTOMATICO
       and rs[0].conta_destino_id == "CARTAO_MC",
       (rs[0].desfecho, rs[0].faixa, rs[0].conta_destino_id))

rs_sem_cadastro = run(
    [L("b", 10, "5000.00", Natureza.DEBITO, "FATURA DO CARTAO BTG PACTUAL")],
)
checar("sem a conta do cartao configurada, reconhece mas vai pra revisao (nao decide as cegas)",
       rs_sem_cadastro[0].desfecho is Desfecho.TRANSFERENCIA
       and rs_sem_cadastro[0].faixa is Faixa.REVISAO,
       (rs_sem_cadastro[0].desfecho, rs_sem_cadastro[0].faixa))

rs_itau_empresas = run(
    [L("c", 10, "5000.00", Natureza.DEBITO, "FATURA ITAU EMPRESAS VS INF ITAU UNIBANCO")],
)
checar("'FATURA ITAU EMPRESAS' (Itau, sem 'CART') reconhece e vai pra revisao — nao decide qual cartao as cegas",
       rs_itau_empresas[0].desfecho is Desfecho.TRANSFERENCIA
       and rs_itau_empresas[0].faixa is Faixa.REVISAO,
       (rs_itau_empresas[0].desfecho, rs_itau_empresas[0].faixa))

print("\nF20. Conta garantida (linha de credito rotativo) vira transferencia")
# Mesmo conceito de F19, terceira vez que se repete (aplicacao/resgate,
# fatura de cartao, agora conta garantida): nao teremos extrato dela, entao
# a transferencia e reconhecida direto na conta corrente. "CONTA GARANTIDA"
# cobre os dois sentidos (USO = credito, PAGAMENTO = debito) com um so
# termo — natureza=None de proposito. Confirmado real em duas empresas
# (Acordo Fechado, Startlaw, 2026-09-21).
rs = run(
    [L("a", 3, "20000.00", Natureza.CREDITO, "USO CONTA GARANTIDA 0017144-4 MOB")],
    contas_garantidas={"A": "CONTA_GARANTIDA_X"},
)
checar("com a conta garantida configurada, automatico",
       rs[0].desfecho is Desfecho.TRANSFERENCIA and rs[0].faixa is Faixa.AUTOMATICO
       and rs[0].conta_destino_id == "CONTA_GARANTIDA_X",
       (rs[0].desfecho, rs[0].faixa, rs[0].conta_destino_id))

rs_pagamento = run(
    [L("b", 4, "3283.86", Natureza.DEBITO, "PAGAMENTO CONTA GARANTIDA 0045656-1 MOB")],
)
checar("PAGAMENTO (debito) tambem reconhece, sem conta configurada vai pra revisao",
       rs_pagamento[0].desfecho is Desfecho.TRANSFERENCIA and rs_pagamento[0].faixa is Faixa.REVISAO,
       (rs_pagamento[0].desfecho, rs_pagamento[0].faixa))

print("\nF21. Vocabulario do Inter: 'JUROS LIMITE' (sem 'DE') e 'IMPOSTO CHEQUE ESPECIAL'")
# Achado real (Eskda, 2026-09-21): o Inter escreve "Juros Limite credito"
# (sem a palavra "DE" que o termo generico ja cadastrado exigia) e "Imposto
# Cheque especial" (sem termo nenhum cadastrado) — as duas caiam em fila
# sem motivo, mesmo grupo semantico de "JUROS DE LIMITE"/"JUROS CHEQUE
# ESPECIAL" que ja existia.
from omie_mcp.conciliacao import dicionario_banco as dic  # noqa: E402
for desc in ("Juros Limite credito P. juridica", "Imposto Cheque especial"):
    l = L("z", 3, "50.00", Natureza.DEBITO, desc)
    p = dic.identificar(l)
    checar(f"reconhece '{desc}'", p is not None and p.tipo is dic.TipoDireto.JUROS_CONTA,
           p.tipo if p else None)

print("\nF22. Recebimento consolidado de boleto NUNCA e conciliado/lancado — so pendencia")
# Conceito explicado pelo usuario (2026-09-21): o Itau/Inter liquidam varios
# boletos de clientes diferentes num so credito ("BOLETOS RECEBIDOS",
# "Boleto de cobranca recebido") — o motor nao sabe decompor isso em N
# titulos sozinho (so o arquivo retorno, importado no Omie, faz isso).
# Confirmado real: "BOLETOS RECEBIDOS" aparece quase todo dia util em
# qualquer conta Itau que recebe por boleto (Oystr, Proos, Leadfy, Acordo
# Fechado...); "Boleto de cobranca recebido" no Inter (Eskda).
rs = run([L("a", 5, "9320.45", Natureza.CREDITO, "BOLETOS RECEBIDOS  05/08S")])
checar("nunca title/lancamento/transferencia — sempre fila/excecao",
       rs[0].desfecho is Desfecho.FILA and rs[0].faixa is Faixa.EXCECAO,
       (rs[0].desfecho, rs[0].faixa))
checar("tipo de excecao especifico, nao o generico de 'sem titulo'",
       rs[0].tipo_excecao is TipoExcecao.AGUARDANDO_RETORNO_BOLETO, rs[0].tipo_excecao)

rs_inter = run([L("b", 5, "450.00", Natureza.CREDITO, 'Boleto de cobranca recebido: "112/90805471649"')])
checar("mesmo reconhecimento no formato do Inter",
       rs_inter[0].tipo_excecao is TipoExcecao.AGUARDANDO_RETORNO_BOLETO, rs_inter[0].tipo_excecao)

print("\nF23. Pseudo-transacao de saldo do dia (Itau) e filtrada, nao vira linha")
# Achado real (Proos, extrato Itau, 2026-09-21): o banco embute uma
# STMTTRN por dia so pra "retratar" o saldo ("SALDO TOTAL DISPONIVEL
# DIA", TRNAMT = o proprio saldo, nao um valor movimentado) + 1 "SALDO
# ANTERIOR" — 32 das 135 linhas do arquivo real eram pseudo-transacoes
# assim. Sem filtro, isso corrompia qualquer comparacao de saldo dia-a-
# dia banco x Omie e entrava no motor como se fosse pagamento real.
o_saldo = (
    '<OFX><STMTTRN><DTPOSTED>20260918<TRNAMT>-6615.05<FITID>S1'
    '<MEMO>SALDO TOTAL DISPON\x8dVEL DIA</STMTTRN>'
    '<STMTTRN><DTPOSTED>20260918<TRNAMT>1000.00<FITID>S2<MEMO>ANTERIOR'
    '</STMTTRN>'
    '<STMTTRN><DTPOSTED>20260917<TRNAMT>500.00<FITID>S3'
    '<MEMO>SALDO ANTERIOR</STMTTRN>'
    '<STMTTRN><DTPOSTED>20260918<TRNAMT>-50.00<FITID>S4'
    '<MEMO>PAGTO A VISTA SALDO DEV</STMTTRN></OFX>'
)
ls_saldo = ofx.ler_texto(o_saldo, "c")
checar("filtra 'SALDO TOTAL DISPONIVEL DIA' mesmo com byte corrompido no acento",
       not any("SALDO TOTAL" in l.descricao.upper() for l in ls_saldo), [l.descricao for l in ls_saldo])
checar("filtra 'SALDO ANTERIOR' (match exato, nao substring)",
       not any(l.descricao.upper() == "SALDO ANTERIOR" for l in ls_saldo),
       [l.descricao for l in ls_saldo])
checar("NAO filtra transacao real que so cita 'saldo' no meio do texto "
       "(achado real: 'PAGTO A VISTA SALDO DEV', extrato Startlaw)",
       any("PAGTO A VISTA SALDO DEV" in l.descricao.upper() for l in ls_saldo),
       [l.descricao for l in ls_saldo])
checar("linha com MEMO 'ANTERIOR' sozinho (sem 'SALDO') fica — nao e o padrao",
       any(l.descricao.upper() == "ANTERIOR" for l in ls_saldo), [l.descricao for l in ls_saldo])
checar("sobram exatamente 2 linhas reais das 4", len(ls_saldo) == 2, len(ls_saldo))

print("\nF24. saldo_por_dia reconstroi o saldo diario do banco de tras pra frente")
# Uso: validacao diaria banco x Omie (pedido do usuario 2026-09-21) — cada
# dia precisa do PROPRIO saldo, nao so o saldo final, senao um dia que
# faltou lancar algo se esconde atras de um saldo final que so "por sorte"
# bate depois de mais movimento.
o_dias = (
    '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><LEDGERBAL>'
    '<BALAMT>1000.00<DTASOF>20260920100000[-03:EST]'
    '</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1>'
    '<STMTTRN><DTPOSTED>20260918<TRNAMT>-200.00<FITID>D1<MEMO>A</STMTTRN>'
    '<STMTTRN><DTPOSTED>20260919<TRNAMT>300.00<FITID>D2<MEMO>B</STMTTRN>'
    '<STMTTRN><DTPOSTED>20260919<TRNAMT>-100.00<FITID>D3<MEMO>C</STMTTRN>'
    '</OFX>'
)
por_dia = ofx.saldo_por_dia(o_dias)
checar("saldo do dia 20/09 (final, sem transacao propria) e o saldo final",
       por_dia[date(2026, 9, 20)] == Decimal("1000.00"), por_dia)
checar("saldo do dia 19/09 (ultimo dia com transacao, nada depois dele) tambem e o saldo final",
       por_dia[date(2026, 9, 19)] == Decimal("1000.00"), por_dia)
checar("saldo do dia 18/09 e o de 19/09 menos o movimento de 19/09 (300-100=200)",
       por_dia[date(2026, 9, 18)] == Decimal("800.00"), por_dia)
checar("nao inventa dia sem transacao nem sem ser o final",
       set(por_dia) == {date(2026, 9, 18), date(2026, 9, 19), date(2026, 9, 20)}, set(por_dia))

print("\nF25. movimento_por_dia (banco) e a variacao do PROPRIO dia, nao acumulada")
# Pedido do usuario (2026-09-21): separar "esse dia especifico teve
# problema" (movimento do dia) de "o problema ja vinha de um dia anterior"
# (saldo acumulado) — sem isso, uma divergencia antiga persiste em todo
# saldo acumulado seguinte e esconde quando um NOVO dia realmente diverge.
mov_banco = ofx.movimento_por_dia(o_dias)
checar("dia 18/09: so a transacao de -200", mov_banco[date(2026, 9, 18)] == Decimal("-200.00"), mov_banco)
checar("dia 19/09: soma das duas transacoes (300-100=200)",
       mov_banco[date(2026, 9, 19)] == Decimal("200.00"), mov_banco)
checar("dia 20/09 sem transacao propria nao vira chave (nao e zero, e ausencia)",
       date(2026, 9, 20) not in mov_banco, mov_banco)

print("\nF26. extrato.movimento_por_dia (Omie) so calcula entre dias calendario consecutivos")
from omie_mcp.tools import extrato as _extrato  # noqa: E402
saldo_omie_exemplo = {
    date(2026, 9, 10): Decimal("100.00"),
    date(2026, 9, 11): Decimal("150.00"),   # consecutivo ao 10 -> delta = 50
    date(2026, 9, 14): Decimal("500.00"),   # buraco (12/13 sem dado) -> NAO calcula
}
mov_omie = _extrato.movimento_por_dia(saldo_omie_exemplo)
checar("11/09 consecutivo ao 10/09: delta = 150-100 = 50",
       mov_omie.get(date(2026, 9, 11)) == Decimal("50.00"), mov_omie)
checar("10/09 e o primeiro do dict, sem dia anterior: nao entra",
       date(2026, 9, 10) not in mov_omie, mov_omie)
checar("14/09 tem buraco de 2 dias antes (12 e 13 sem saldo): NAO calcula "
       "(atribuir 3 dias de movimento a um so enganaria)",
       date(2026, 9, 14) not in mov_omie, mov_omie)

print("\nF27. RegraCliente com parceiro_nome_esperado — lote sem nome no banco")
# Achado real (Proos, 2026-09-21): "SISPAG SALARIOS" (lote de folha) nunca
# traz nome/documento do beneficiario no texto do banco — o mecanismo de
# regra antigo (padrao precisa aparecer DENTRO do nome do titulo) nunca
# bate nesse caso, porque nao ha nada pra bater. valor_exato/valor_exceto
# desambiguam duas regras que casam o MESMO texto: R$1.500,00 exato e
# sempre "pro-labore" (fake, categoria 9.01.01); qualquer outro valor e
# "distribuicao de lucro" (fake, categoria 9.02.01), paga em parcelas
# contra o UNICO titulo de R$10.000 (nao varios titulos — cascata nao
# se aplica aqui, e pagamento parcial normal).
regra_prolabore = RegraCliente(
    padrao="SISPAG SALARIOS", desfecho=Desfecho.TITULO, categoria="9.01.01",
    parceiro_nome_esperado="FULANO DE TAL", valor_exato=Decimal("1500.00"),
)
regra_dl = RegraCliente(
    padrao="SISPAG SALARIOS", desfecho=Desfecho.TITULO, categoria="9.02.01",
    parceiro_nome_esperado="FULANO DE TAL", valor_exceto=Decimal("1500.00"),
)
titulo_prolabore = T("pl1", "CP", 5, "1500.00", "FULANO DE TAL", categoria="9.01.01")
titulo_dl = T("dl1", "CP", 15, "10000.00", "FULANO DE TAL", categoria="9.02.01")

rs = run(
    [L("a", 9, "1500.00", Natureza.DEBITO, "SISPAG SALARIOS")],
    [titulo_prolabore, titulo_dl],
    regras=[regra_prolabore, regra_dl],
)
checar("valor exato 1500 -> bate no titulo de pro-labore (categoria certa)",
       rs[0].candidato is not None and rs[0].candidato.titulo.id == "pl1", rs[0].candidato)
checar("nunca automatico so com evidencia de valor+regra (sem nome de verdade)",
       rs[0].faixa is not Faixa.AUTOMATICO, rs[0].faixa)

rs = run(
    [L("b", 14, "4000.00", Natureza.DEBITO, "SISPAG SALARIOS")],
    [titulo_prolabore, titulo_dl],
    regras=[regra_prolabore, regra_dl],
)
checar("valor 4000 (!= 1500) -> bate no titulo de DL, como pagamento parcial",
       rs[0].candidato is not None and rs[0].candidato.titulo.id == "dl1", rs[0].candidato)
checar("marcado como parcial (titulo de 10000, pago 4000)",
       rs[0].candidato.parcial, rs[0].candidato)

print("\nF28. RegraCliente.sempre_revisao — padrao reconhecido nunca decide sozinho")
# Achado real (Proos, 2026-09-21): PIX pro Rodrigo pode ser pro-labore,
# distribuicao de lucro ou outra coisa — o texto do banco TEM o nome (ao
# contrario do SISPAG SALARIOS), mas isso nao ajuda a saber o SIGNIFICADO.
# "sempre pergunte": nunca titulo automatico, nunca titulo em revisao
# escolhido sozinho — vai direto pra fila, mesmo com titulo exato disponivel.
regra_sempre_revisao = RegraCliente(
    padrao="FULANO DE TAL", desfecho=Desfecho.FILA, sempre_revisao=True,
)
titulo_exato = T("px1", "CP", 10, "1500.00", "FULANO DE TAL", categoria="9.01.01")
rs = run(
    [L("d", 10, "1500.00", Natureza.DEBITO, "PIX ENVIADO FULANO DE TAL")],
    [titulo_exato],
    regras=[regra_sempre_revisao],
)
checar("nunca vira titulo, mesmo com valor e nome batendo exato",
       rs[0].desfecho is Desfecho.FILA, rs[0].desfecho)
checar("tipo de excecao especifico (confirmacao manual), nao generico",
       rs[0].tipo_excecao is TipoExcecao.CONFIRMACAO_MANUAL, rs[0].tipo_excecao)

print("\nF29. Tributo federal (Receita Federal) sem titulo batendo vai pra confirmacao manual")
# Achado real (Proos, 2026-09-21): a guia (DARF/DAS) muda de valor todo mes
# (Simples Nacional e sobre faturamento) — nunca da pra confiar que o valor
# vai bater com um titulo cadastrado com valor fixo. Reconhece que E'
# tributo federal (nao cai na excecao generica de "sem titulo"), mas nunca
# decide sozinho.
rs = run(
    [L("e", 10, "3200.00", Natureza.DEBITO, "PAGAMENTO RECEITA FEDERAL")],
)
checar("vai pra fila, nao lancamento direto automatico",
       rs[0].desfecho is Desfecho.FILA, rs[0].desfecho)
checar("tipo de excecao especifico (confirmacao manual), nao 'sem titulo saida' generico",
       rs[0].tipo_excecao is TipoExcecao.CONFIRMACAO_MANUAL, rs[0].tipo_excecao)

rs_com_titulo = run(
    [L("f", 10, "3200.00", Natureza.DEBITO, "PAGAMENTO RECEITA FEDERAL")],
    [T("rf1", "CP", 10, "3200.00", "RECEITA FEDERAL")],
)
checar("com titulo aberto batendo exato, casa normal (nao forca fila)",
       rs_com_titulo[0].desfecho is Desfecho.TITULO
       and rs_com_titulo[0].candidato is not None
       and rs_com_titulo[0].candidato.titulo.id == "rf1",
       rs_com_titulo[0].desfecho)

print("\nF30. Titulo recorrente do mes seguinte — heuristica e guarda de ambiguidade")
# Achado real (Proos, 2026-09-21): o Omie pre-cria as parcelas futuras de uma
# despesa recorrente (ex.: Simples Nacional/DAS) com o MESMO valor da
# configuracao original — cada mes precisa ajustar esse valor antes do
# vencimento. Sem campo de vinculo de recorrencia no Omie, a busca e
# heuristica (parceiro+categoria+mes) e precisa abortar em ambiguidade, nunca
# adivinhar.
import asyncio  # noqa: E402
from omie_mcp.conciliacao import recorrencia as rec  # noqa: E402

titulo_pago = T("das-09", "CP", 20, "3100.00", "FULANO SIMPLES NACIONAL", categoria="9.09.01")
titulo_seguinte = Titulo(id="das-10", tipo="CP", vencimento=date(2026, 10, 22),
                          valor=Decimal("3100.00"), parceiro_nome="FULANO SIMPLES NACIONAL",
                          categoria="9.09.01")

achado = rec.localizar_titulo_recorrente_seguinte(titulo_pago, [titulo_pago, titulo_seguinte])
checar("acha o titulo do mes seguinte, mesmo parceiro+categoria",
       achado.id == "das-10", achado.id)

titulo_seguinte_b = Titulo(id="das-10b", tipo="CP", vencimento=date(2026, 10, 25),
                            valor=Decimal("3100.00"), parceiro_nome="FULANO SIMPLES NACIONAL",
                            categoria="9.09.01")
try:
    rec.localizar_titulo_recorrente_seguinte(
        titulo_pago, [titulo_pago, titulo_seguinte, titulo_seguinte_b]
    )
    checar("2 candidatos deveria abortar", False)
except rec.AmbiguidadeRecorrencia:
    checar("2 candidatos no mes seguinte -> aborta, nunca advinha", True)

try:
    rec.localizar_titulo_recorrente_seguinte(titulo_pago, [titulo_pago])
    checar("0 candidatos deveria abortar", False)
except rec.AmbiguidadeRecorrencia:
    checar("0 candidatos -> aborta", True)

titulo_outra_categoria = Titulo(id="das-10c", tipo="CP", vencimento=date(2026, 10, 20),
                                 valor=Decimal("3100.00"), parceiro_nome="FULANO SIMPLES NACIONAL",
                                 categoria="9.02.01")
try:
    rec.localizar_titulo_recorrente_seguinte(titulo_pago, [titulo_pago, titulo_outra_categoria])
    checar("categoria diferente nao deveria casar (0 candidatos -> aborta)", False)
except rec.AmbiguidadeRecorrencia:
    checar("categoria diferente nao casa, mesmo mesmo parceiro/mes", True)

print("\nF30b. planejar/executar atualizacao de valor de titulo — dry-run nao chama client")
plano = eo.planejar_atualizacao_valor_titulo(
    {"codigo_lancamento_omie": 999, "valor_documento": 3100.00,
     "codigo_categoria": "9.09.01", "tipo_registro": "CP"},
    Decimal("3412.50"), motivo="DAS confirmado (teste sintetico)",
)
checar("valor_antes preservado do registro cru", plano.valor_antes == Decimal("3100.00"), plano.valor_antes)
checar("valor_depois e o confirmado", plano.valor_depois == Decimal("3412.50"), plano.valor_depois)
checar("payload parte de copia do registro inteiro (nao minimo)",
       plano.payload.get("codigo_categoria") == "9.09.01", plano.payload)

cliente_falso = eo.ClienteFalso()
resultado = asyncio.run(eo.executar_atualizacao_valor(plano, cliente_falso, executar=False))
checar("dry-run nao chama o client", cliente_falso.chamadas == [] and not resultado.executada)

resultado2 = asyncio.run(eo.executar_atualizacao_valor(plano, cliente_falso, executar=True))
checar("executar=True chama o client uma vez", len(cliente_falso.chamadas) == 1)
checar("marcado como executada, sem erro", resultado2.executada and resultado2.erro is None)

print("\nF31. Deteccao de banco por BANKID aceita 3 ou 4 digitos")
# Achado real (Proos, 2026-09-21): o extrato Itau real usa '<BANKID>0341'
# (4 digitos, zero a esquerda) — um .zfill(3) sozinho nao ajusta isso pra
# bater com o dicionario ('341'), e o banco ficava None. Sem `banco` certo,
# TODOS os padroes especificos de banco (ex.: 'FATURA ITAU EMPRESAS') nunca
# batiam, mesmo com o texto exato presente na descricao.
checar("BANKID com 4 digitos e zero a esquerda (extrato real) -> itau",
       ofx._detectar_banco("<BANKID>0341</BANKID>") == "itau")
checar("BANKID com 3 digitos (sem zero a esquerda) continua funcionando",
       ofx._detectar_banco("<BANKID>341</BANKID>") == "itau")
checar("BANKID desconhecido -> None, nao explode",
       ofx._detectar_banco("<BANKID>9999</BANKID>") is None)

print("\nF10. Fila escapa HTML")
h=open(Path(__file__).resolve().parents[1]/"fila_conciliacao.html").read() if (Path(__file__).resolve().parents[1]/"fila_conciliacao.html").exists() else open("/mnt/user-data/outputs/fila_conciliacao.html").read()
checar("funcao esc definida e usada", "const esc" in h and h.count("esc(")>10, h.count("esc("))
checar("descricao escapada", "esc(r.descricao)" in h)

print("\n"+"="*50)
if falhas: print(f"{len(falhas)} FALHA(S): {falhas}"); sys.exit(1)
print("Todos os testes passaram.")
