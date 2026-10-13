"""Testes sinteticos do motor de conciliacao — sem rede, sem API Omie."""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.conciliacao import (  # noqa: E402
    Config, Contexto, Desfecho, Faixa, LinhaExtrato, Natureza,
    RecebimentoOmie, RegraCliente, TipoExcecao, Titulo, conciliar, resumir,
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

print("\n== 10. Aplicacao/resgate SEM conta de investimento cadastrada -> revisao (nao decide as cegas) ==")
# Nao teremos extrato diario da conta de investimento pra reconciliar (so
# um resumo na virada do mes) — mas sem saber PRA QUAL conta, o sistema nao
# pode decidir sozinho: vai pra revisao pro operador informar qual e a
# conta (nunca mais cai no limbo de "cadastro" — achado real: Scopo,
# 2026-09-21; decisao explicita do usuario sobre nao adivinhar a conta).
r = um([linha("L10", 12, "80000.00", Natureza.DEBITO, "APLIC AUT MAIS")])
checar("reconhece como transferencia, mas em revisao (nao automatico as cegas)",
       r.desfecho is Desfecho.TRANSFERENCIA and r.faixa is Faixa.REVISAO,
       (r.desfecho, r.faixa))
checar("conta_destino_id fica None ate o operador informar",
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

print("\n== 19. Ambiguidade so' entre titulos que batem a contraparte identificada ==")
# PIX recebido do POSITIVO (CNPJ na linha); dois titulos de valor identico mas
# de OUTROS parceiros (advogados) empatam por valor. Nao e uma escolha do
# operador entre advogados — e "sem titulo do POSITIVO em aberto". A coincidencia
# de valor de outro parceiro nao pode virar ambiguidade. Oystr, agosto/2026.
_pos = linha("L19", 4, "6506.18", Natureza.CREDITO,
             "PIX RECEBIDO POSITIVO EDUCACIONAL LTDA 02.343.359/0001-90",
             contraparte_documento="02343359000190")
_adv = [titulo("T19a", "CR", 4, "6506.18", "PARADA ADVOGADOS"),
        titulo("T19b", "CR", 4, "6506.18", "L A TAUNAY ADVOGADOS")]
r19 = um([_pos], _adv)
checar("valor coincidente de outro parceiro nao vira ambiguidade",
       r19.tipo_excecao is not TipoExcecao.AMBIGUIDADE, r19.tipo_excecao)

# contraprova 1: PIX seco (sem contraparte na linha) com dois titulos iguais —
# ai sim e ambiguidade legitima, so o operador sabe de quem foi.
_seco = linha("L19c", 3, "200.00", Natureza.CREDITO, "PIX QRS")
_iguais = [titulo("T19c", "CR", 3, "200.00", "ALFA"),
           titulo("T19d", "CR", 3, "200.00", "BETA")]
checar("sem contraparte na linha: empate por valor segue ambiguidade",
       um([_seco], _iguais).tipo_excecao is TipoExcecao.AMBIGUIDADE)

# contraprova 2: a contraparte da linha TEM um dos titulos — casa com ela, sem fila.
_parada = linha("L19e", 4, "6506.18", Natureza.CREDITO,
                "PIX RECEBIDO PARADA ADVOGADOS", contraparte_nome="PARADA ADVOGADOS")
r19e = um([_parada], _adv)
checar("contraparte com titulo proprio: casa com ela, nao vira ambiguidade",
       r19e.desfecho is Desfecho.TITULO
       and r19e.candidato is not None
       and r19e.candidato.titulo.parceiro_nome == "PARADA ADVOGADOS",
       (r19e.desfecho, r19e.candidato.titulo.parceiro_nome if r19e.candidato else None))

print("\n== 20. CONCILIAR_RECEBIDO: PIX QR seco casa com recebimento ja feito no Omie ==")


def receb(id, dia, valor, parceiro, doc=None):
    return RecebimentoOmie(
        id=id, valor=Decimal(valor), data=date(2026, 9, dia),
        parceiro_nome=parceiro, parceiro_documento=doc,
    )


# o banco esconde a contraparte ("PIX QRS MONTRONI AD"), mas o Omie ja recebeu
# o titulo com o cliente. Casa por valor+data, corrobora pelo nome parcial.
_pix = linha("L20a", 10, "1000.00", Natureza.CREDITO, "PIX QRS MONTRONI AD10/09")
r20a = um([_pix], recebimentos=[receb("R1", 10, "1000.00", "MONTRONI ADVOGADOS ASSOCIADOS")])
checar("PIX seco + recebimento Omie c/ nome parcial -> CONCILIAR_RECEBIDO/revisao",
       r20a.desfecho is Desfecho.CONCILIAR_RECEBIDO and r20a.faixa is Faixa.REVISAO
       and r20a.candidato is not None
       and r20a.candidato.titulo.parceiro_nome == "MONTRONI ADVOGADOS ASSOCIADOS",
       (r20a.desfecho, r20a.faixa))

# compensacao: o Omie recebeu no dia 9, o banco creditou no dia 10 (D+1) — dentro da janela.
_pix_lag = linha("L20b", 10, "1000.00", Natureza.CREDITO, "PIX QRS MONTRONI AD10/09")
r20b = um([_pix_lag], recebimentos=[receb("R2", 9, "1000.00", "MONTRONI ADVOGADOS")])
checar("janela de compensacao D+1 ainda casa",
       r20b.desfecho is Desfecho.CONCILIAR_RECEBIDO, r20b.desfecho)

# sem corroboracao de nome: valor+data batem, mas o nome nao tem nada a ver -> fila.
_pix_semnome = linha("L20c", 10, "1000.00", Natureza.CREDITO, "PIX QRS")
r20c = um([_pix_semnome], recebimentos=[receb("R3", 10, "1000.00", "FULANO DE TAL LTDA")])
checar("PIX sem pista de nome nao e tirado da fila so por valor+data",
       r20c.desfecho is Desfecho.FILA and r20c.tipo_excecao is TipoExcecao.SEM_TITULO_ENTRADA,
       (r20c.desfecho, r20c.tipo_excecao))

# dois recebimentos de mesmo valor+data -> ambiguo, nao chuta.
_pix_amb = linha("L20d", 10, "1000.00", Natureza.CREDITO, "PIX QRS MONTRONI AD")
r20d = um([_pix_amb], recebimentos=[
    receb("R4", 10, "1000.00", "MONTRONI ADVOGADOS"),
    receb("R5", 10, "1000.00", "OUTRO CLIENTE"),
])
checar("dois recebimentos mesmo valor+data -> fila (nao resolve as cegas)",
       r20d.desfecho is Desfecho.FILA, r20d.desfecho)

# debito nunca entra nesse passo (recebimento e credito).
_deb = linha("L20e", 10, "1000.00", Natureza.DEBITO, "PIX QRS MONTRONI AD")
r20e = um([_deb], recebimentos=[receb("R6", 10, "1000.00", "MONTRONI ADVOGADOS")])
checar("debito nao vira CONCILIAR_RECEBIDO",
       r20e.desfecho is not Desfecho.CONCILIAR_RECEBIDO, r20e.desfecho)

# sem recebimentos passados: comportamento historico preservado (vai pra fila).
r20f = um([linha("L20f", 10, "1000.00", Natureza.CREDITO, "PIX QRS MONTRONI AD")])
checar("sem recebimentos no contexto -> fila (comportamento historico)",
       r20f.desfecho is Desfecho.FILA, r20f.desfecho)

print("\n== 21. Decomposicao de boleto consolidado (opt-in) ==")


def receb_bol(id, dia, valor, parceiro="CLIENTE X"):
    return RecebimentoOmie(id=id, valor=Decimal(valor), data=date(2026, 9, dia),
                           parceiro_nome=parceiro, tipo_documento="BOL")


# 3 boletos recebidos em 04/09 somam 3.710,34; banco credita consolidado em
# 09/09 (lag de compensacao). Com o flag ligado, decompoe e concilia.
_bols = [receb_bol("B1", 4, "1000.00"), receb_bol("B2", 4, "2000.00"), receb_bol("B3", 4, "710.34")]
_credito = linha("LB1", 9, "3710.34", Natureza.CREDITO, "BOLETOS RECEBIDOS  09/09S")

r21_on = conciliar(Contexto(linhas=[_credito], titulos=[], recebimentos=_bols),
                   Config(decompor_boleto_recebido=True))[0]
checar("flag ON + soma do dia bate -> CONCILIAR_RECEBIDO com os N boletos",
       r21_on.desfecho is Desfecho.CONCILIAR_RECEBIDO
       and r21_on.candidato is not None
       and len(r21_on.candidato.cascata) == 3,
       (r21_on.desfecho, len(r21_on.candidato.cascata) if r21_on.candidato else None))

r21_off = conciliar(Contexto(linhas=[_credito], titulos=[], recebimentos=_bols), Config())[0]
checar("flag OFF (padrao) -> mantem aguardando_retorno_boleto (historico)",
       r21_off.tipo_excecao is TipoExcecao.AGUARDANDO_RETORNO_BOLETO,
       r21_off.tipo_excecao)

# credito sem dia de soma exata -> nao decompoe, mesmo com flag ligado
_credito_sem = linha("LB2", 9, "9999.00", Natureza.CREDITO, "BOLETOS RECEBIDOS")
r21_sem = conciliar(Contexto(linhas=[_credito_sem], titulos=[], recebimentos=_bols),
                    Config(decompor_boleto_recebido=True))[0]
checar("flag ON mas nenhum dia soma exato -> aguardando (nao chuta)",
       r21_sem.tipo_excecao is TipoExcecao.AGUARDANDO_RETORNO_BOLETO,
       r21_sem.tipo_excecao)

print("\n== Resumo do lote ==")
print(" ", resumir(rs))

print("\n" + "=" * 50)
if falhas:
    print(f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("Todos os testes passaram.")
