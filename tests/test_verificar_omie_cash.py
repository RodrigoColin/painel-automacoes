"""Testes de `conciliar.verificar_contas_omie_cash` — o guard fail-closed
contra escrever numa conta Omie.CASH.

Achado real da revisao adversarial do Codex (2026-09-21): o guard original
tinha um unico `except Exception` que liberava a execucao (`return True`)
mesmo com `--gravar` ativo — uma falha transitoria da API na hora exata da
checagem abria uma janela pra gravar numa conta Omie.CASH sem ninguem
perceber. Corrigido com o parametro `exigir` (False = so aviso, usado na
checagem cedo/informativa; True = fail-closed, usado na checagem final
logo antes de `--gravar` de verdade).
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import omie_mcp.client as client_mod  # noqa: E402
import omie_mcp.clients as clients_mod  # noqa: E402
import omie_mcp.tools.contas_correntes as contas_mod  # noqa: E402
from conciliar import verificar_contas_omie_cash  # noqa: E402

falhas = 0


def checar(nome: str, condicao: bool, detalhe=None) -> None:
    global falhas
    status = "ok" if condicao else "FALHA"
    if not condicao:
        falhas += 1
    print(f"  {status}   {nome}" + (f" -> {detalhe!r}" if not condicao else ""))


class _ClienteFalso:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _RegistryFalso:
    def settings_for(self, slug):
        return object()


def _instalar_fakes(cash_ou_excecao):
    clients_mod.ClientesRegistry.load = staticmethod(lambda: _RegistryFalso())
    client_mod.OmieClient = lambda settings: _ClienteFalso()

    async def _contas_omie_cash_falso(client):
        if isinstance(cash_ou_excecao, Exception):
            raise cash_ou_excecao
        return cash_ou_excecao

    contas_mod.contas_omie_cash = _contas_omie_cash_falso


_load_original = clients_mod.ClientesRegistry.load
_omie_client_original = client_mod.OmieClient
_contas_omie_cash_original = contas_mod.contas_omie_cash

try:
    print("Checagem cedo (exigir=False)")
    _instalar_fakes(set())
    ok = asyncio.run(verificar_contas_omie_cash("cliente", {"111"}, exigir=False))
    checar("sem conta cash -> segue", ok is True)

    _instalar_fakes({"111"})
    ok = asyncio.run(verificar_contas_omie_cash("cliente", {"111"}, exigir=False))
    checar("conta cash encontrada -> bloqueia mesmo com exigir=False", ok is False)

    _instalar_fakes(RuntimeError("Omie fora do ar"))
    ok = asyncio.run(verificar_contas_omie_cash("cliente", {"111"}, exigir=False))
    checar("API falha, exigir=False (dry-run) -> segue com aviso (fail-open)", ok is True)

    print("\nChecagem final (exigir=True) — usada logo antes de --gravar")
    _instalar_fakes(set())
    ok = asyncio.run(verificar_contas_omie_cash("cliente", {"111"}, exigir=True))
    checar("sem conta cash -> segue", ok is True)

    _instalar_fakes({"111"})
    ok = asyncio.run(verificar_contas_omie_cash("cliente", {"111"}, exigir=True))
    checar("conta cash encontrada -> bloqueia", ok is False)

    _instalar_fakes(RuntimeError("Omie fora do ar"))
    ok = asyncio.run(verificar_contas_omie_cash("cliente", {"111"}, exigir=True))
    checar("API falha, exigir=True (--gravar) -> BLOQUEIA (fail-closed, nao fail-open)",
           ok is False)
finally:
    clients_mod.ClientesRegistry.load = _load_original
    client_mod.OmieClient = _omie_client_original
    contas_mod.contas_omie_cash = _contas_omie_cash_original

print()
if falhas:
    print(f"{falhas} falha(s).")
    raise SystemExit(1)
print("Todos os testes passaram.")
