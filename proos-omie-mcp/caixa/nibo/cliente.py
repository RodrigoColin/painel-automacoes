"""
Cliente HTTP da API Nibo Empresas (api.nibo.com.br/empresas/v1).

Autenticação por header `ApiToken` (NÃO `Authorization`). Consultas em OData:
`$filter`, `$orderby` (obrigatório pra paginar), `$top` (máx 500), `$skip`;
toda resposta de lista traz `items` + `count`. Datas em filtro OData são ISO
puro, sem aspas: `accrualDate ge 2025-01-01`.

IMPORTANTE (token curto): sem o add-on "API Pública" no plano, o token do Nibo
expira em poucos dias e NÃO tem refresh programático — quem renova é uma
pessoa, colando um token novo. Por isso 401/403 viram `NiboTokenExpirado`, um
erro claro que a rodada traduz em "dados de DD/MM — token Nibo expirado, cole
um novo" sem derrubar o último pacote bom.
"""

from __future__ import annotations

import time
from typing import Any, Callable

import requests

BASE = "https://api.nibo.com.br/empresas/v1"
_TOP = 500
_TIMEOUT = 60
_ESPERA_429 = 5.0


class NiboError(RuntimeError):
    """Falha ao falar com a API do Nibo."""


class NiboTokenExpirado(NiboError):
    """Token do Nibo expirado ou inválido (HTTP 401/403) — precisa de um novo,
    colado por uma pessoa (sem API Pública não há refresh automático)."""


class NiboClient:
    def __init__(self, token: str, *, log: Callable[[str], None] = print):
        if not token or not str(token).strip():
            raise NiboTokenExpirado("Token do Nibo ausente.")
        self._token = str(token).strip()
        self._log = log

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        url = f"{BASE}/{path.lstrip('/')}"
        for tentativa in range(4):
            resp = requests.get(url, headers={"ApiToken": self._token}, params=params, timeout=_TIMEOUT)
            if resp.status_code in (401, 403):
                raise NiboTokenExpirado(
                    f"Nibo recusou o token (HTTP {resp.status_code}) em {path}. "
                    "Gere um token novo na empresa (Configurações > API) e atualize-o."
                )
            if resp.status_code == 429 and tentativa < 3:
                self._log(f"    Nibo pediu para esperar (429). Aguardando {_ESPERA_429}s")
                time.sleep(_ESPERA_429 * (tentativa + 1))
                continue
            if resp.status_code != 200:
                raise NiboError(f"Nibo ({path}) HTTP {resp.status_code}: {resp.text[:300]}")
            try:
                return resp.json()
            except ValueError as exc:
                raise NiboError(f"Nibo ({path}): resposta não-JSON: {resp.text[:200]}") from exc
        raise NiboError(f"Nibo ({path}): tentativas esgotadas")

    def listar(self, path: str, *, filtro: str | None = None, orderby: str = "id") -> list[dict[str, Any]]:
        """Percorre todas as páginas de um recurso OData e devolve os `items`."""
        out: list[dict[str, Any]] = []
        skip = 0
        while True:
            params: dict[str, Any] = {"$top": _TOP, "$skip": skip, "$orderby": orderby}
            if filtro:
                params["$filter"] = filtro
            corpo = self._get(path, params)
            itens = corpo.get("items", []) if isinstance(corpo, dict) else []
            out += itens
            if len(itens) < _TOP:
                break
            skip += _TOP
        return out

    def extrato(self, account_id: str, inicio_iso: str, fim_iso: str) -> list[dict[str, Any]]:
        """Extrato (views/statement) de uma conta no período [inicio, fim].
        A 1ª linha é `type=StartAccountBalance` (saldo no início do período);
        as demais são movimentos reais, cada uma com `currentBalance` (saldo
        corrente acumulado), `date`, `value` (com sinal), `scheduleId` (link
        para o agendamento, quando houver), `stakeholderName` e `isTransfer`."""
        out: list[dict[str, Any]] = []
        skip = 0
        while True:
            params = {
                "startDate": inicio_iso, "endDate": fim_iso,
                "$top": _TOP, "$skip": skip, "$orderby": "date",
            }
            corpo = self._get(f"accounts/{account_id}/views/statement", params)
            itens = corpo.get("items", []) if isinstance(corpo, dict) else []
            out += itens
            if len(itens) < _TOP:
                break
            skip += _TOP
        return out
