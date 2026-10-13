"""Config de conciliacao por empresa — lida de caixa/conciliacao_config.json.

Na VPS nao existem os sombra/{slug}/regras.json (gitignored) nem o
clientes_omie.json; este arquivo versionado (nao-secreto) carrega, por
empresa_id, o tuning do motor (dias_antes, decompor_boleto) e as regras
aprendidas do cliente. Empresa fora da lista usa o default do motor.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from omie_mcp.conciliacao import Config, RegraCliente, regras_de_json

_ARQUIVO = Path(__file__).with_name("conciliacao_config.json")
_cache: dict[str, Any] | None = None


def _dados() -> dict[str, Any]:
    global _cache
    if _cache is None:
        _cache = json.loads(_ARQUIVO.read_text(encoding="utf-8"))
    return _cache


def para_empresa(empresa_id: str) -> dict[str, Any]:
    """{slug, dias_antes, decompor_boleto, regras} da empresa — ou defaults."""
    cfg = _dados().get(str(empresa_id)) or {}
    return {
        "slug": cfg.get("slug"),
        "dias_antes": int(cfg.get("dias_antes", Config().dias_antes)),
        "decompor_boleto": bool(cfg.get("decompor_boleto", False)),
        "regras": cfg.get("regras", []),
    }


def montar_config(empresa_id: str) -> Config:
    """Config do motor com os overrides da empresa (demais campos no default)."""
    c = para_empresa(empresa_id)
    return Config(
        dias_antes=c["dias_antes"],
        decompor_boleto_recebido=c["decompor_boleto"],
    )


def regras_para(empresa_id: str) -> list[RegraCliente]:
    return regras_de_json(para_empresa(empresa_id)["regras"])
