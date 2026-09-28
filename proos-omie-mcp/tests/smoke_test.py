"""
Smoke test de conexão real com o Omie.

Roda uma chamada simples (ListarClientes, 1 página, poucos registros) para
confirmar que app_key/app_secret estão corretos e que a conta tem acesso à
API. Não faz nenhuma escrita.

Uso (cliente único, via .env):
    python tests/smoke_test.py

Uso (múltiplos clientes, via clientes_omie.json):
    python tests/smoke_test.py --cliente oystr
    python tests/smoke_test.py --listar-clientes   # só mostra os slugs configurados
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.client import OmieAPIError, OmieClient, OmieNotFoundError  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.tools import clientes  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cliente", default=None,
        help="slug do cliente Proos a testar (ver --listar-clientes). "
             "Opcional se só houver um cliente configurado.",
    )
    parser.add_argument(
        "--listar-clientes", action="store_true",
        help="só lista os clientes configurados (slug/nome/ativo) e sai.",
    )
    args = parser.parse_args()

    try:
        registry = ClientesRegistry.load()
    except ClientesConfigError as exc:
        print(f"[config] {exc}")
        return 1

    if args.listar_clientes:
        for c in registry.listar():
            status = "ativo" if c.ativo else "INATIVO"
            print(f"- {c.slug}  ({c.nome}, {status})")
        return 0

    try:
        slug = registry.resolver_slug(args.cliente)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"[config] {exc}")
        return 1

    print(f"[ok] Cliente: {slug} (app_key={settings.app_key[:4]}...)")
    print("[..] Chamando ListarClientes (1 página, teste de conexão)...")

    try:
        async with OmieClient(settings) as client:
            registros = await clientes.listar_clientes(client, max_paginas=1)
    except OmieNotFoundError:
        print("[ok] Conexão funcionando — porém nenhum cliente cadastrado ainda.")
        return 0
    except OmieAPIError as exc:
        print(f"[erro-omie] {exc} (fault_code={exc.fault_code})")
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"[erro] {type(exc).__name__}: {exc}")
        return 1

    print(f"[ok] Conexão bem-sucedida! {len(registros)} registro(s) na 1ª página.")
    if registros:
        print("Exemplo de registro (primeiras chaves):")
        primeiro = registros[0]
        preview = {k: primeiro[k] for k in list(primeiro)[:8]}
        print(json.dumps(preview, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
