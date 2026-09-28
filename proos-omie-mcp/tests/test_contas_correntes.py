"""Testes de `eh_omie_cash` — reconhecimento da conta Omie.CASH pelo nome.

Achado real (Proos, 2026-09-21, via ListarContasCorrentes ao vivo): a
grafia varia entre "Omie.CASH", "Omie.CASH (PX) (encerrada)",
"Omie.CASH Letsbank (encerrada)" e "Omie.CASH - (Recebiveis de Cartao
(Z))". Essa conta e o proprio banco do Omie — a conciliacao dela ja e
automatica, feita pelo Omie mesmo, entao o motor nunca deve processa-la.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.conciliacao import ofx  # noqa: E402
from omie_mcp.tools.contas_correntes import (  # noqa: E402
    ContaBancariaAmbigua, eh_omie_cash, resolver_conta_por_extrato,
)

falhas = 0


def checar(nome: str, condicao: bool) -> None:
    global falhas
    status = "ok" if condicao else "FALHA"
    if not condicao:
        falhas += 1
    print(f"  {status}   {nome}")


print("Reconhece variacoes reais de Omie.CASH")
checar("'Omie.CASH' simples", eh_omie_cash("Omie.CASH"))
checar("'Omie.CASH (PX) (encerrada)'", eh_omie_cash("Omie.CASH (PX) (encerrada)"))
checar("'Omie.CASH Letsbank (encerrada)'", eh_omie_cash("Omie.CASH Letsbank (encerrada)"))
checar("'Omie.CASH - (Recebiveis de Cartao (Z))'",
       eh_omie_cash("Omie.CASH - (Recebíveis de Cartão (Z))"))
checar("minusculo 'omie.cash'", eh_omie_cash("omie.cash"))
checar("sem ponto 'OmieCash'", eh_omie_cash("OmieCash"))

print("\nNAO reconhece contas normais")
checar("'Itau - Conta Corrente'", not eh_omie_cash("Itau - Conta Corrente"))
checar("'Inter - Cartao'", not eh_omie_cash("Inter - Cartão"))
checar("'Caixinha'", not eh_omie_cash("Caixinha"))
checar("'Justa + Omie'", not eh_omie_cash("Justa + Omie"))
checar("'Itau - Conta Garantida'", not eh_omie_cash("Itau - Conta Garantida"))
checar("string vazia", not eh_omie_cash(""))

print("\nofx.identificar_conta_bancaria — extrai BANKID/ACCTID do bloco BANKACCTFROM")
texto_ofx = (
    "<BANKACCTFROM>\n<BANKID>0341\n<ACCTID>0655996387\n<ACCTTYPE>CHECKING\n</BANKACCTFROM>"
)
bankid, acctid = ofx.identificar_conta_bancaria(texto_ofx)
checar("BANKID extraido", bankid == "0341")
checar("ACCTID extraido", acctid == "0655996387")

bankid_vazio, acctid_vazio = ofx.identificar_conta_bancaria("<OFX></OFX>")
checar("sem BANKACCTFROM -> None, None", bankid_vazio is None and acctid_vazio is None)

print("\nresolver_conta_por_extrato — casa numero da conta contra o ACCTID do extrato")
contas_omie = [
    {"nCodCC": 111, "numero_conta_corrente": "996387", "codigo_banco": "341"},
    {"nCodCC": 222, "numero_conta_corrente": "123456", "codigo_banco": "341"},
]
achado = resolver_conta_por_extrato(contas_omie, "0341", "0655996387")
checar("acha a conta certa quando o numero bate no final do ACCTID", achado == "111")

achado_exato = resolver_conta_por_extrato(contas_omie, "0341", "996387")
checar("tambem funciona quando ACCTID e so o numero da conta (sem agencia)", achado_exato == "111")

try:
    resolver_conta_por_extrato(contas_omie, "0341", "9999999999")
    checar("ACCTID sem nenhuma conta correspondente deveria levantar", False)
except ContaBancariaAmbigua:
    checar("nenhuma conta bate -> levanta, nunca advinha", True)

contas_ambiguas = [
    {"nCodCC": 111, "numero_conta_corrente": "6387", "codigo_banco": "341"},
    {"nCodCC": 222, "numero_conta_corrente": "996387", "codigo_banco": "341"},
]
try:
    resolver_conta_por_extrato(contas_ambiguas, "0341", "0655996387")
    checar("2 contas batendo (uma e sufixo da outra) deveria levantar", False)
except ContaBancariaAmbigua:
    checar("2 contas candidatas -> levanta, nunca escolhe uma sozinha", True)

try:
    resolver_conta_por_extrato(contas_omie, "0341", None)
    checar("ACCTID ausente deveria levantar", False)
except ContaBancariaAmbigua:
    checar("extrato sem ACCTID -> levanta", True)

print()
if falhas:
    print(f"{falhas} falha(s).")
    raise SystemExit(1)
print("Todos os testes passaram.")
