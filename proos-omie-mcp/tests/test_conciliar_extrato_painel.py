"""Testes de `_localizar_titulos` (scripts/conciliar_extrato_painel.py) — a
convencao de onde procurar o titulos.json de um cliente, incluindo o
fallback pro arquivo legado da Proos (sombra/titulos.json, de antes da
convencao por-cliente sombra/{slug}/titulos.json existir).

Roda dentro de um diretorio temporario (muda o cwd) pra nao depender nem
mexer nos arquivos reais de sombra/ deste repo.
"""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import conciliar_extrato_painel as cep  # noqa: E402

falhas = []


def checar(n: str, c: bool, d: str = "") -> None:
    print(("  ok   " if c else "  FALHA ") + n + ("" if c else f" — {d}"))
    if not c:
        falhas.append(n)


print("\n_localizar_titulos — convencao por-cliente e fallback legado da Proos")
cwd_original = os.getcwd()
with tempfile.TemporaryDirectory() as tmp:
    os.chdir(tmp)
    try:
        checar("cliente sem nenhum arquivo -> None", cep._localizar_titulos("fulano") is None)

        Path("sombra", "fulano").mkdir(parents=True)
        Path("sombra", "fulano", "titulos.json").write_text("[]", encoding="utf-8")
        achado = cep._localizar_titulos("fulano")
        checar("acha sombra/{slug}/titulos.json quando existe",
               achado is not None and achado == Path("sombra", "fulano", "titulos.json"), achado)

        checar("proos sem nenhum arquivo (nem por-cliente nem legado) -> None",
               cep._localizar_titulos("proos") is None)

        Path("sombra", "titulos.json").write_text("[]", encoding="utf-8")
        achado_legado = cep._localizar_titulos("proos")
        checar("proos cai pro arquivo legado sombra/titulos.json quando nao ha por-cliente",
               achado_legado == Path("sombra", "titulos.json"), achado_legado)

        Path("sombra", "proos").mkdir(parents=True)
        Path("sombra", "proos", "titulos.json").write_text("[]", encoding="utf-8")
        achado_prioridade = cep._localizar_titulos("proos")
        checar("proos prefere sombra/proos/titulos.json sobre o legado quando os dois existem",
               achado_prioridade == Path("sombra", "proos", "titulos.json"), achado_prioridade)

        checar("outro cliente sem arquivo NUNCA cai pro legado da proos (so 'proos' tem esse fallback)",
               cep._localizar_titulos("ciclano") is None)
    finally:
        os.chdir(cwd_original)

print("\n" + "=" * 50)
if falhas:
    print(f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("Todos os testes passaram.")
