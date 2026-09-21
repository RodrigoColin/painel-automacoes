"""Testes da metrica do modo sombra — sem rede, sem API Omie.

Cobre o achado da revisao adversarial de 2026-09-19: a comparacao antiga
aceitava qualquer desfecho != TITULO como acerto sempre que o gabarito nao
apontava titulo_id, inclusive contando transferencia como se fosse
lancamento direto (ou vice-versa).
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from omie_mcp.conciliacao import Desfecho, Faixa, LinhaExtrato, Natureza  # noqa: E402
from omie_mcp.conciliacao.modelos import Resultado  # noqa: E402
from modo_sombra import bateu, indexar_gabarito  # noqa: E402

falhas = []


def checar(nome, cond, detalhe=""):
    if cond:
        print(f"  ok   {nome}")
    else:
        print(f"  FALHA {nome} — {detalhe}")
        falhas.append(nome)


def linha(id, dia, valor, natureza):
    return LinhaExtrato(
        id=id, conta_id="cc", data=date(2026, 9, dia), valor=Decimal(valor),
        natureza=natureza, descricao="X", banco="itau",
    )


print("\n== A. bateu(): titulo exige o MESMO titulo_id, nao so 'e titulo' ==")
r = Resultado(linha=linha("a", 10, "100", Natureza.DEBITO), desfecho=Desfecho.TITULO,
              faixa=Faixa.AUTOMATICO)
checar("sem candidato nunca bate com titulo esperado",
       not bateu(r, {"titulo_id": "T1", "tipo": "titulo"}))

print("\n== B. bateu(): transferencia esperada NAO aceita lanc_direto (nem vice-versa) ==")
r_direto = Resultado(linha=linha("b", 10, "50", Natureza.DEBITO),
                      desfecho=Desfecho.LANCAMENTO_DIRETO, faixa=Faixa.AUTOMATICO)
checar("lanc_direto do motor nao bate com transferencia esperada (bug antigo)",
       not bateu(r_direto, {"titulo_id": None, "tipo": "transferencia"}))
r_transf = Resultado(linha=linha("c", 10, "50", Natureza.DEBITO),
                      desfecho=Desfecho.TRANSFERENCIA, faixa=Faixa.AUTOMATICO)
checar("transferencia do motor bate com transferencia esperada",
       bateu(r_transf, {"titulo_id": None, "tipo": "transferencia"}))
checar("transferencia do motor NAO bate com lanc_direto esperado",
       not bateu(r_transf, {"titulo_id": None, "tipo": "lanc_direto"}))

print("\n== C. bateu(): gabarito sem 'tipo' nunca conta como acerto por omissao ==")
checar("tipo ausente no gabarito nao vira acerto automatico",
       not bateu(r_direto, {"titulo_id": None}))

print("\n== D. indexar_gabarito: tolera +-1 dia (compensacao bancaria) ==")
l = linha("d", 10, "100.00", Natureza.DEBITO)
gabarito_bruto = {
    f"{(date(2026, 9, 9)).isoformat()}|-100.00": [{"titulo_id": "T9", "tipo": "titulo"}],
}
indexado = indexar_gabarito(gabarito_bruto, [l], por_data_valor=True)
checar("casou com o dia anterior dentro da tolerancia",
       indexado.get("d", {}).get("titulo_id") == "T9", indexado)

print("\n== E. indexar_gabarito: colisao na mesma chave desambigua por texto ==")


def linha_desc(id, dia, v, nat, desc):
    return LinhaExtrato(
        id=id, conta_id="cc", data=date(2026, 9, dia), valor=Decimal(v),
        natureza=nat, descricao=desc, banco="itau",
    )


l_google = linha_desc("g", 6, "814.00", Natureza.DEBITO, "PAGAMENTOS GOOGLE BRASIL INTERNET LTDA")
l_facebook = linha_desc("f", 6, "814.00", Natureza.DEBITO, "PAGAMENTOS FACEBOOK SERVICOS ONLINE DO BRASIL LTDA")
chave_colisao = f"{date(2026, 9, 6).isoformat()}|-814.00"
gabarito_colisao = {
    chave_colisao: [
        {"titulo_id": "GOOGLE", "tipo": "titulo", "observacao": "PAGAMENTOS PIX QRCODE GOOGLE BRASIL INTERNET LTDA"},
        {"titulo_id": "FACEBOOK", "tipo": "titulo", "observacao": "PAGAMENTOS PIX QRCODE FACEBOOK SERVICOS ONLINE DO BRASIL LTDA"},
    ],
}
indexado2 = indexar_gabarito(gabarito_colisao, [l_google, l_facebook], por_data_valor=True)
checar("linha do Google casou com o titulo_id do Google, nao o do Facebook",
       indexado2.get("g", {}).get("titulo_id") == "GOOGLE", indexado2)
checar("linha do Facebook casou com o titulo_id do Facebook",
       indexado2.get("f", {}).get("titulo_id") == "FACEBOOK", indexado2)

print("\n" + "=" * 50)
if falhas:
    print(f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("Todos os testes passaram.")
