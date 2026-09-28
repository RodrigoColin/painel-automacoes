"""
Cliente do Infisical em Python.

Espelha src/lib/infisical/api.ts (Next.js) — sem poder reusar aquele
codigo, porque o motor Python roda como PROCESSO SEPARADO, nao dentro do
runtime Node. Decisao 2026-09-28: a rotina do painel de caixa e chamada
direto pelo n8n/cron, sem passar pelo Next.js (pra nao precisar instalar
Python/pandas dentro do container da aplicacao) — entao, ao contrario da
conciliacao bancaria (onde o Node ja busca a credencial e repassa),
ninguem entrega a credencial pronta ao Python aqui; ele busca sozinho.

Autenticacao por Universal Auth, mesmas variaveis de ambiente que o app
Next.js ja usa:
    INFISICAL_SITE_URL       (opcional; padrao https://app.infisical.com)
    INFISICAL_CLIENT_ID
    INFISICAL_CLIENT_SECRET
"""

from __future__ import annotations

import os
import time

import httpx

_SITE_PADRAO = "https://app.infisical.com"
_TIMEOUT = 15.0

# client_id -> (token, expira_em) — mesmo cache de curta duracao do api.ts,
# reaproveitado ate perto de expirar em vez de autenticar a cada chamada.
_token_cache: dict[str, tuple[str, float]] = {}


class InfisicalError(Exception):
    """Erro ao falar com o Infisical (config ausente, auth, rede)."""


def _site_url() -> str:
    return (os.environ.get("INFISICAL_SITE_URL") or _SITE_PADRAO).rstrip("/")


def _credenciais() -> tuple[str, str]:
    client_id = os.environ.get("INFISICAL_CLIENT_ID", "").strip()
    client_secret = os.environ.get("INFISICAL_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise InfisicalError(
            "INFISICAL_CLIENT_ID/INFISICAL_CLIENT_SECRET ausentes no "
            "ambiente — sao as mesmas variaveis que o painel-automacoes "
            "(Next.js) ja usa pra falar com o Infisical."
        )
    return client_id, client_secret


def _obter_token() -> str:
    client_id, client_secret = _credenciais()
    em_cache = _token_cache.get(client_id)
    if em_cache and time.time() < em_cache[1] - 60:
        return em_cache[0]

    try:
        resp = httpx.post(
            f"{_site_url()}/api/v1/auth/universal-auth/login",
            json={"clientId": client_id, "clientSecret": client_secret},
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise InfisicalError(f"Falha ao contatar o Infisical: {exc}") from exc
    if resp.status_code != 200:
        raise InfisicalError(
            f"Falha ao autenticar no Infisical (HTTP {resp.status_code}): {resp.text[:300]}"
        )

    corpo = resp.json()
    token = corpo["accessToken"]
    _token_cache[client_id] = (token, time.time() + corpo.get("expiresIn", 0))
    return token


def ler_segredos(projeto_id: str, ambiente: str, caminho: str) -> dict[str, str]:
    """Le os segredos de uma pasta do Infisical. Pasta inexistente devolve
    vazio (mesmo comportamento do lerSegredos() em TypeScript) — quem
    chama decide se a ausencia e' erro."""
    token = _obter_token()
    try:
        resp = httpx.get(
            f"{_site_url()}/api/v4/secrets",
            params={
                "projectId": projeto_id,
                "environment": ambiente,
                "secretPath": caminho,
                "viewSecretValue": "true",
            },
            headers={"Authorization": f"Bearer {token}"},
            timeout=_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise InfisicalError(f"Falha ao contatar o Infisical: {exc}") from exc

    if resp.status_code == 404:
        return {}
    if resp.status_code != 200:
        raise InfisicalError(
            f"Falha ao ler segredos do Infisical em '{caminho}' "
            f"(HTTP {resp.status_code}): {resp.text[:300]}"
        )

    corpo = resp.json()
    return {s["secretKey"]: s["secretValue"] for s in corpo.get("secrets", [])}


def buscar_credenciais_omie(empresa_id: str) -> tuple[str, str]:
    """App Key/App Secret do Omie de uma empresa, vindos do Infisical —
    resolve o caminho da pasta via Postgres (mesmo DATABASE_URL do
    painel-automacoes; ver omie_mcp.db.buscar_config_infisical) antes de
    buscar os segredos propriamente ditos.
    """
    from . import db  # import tardio: so exige psycopg/DATABASE_URL quando Infisical e' usado

    conn = db.conectar()
    try:
        config = db.buscar_config_infisical(conn, empresa_id)
    finally:
        conn.close()

    if config is None:
        raise InfisicalError(
            f"Empresa {empresa_id} sem pasta configurada no Infisical "
            "(infisical_caminhos_clientes) ou integracao_infisical_plataforma "
            "ausente — cadastre a empresa na tela Configuracoes/Resumo Omie "
            "do painel antes de usar essa credencial."
        )
    projeto_id, ambiente, caminho = config

    segredos = ler_segredos(projeto_id, ambiente, caminho)
    app_key = segredos.get("OMIE_APP_KEY")
    app_secret = segredos.get("OMIE_APP_SECRET")
    if not app_key or not app_secret:
        raise InfisicalError(
            f"OMIE_APP_KEY/OMIE_APP_SECRET nao encontrados em '{caminho}' "
            "no Infisical (empresa cadastrada, mas sem as chaves do Omie "
            "preenchidas)."
        )
    return app_key, app_secret
