"""Testes de scripts/decidir_linha_conciliacao.py — o fechamento do loop de
aprendizado: 3 decisoes com o mesmo padrao de descricao levam
`sombra/{slug}/regras.json` a `confirmacoes == 3`, uma auditoria cresce em
`sombra/{slug}/decisoes.json` a cada chamada, uma 4a linha do mesmo padrao
sai automatica numa nova rodada de conciliar_extrato_painel.py, e uma
decisao `desfecho=titulo` nunca mexe em regra nenhuma (guard de
aprendizado.registrar_decisao).

Roda dentro de um diretorio temporario (muda o cwd) pra nao depender nem
mexer nos arquivos reais de sombra/ deste repo.
"""

import argparse
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import decidir_linha_conciliacao as dlc  # noqa: E402
import conciliar_extrato_painel as cep  # noqa: E402

falhas = []


def checar(n: str, c: bool, d: str = "") -> None:
    print(("  ok   " if c else "  FALHA ") + n + ("" if c else f" — {d}"))
    if not c:
        falhas.append(n)


EMPRESA_ID = "11111111-1111-1111-1111-111111111111"


def payload_copel(numero: int) -> dict:
    return {
        "linha": {
            "linha_id": f"T{numero}", "conta_id": "2117565727",
            "data": f"2026-09-0{numero}", "valor": "-450.00",
            "descricao": f"DEBITO AUTOMATICO COPEL 0{numero}/09",
        },
        "sugestao_motor": {"desfecho": "fila", "faixa": "excecao", "tipo_excecao": "sem_titulo_saida"},
        "decisao": {"desfecho": "lanc_direto", "categoria": "Energia Eletrica", "observacao": f"teste {numero}"},
    }


args_padrao = argparse.Namespace(empresa_id=EMPRESA_ID, quem="teste@proos.com.br")

cwd_original = os.getcwd()
with tempfile.TemporaryDirectory() as tmp:
    os.chdir(tmp)
    try:
        Path("clientes_omie.json").write_text(json.dumps({
            "clientes": [{
                "slug": "teste-loop", "nome": "Teste Loop",
                "omie_app_key": "dummy", "omie_app_secret": "dummy",
                "empresa_id": EMPRESA_ID,
            }]
        }), encoding="utf-8")

        print("\nA. 3 decisoes do mesmo padrao viram uma regra com 3 confirmacoes")
        for i in (1, 2, 3):
            codigo = dlc._rodar(args_padrao, payload_copel(i))
            checar(f"chamada {i} termina sem erro", codigo == 0)

        regras = json.loads(Path("sombra", "teste-loop", "regras.json").read_text(encoding="utf-8"))
        checar("uma unica regra criada", len(regras) == 1, regras)
        checar("3 confirmacoes", regras and regras[0]["confirmacoes"] == 3, regras)
        checar("categoria guardada", regras and regras[0]["categoria"] == "Energia Eletrica")

        decisoes = json.loads(Path("sombra", "teste-loop", "decisoes.json").read_text(encoding="utf-8"))
        checar("3 entradas na auditoria", len(decisoes) == 3, len(decisoes))

        print("\nB. Decisao de TITULO nunca mexe em regra (evento unico)")
        payload_titulo = {
            "linha": {"linha_id": "T99", "conta_id": "2117565727", "data": "2026-09-10",
                      "valor": "500.00", "descricao": "PIX RECEBIDO FULANO"},
            "sugestao_motor": None,
            "decisao": {"desfecho": "titulo", "titulo_id": "T123"},
        }
        codigo = dlc._rodar(args_padrao, payload_titulo)
        checar("termina sem erro", codigo == 0)
        regras_depois = json.loads(Path("sombra", "teste-loop", "regras.json").read_text(encoding="utf-8"))
        checar("regras.json inalterado", len(regras_depois) == 1, regras_depois)
        decisoes_depois = json.loads(Path("sombra", "teste-loop", "decisoes.json").read_text(encoding="utf-8"))
        checar("mas a auditoria cresce mesmo assim", len(decisoes_depois) == 4, len(decisoes_depois))

        print("\nC. desfecho=fila e rejeitado (adiar e so nao chamar o script)")
        payload_fila = dict(payload_copel(5))
        payload_fila["decisao"] = {"desfecho": "fila"}
        codigo = dlc._rodar(args_padrao, payload_fila)
        checar("erro (exit code != 0)", codigo != 0)

        print("\nD. 4a linha do mesmo padrao ja sai automatica numa nova rodada do motor")
        Path("sombra", "teste-loop", "titulos.json").write_text("[]", encoding="utf-8")
        ofx_texto = """OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKACCTFROM>
<BANKID>0341
<ACCTID>2117565727
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260904
<TRNAMT>-450.00
<FITID>T4NOVO
<MEMO>DEBITO AUTOMATICO COPEL 04/09
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1000.00
<DTASOF>20260904
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
"""
        Path("extrato.ofx").write_text(ofx_texto, encoding="utf-8")
        args_painel = argparse.Namespace(
            arquivo=Path("extrato.ofx"), empresa_id=EMPRESA_ID,
            conta_omie="2117565727", atualizar_titulos=False,
        )
        import asyncio
        captura = io.StringIO()
        with redirect_stdout(captura):
            codigo = asyncio.run(cep._rodar(args_painel))
        checar("termina sem erro", codigo == 0)
        saida = json.loads(captura.getvalue().strip().split("\n")[-1])
        checar("regra foi carregada", saida.get("regras_carregadas") == 1, saida.get("regras_carregadas"))
        resultado_4a_linha = saida["resultados"][0]
        checar("desfecho pela regra", resultado_4a_linha["desfecho"] == "lanc_direto", resultado_4a_linha)
        checar("faixa automatica (fila encolheu)", resultado_4a_linha["faixa"] == "automatico", resultado_4a_linha)
    finally:
        os.chdir(cwd_original)

print("\n" + "=" * 50)
if falhas:
    print(f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("Todos os testes passaram.")
