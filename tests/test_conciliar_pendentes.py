"""Testes da memoria de transferencias pendentes (conciliar.py).

Cenario real: contas de uma empresa sao processadas em dias diferentes (ex.:
Itau hoje, Inter so amanha). Uma linha "parece transferencia, mas a outra
conta ainda nao apareceu" nao pode ser esquecida so porque a rodada de hoje
acabou — precisa ficar guardada ate uma rodada futura (de qualquer conta)
trazer o par.
"""

from __future__ import annotations

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from omie_mcp.conciliacao import Config, Contexto, Desfecho, Faixa, LinhaExtrato, Natureza, conciliar  # noqa: E402
from conciliar import _linha_de_dict, _serializar_linha, atualizar_pendentes  # noqa: E402

falhas = []


def checar(nome, cond, detalhe=""):
    if cond:
        print(f"  ok   {nome}")
    else:
        print(f"  FALHA {nome} — {detalhe}")
        falhas.append(nome)


def linha(id, dia, v, nat, desc, conta):
    return LinhaExtrato(
        id=id, conta_id=conta, data=date(2026, 8, dia), valor=Decimal(v),
        natureza=nat, descricao=desc, banco="itau",
    )


print("\n== A. Round-trip da serializacao (LinhaExtrato <-> dict) ==")
original = linha("X1", 6, "20000.00", Natureza.CREDITO, "TRANSF ENTRE CONTAS", "CC_A")
voltou = _linha_de_dict(_serializar_linha(original))
checar("mesmo id/conta/valor/natureza/descricao apos ida e volta",
       voltou.id == original.id and voltou.conta_id == original.conta_id
       and voltou.valor == original.valor and voltou.natureza == original.natureza
       and voltou.descricao == original.descricao)

print("\n== B. Rodada 1 (so a conta A): linha vira 'aguardando', entra na memoria ==")
linha_a = linha("D6-A", 6, "20000.00", Natureza.CREDITO, "TRANSF ENTRE CONTAS", "CC_A")
resultados_1 = conciliar(
    Contexto(linhas=[linha_a], titulos=[], hoje=date(2026, 8, 6)),
    Config(),
)
checar("cai em fila/revisao (aguardando a outra conta, dentro do prazo)",
       resultados_1[0].desfecho is Desfecho.FILA and resultados_1[0].faixa is Faixa.REVISAO,
       (resultados_1[0].desfecho, resultados_1[0].faixa))

ainda_pendentes_1, novas_1 = atualizar_pendentes(resultados_1, ids_pendentes_antes=set())
checar("nao havia pendente antes, entao 'ainda_pendentes' fica vazio", len(ainda_pendentes_1) == 0)
checar("a linha nova vira 'aguardando' na memoria", len(novas_1) == 1 and novas_1[0].id == "D6-A")

print("\n== C. Rodada 2 (so a conta B, dia seguinte): pareia com a memoria da rodada 1 ==")
pendentes_json = [_serializar_linha(l) for l in (ainda_pendentes_1 + novas_1)]
linhas_pendentes_2 = [_linha_de_dict(p) for p in pendentes_json]
ids_pendentes_antes_2 = {l.id for l in linhas_pendentes_2}

linha_b = linha("D7-B", 7, "20000.00", Natureza.DEBITO, "TRANSF ENTRE CONTAS", "CC_B")
linhas_do_motor_2 = linhas_pendentes_2 + [linha_b]
resultados_2 = conciliar(
    Contexto(linhas=linhas_do_motor_2, titulos=[], hoje=date(2026, 8, 7)),
    Config(),
)
por_id = {r.linha.id: r for r in resultados_2}
checar("a linha nova (conta B) resolve como transferencia",
       por_id["D7-B"].desfecho is Desfecho.TRANSFERENCIA, por_id["D7-B"].desfecho)
checar("a linha pendente (conta A, de ontem) TAMBEM resolve como transferencia",
       por_id["D6-A"].desfecho is Desfecho.TRANSFERENCIA, por_id["D6-A"].desfecho)
checar("par aponta um pro outro corretamente",
       por_id["D7-B"].linha_par_id == "D6-A" and por_id["D6-A"].linha_par_id == "D7-B",
       (por_id["D7-B"].linha_par_id, por_id["D6-A"].linha_par_id))

ainda_pendentes_2, novas_2 = atualizar_pendentes(resultados_2, ids_pendentes_antes_2)
checar("a pendente de ontem foi RESOLVIDA — sai da memoria",
       len(ainda_pendentes_2) == 0, ainda_pendentes_2)
checar("nao ha novas pendentes nesta rodada", len(novas_2) == 0, novas_2)

print("\n== D. Rodada sem par: linha continua na memoria (nao resolve, nao desaparece) ==")
linha_sem_par = linha("D6-C", 6, "500.00", Natureza.CREDITO, "TRANSF ENTRE CONTAS", "CC_C")
resultados_3 = conciliar(
    Contexto(linhas=[linha_sem_par], titulos=[], hoje=date(2026, 8, 6)),
    Config(),
)
_, novas_3 = atualizar_pendentes(resultados_3, ids_pendentes_antes=set())
# rodada seguinte, ainda sem o par aparecer, mas ainda dentro do prazo de espera
resultados_4 = conciliar(
    Contexto(linhas=novas_3, titulos=[], hoje=date(2026, 8, 7)),
    Config(),
)
ainda_4, novas_4 = atualizar_pendentes(resultados_4, ids_pendentes_antes={"D6-C"})
checar("sem o par aparecer, a linha continua pendente (nao desaparece)",
       len(ainda_4) == 1 and ainda_4[0].id == "D6-C", ainda_4)

print("\n" + "=" * 50)
if falhas:
    print(f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("Todos os testes passaram.")
