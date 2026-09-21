"""Testes sinteticos do motor de conciliacao — sem rede, sem API Omie."""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.conciliacao import (  # noqa: E402
    Config, Contexto, Desfecho, Faixa, LinhaExtrato, Natureza,
    RegraCliente, TipoExcecao, Titulo, conciliar, resumir,
)
from omie_mcp.conciliacao import ofx  # noqa: E402

HOJE = date(2026, 9, 20)
CC = "cc-itau"
CC2 = "cc-inter"
INV = "inv-itau"


def linha(id, dia, valor, natureza, descricao, conta=CC, **kw):
    return LinhaExtrato(
        id=id, conta_id=conta, data=date(2026, 9, dia), valor=Decimal(valor),
        natureza=natureza, descricao=descricao, banco="itau", **kw
    )


def titulo(id, tipo, dia, valor, parceiro, **kw):
    return Titulo(
        id=id, tipo=tipo, vencimento=date(2026, 9, dia), valor=Decimal(valor),
        parceiro_nome=parceiro, **kw
    )


def rodar(linhas, titulos=(), **kw):
    ctx = Contexto(linhas=linhas, titulos=list(titulos), hoje=HOJE, **kw)
    return conciliar(ctx, Config())


def um(linhas, titulos=(), **kw):
    return rodar(linhas, titulos, **kw)[0]


falhas = []


def checar(nome, condicao, detalhe=""):
    if condicao:
        print(f"  ok   {nome}")
    else:
        print(f"  FALHA {nome} — {detalhe}")
        falhas.append(nome)


print("\n== 1. Titulo: match deterministico ==")
r = um(
    [linha("L1", 10, "1500.00", Natureza.DEBITO, "PAGTO FORNECEDOR DELL BRASIL NF 4471")],
    [titulo("T1", "CP", 10, "1500.00", "DELL COMPUTADORES DO BRASIL LTDA",
            numero_documento="4471")],
)
checar("desfecho titulo", r.desfecho is Desfecho.TITULO, r.desfecho)
checar("faixa automatica", r.faixa is Faixa.AUTOMATICO, f"score {r.score}")
checar("titulo certo", r.candidato.titulo.id == "T1")

print("\n== 2. Titulo com juros por atraso ==")
r = um(
    [linha("L2", 15, "1045.00", Natureza.DEBITO, "PAGTO BOLETO ACME SERVICOS")],
    [titulo("T2", "CP", 10, "1000.00", "ACME SERVICOS LTDA")],
)
checar("desfecho titulo", r.desfecho is Desfecho.TITULO, r.desfecho)
checar("diferenca explicada", r.candidato.explicacao_diferenca is not None,
       r.candidato.explicacao_diferenca)
checar("motivo cita juros", "juros" in (r.motivo or "").lower(), r.motivo)

print("\n== 3. Divergencia de valor sem explicacao -> excecao ==")
r = um(
    [linha("L3", 8, "970.00", Natureza.DEBITO, "PAGTO ACME SERVICOS")],
    [titulo("T3", "CP", 10, "1000.00", "ACME SERVICOS LTDA")],
)
# diferenca negativa, pago antes do vencimento, mas SEM nenhuma palavra na
# descricao que justifique desconto — nao pode ser "explicado" por heuristica
# de data sozinha (era exatamente essa heuristica que a validacao adversarial
# de 2026-09-20 sinalizou como falso-positivo). Vai para revisao humana.
checar("vai para excecao por divergencia de valor",
       r.desfecho is Desfecho.FILA and r.tipo_excecao is TipoExcecao.DIVERGENCIA_VALOR,
       f"{r.desfecho} {r.tipo_excecao} {r.motivo}")

print("\n== 4. Ambiguidade: duas parcelas iguais ==")
r = um(
    [linha("L4", 10, "2000.00", Natureza.DEBITO, "PAGTO MENSALIDADE")],
    [titulo("T4a", "CP", 10, "2000.00", "ALFA CONSULTORIA"),
     titulo("T4b", "CP", 10, "2000.00", "BETA CONSULTORIA")],
)
checar("vai pra fila", r.desfecho is Desfecho.FILA, r.desfecho)
checar("tipo ambiguidade", r.tipo_excecao is TipoExcecao.AMBIGUIDADE, r.tipo_excecao)

print("\n== 5. Lancamento direto: tarifa, rendimento, IOF ==")
rs = rodar([
    linha("L5a", 1, "89.90", Natureza.DEBITO, "TAR PCT SERVICOS"),
    linha("L5b", 30 if False else 1, "1245.33", Natureza.CREDITO, "RENDIMENTO CDB"),
    linha("L5c", 1, "12.40", Natureza.DEBITO, "IOF S/ APLICACAO"),
    linha("L5d", 1, "230.00", Natureza.DEBITO, "JUROS CHEQUE ESPECIAL"),
])
checar("todos lancamento direto",
       all(r.desfecho is Desfecho.LANCAMENTO_DIRETO for r in rs),
       [r.desfecho.value for r in rs])
checar("todos automaticos", all(r.faixa is Faixa.AUTOMATICO for r in rs))
checar("categoria sugerida",
       all(r.categoria_sugerida for r in rs),
       [r.categoria_sugerida for r in rs])

print("\n== 6. Tarifa NAO rouba um titulo plausivel ==")
r = um(
    [linha("L6", 10, "89.90", Natureza.DEBITO, "TARIFA MANUTENCAO CONTA")],
    [titulo("T6", "CP", 10, "89.90", "TARIFA MANUTENCAO CONTA",
            numero_documento="89")],
)
checar("titulo tem prioridade sobre dicionario",
       r.desfecho is Desfecho.TITULO, r.desfecho)

print("\n== 7. Transferencia entre contas ==")
rs = rodar([
    linha("L7a", 12, "50000.00", Natureza.DEBITO, "TRANSF ENTRE CONTAS", conta=CC),
    linha("L7b", 12, "50000.00", Natureza.CREDITO, "TRANSF ENTRE CONTAS", conta=CC2),
], [titulo("T7", "CP", 12, "50000.00", "FORNECEDOR GRANDE LTDA")])
checar("primeira linha e transferencia", rs[0].desfecho is Desfecho.TRANSFERENCIA,
       rs[0].desfecho)
checar("par identificado", rs[0].linha_par_id == "L7b", rs[0].linha_par_id)
checar("destino e a CONTA da outra ponta, nao o id da linha",
       rs[0].conta_destino_id == CC2, rs[0].conta_destino_id)
checar("titulo de valor igual NAO foi consumido",
       rs[0].candidato is None)

print("\n== 8. Transferencia com tarifa embutida ==")
rs = rodar([
    linha("L8a", 12, "10012.00", Natureza.DEBITO, "TED MESMA TITULARIDADE", conta=CC),
    linha("L8b", 12, "10000.00", Natureza.CREDITO, "TED RECEBIDA", conta=CC2),
])
checar("transferencia com tarifa", rs[0].desfecho is Desfecho.TRANSFERENCIA,
       rs[0].desfecho)
checar("motivo cita tarifa", "tarifa" in rs[0].motivo.lower(), rs[0].motivo)
checar("tarifa embutida vai para revisao (escrita nao decompoe sozinha)",
       rs[0].faixa is Faixa.REVISAO, rs[0].faixa)
checar("valor da tarifa registrado", rs[0].valor_tarifa == Decimal("12.00"),
       rs[0].valor_tarifa)

print("\n== 9. Aplicacao automatica -> transferencia p/ conta investimento ==")
r = um([linha("L9", 12, "80000.00", Natureza.DEBITO, "APLIC AUT MAIS")],
       contas_investimento={CC: INV})
checar("aplicacao vira transferencia", r.desfecho is Desfecho.TRANSFERENCIA, r.desfecho)

print("\n== 10. Aplicacao/resgate SEM conta de investimento cadastrada ainda vira transferencia automatica ==")
# Nao teremos extrato diario da conta de investimento pra reconciliar (so
# um resumo na virada do mes) — exigir cadastro previo so empurrava isso
# pro limbo de "cadastro" sem necessidade (achado real: Scopo, 2026-09-21).
r = um([linha("L10", 12, "80000.00", Natureza.DEBITO, "APLIC AUT MAIS")])
checar("classifica automatico mesmo sem a conta de investimento configurada",
       r.desfecho is Desfecho.TRANSFERENCIA and r.faixa is Faixa.AUTOMATICO,
       (r.desfecho, r.faixa))
checar("conta_destino_id fica None ate a conta ser configurada",
       r.conta_destino_id is None, r.conta_destino_id)

print("\n== 11. Sem titulo (saida) -> fila ==")
r = um([linha("L11", 12, "3200.00", Natureza.DEBITO, "PIX ENVIADO JOSE DA SILVA")])
checar("fila", r.desfecho is Desfecho.FILA, r.desfecho)
checar("tipo sem titulo saida", r.tipo_excecao is TipoExcecao.SEM_TITULO_SAIDA,
       r.tipo_excecao)

print("\n== 12. Sem titulo (entrada) -> fila ==")
r = um([linha("L12", 12, "500.00", Natureza.CREDITO, "PIX RECEBIDO NAO IDENTIFICADO")])
checar("tipo sem titulo entrada", r.tipo_excecao is TipoExcecao.SEM_TITULO_ENTRADA,
       r.tipo_excecao)

print("\n== 13. Regra aprendida do cliente decide primeiro ==")
r = um(
    [linha("L13", 12, "450.00", Natureza.DEBITO, "DEBITO AUTOMATICO COPEL")],
    regras=[RegraCliente(padrao="COPEL", desfecho=Desfecho.LANCAMENTO_DIRETO,
                         categoria="Energia Eletrica", confirmacoes=4)],
)
checar("regra aplicada", r.desfecho is Desfecho.LANCAMENTO_DIRETO, r.desfecho)
checar("automatica com 4 confirmacoes", r.faixa is Faixa.AUTOMATICO, r.faixa)

r = um(
    [linha("L13b", 12, "450.00", Natureza.DEBITO, "DEBITO AUTOMATICO COPEL")],
    regras=[RegraCliente(padrao="COPEL", desfecho=Desfecho.LANCAMENTO_DIRETO,
                         categoria="Energia Eletrica", confirmacoes=1)],
)
checar("1 confirmacao ainda vai pra revisao", r.faixa is Faixa.REVISAO, r.faixa)

print("\n== 14. Duplicidade ==")
r = um([linha("L14", 12, "100.00", Natureza.DEBITO, "QUALQUER")],
       linhas_ja_conciliadas=frozenset({"L14"}))
checar("tipo duplicidade", r.tipo_excecao is TipoExcecao.DUPLICIDADE, r.tipo_excecao)

print("\n== 15. Retencao de imposto explica diferenca ==")
r = um(
    [linha("L15", 10, "4850.00", Natureza.CREDITO, "CREDITO CLIENTE IRRF RETIDO")],
    [titulo("T15", "CR", 10, "5000.00", "CLIENTE BOM PAGADOR LTDA")],
)
checar("titulo com retencao", r.desfecho is Desfecho.TITULO, r.desfecho)
checar("explicacao de retencao",
       "reten" in (r.candidato.explicacao_diferenca or "").lower(),
       r.candidato.explicacao_diferenca)

print("\n== 16. CNPJ da contraparte eleva o score ==")
r = um(
    [linha("L16", 10, "7300.00", Natureza.DEBITO, "PAGAMENTO FORNECEDOR",
           contraparte_documento="12.345.678/0001-99")],
    [titulo("T16", "CP", 10, "7300.00", "FORNECEDOR XYZ",
            parceiro_documento="12345678000199")],
)
checar("automatico via CNPJ", r.faixa is Faixa.AUTOMATICO, f"score {r.score}")

print("\n== 17. Parser OFX ==")
OFX = """OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>341<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260910120000[-3:BRT]<TRNAMT>-1500.00
<FITID>2026091001<MEMO>PAGTO DELL NF 4471</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260911<TRNAMT>1245.33
<FITID>2026091102<MEMO>RENDIMENTO CDB</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260911<TRNAMT>-89.90
<FITID>2026091102<MEMO>TAR PCT SERVICOS (FITID repetido, transacao distinta)</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260911<TRNAMT>1245.33
<FITID>2026091102<MEMO>RENDIMENTO CDB</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>24350.11<DTASOF>20260911</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"""

linhas = ofx.ler_texto(OFX, conta_id=CC)
checar("3 linhas (4a e duplicata real: mesmo FITID+data+valor; 3a e distinta)", len(linhas) == 3, len(linhas))
checar("FITID repetido ganha sufixo unico", len({l.id for l in linhas}) == 3, [l.id for l in linhas])
checar("banco detectado pelo BANKID", linhas[0].banco == "itau", linhas[0].banco)
checar("sinal virou natureza",
       linhas[0].natureza is Natureza.DEBITO and linhas[1].natureza is Natureza.CREDITO)
checar("valor absoluto", linhas[0].valor == Decimal("1500.00"), linhas[0].valor)
checar("data parseada", linhas[0].data == date(2026, 9, 10), linhas[0].data)
saldo = ofx.saldo_final(OFX)
checar("saldo final lido", saldo == (date(2026, 9, 11), Decimal("24350.11")), saldo)

print("\n== 18. Fim a fim: OFX -> motor ==")
rs = rodar(linhas, [titulo("T18", "CP", 10, "1500.00", "DELL BRASIL",
                           numero_documento="4471")])
checar("pagamento casou com titulo", rs[0].desfecho is Desfecho.TITULO, rs[0].desfecho)
checar("rendimento virou direto",
       rs[1].desfecho is Desfecho.LANCAMENTO_DIRETO, rs[1].desfecho)
checar("tarifa virou direto", rs[2].desfecho is Desfecho.LANCAMENTO_DIRETO, rs[2].desfecho)

print("\n== Resumo do lote ==")
print(" ", resumir(rs))

print("\n" + "=" * 50)
if falhas:
    print(f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("Todos os testes passaram.")
