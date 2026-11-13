"""
Inspeção SÓ LEITURA das OSs de excedentes criadas à mão em novembro/2026
(nº 20019–20078): confirma se têm cCodIntOS EXC-* (idempotência do
reprocessamento) e mostra a estrutura real dos campos que o IncluirOS do
módulo precisa espelhar (dDtPrevisao, Parcelas, Email, InformacoesAdicionais).

    python scripts/excedentes_inspecionar_os.py --slug oystr --codigos EXC-202611-6,EXC-202611-69
    python scripts/excedentes_inspecionar_os.py --slug oystr --numeros 20019,20020
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.client import OmieClient, OmieNotFoundError  # noqa: E402
from omie_mcp.clients import ClientesRegistry  # noqa: E402


def _resumir(os_: dict) -> dict:
    cab = os_.get("Cabecalho") or {}
    inf = os_.get("InformacoesAdicionais") or {}
    email = os_.get("Email") or {}
    parcelas = os_.get("Parcelas") or []
    servicos = os_.get("ServicosPrestados") or []
    return {
        "nCodOS": cab.get("nCodOS"), "cNumOS": cab.get("cNumOS"),
        "cCodIntOS": cab.get("cCodIntOS"), "cEtapa": cab.get("cEtapa"),
        "dDtPrevisao": cab.get("dDtPrevisao"), "nCodCli": cab.get("nCodCli"),
        "nCodCtr": cab.get("nCodCtr"), "cCodParc": cab.get("cCodParc"),
        "nQtdeParc": cab.get("nQtdeParc"),
        "InformacoesAdicionais": inf,
        "Email": email,
        "Parcelas": parcelas,
        "Servicos": [
            {k: s.get(k) for k in ("nCodServico", "nQtde", "nValUnit",
                                   "cCodCategItem", "nSeqItem", "cDadosAdicItem")}
            for s in servicos
        ],
    }


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", default="oystr")
    ap.add_argument("--codigos", default="", help="cCodIntOS separados por vírgula")
    ap.add_argument("--numeros", default="", help="nCodOS/números separados por vírgula")
    args = ap.parse_args()

    settings = ClientesRegistry.load().settings_for(args.slug)
    async with OmieClient(settings) as client:
        for codigo in filter(None, args.codigos.split(",")):
            try:
                os_ = await client.call("servicos/os", "ConsultarOS",
                                        {"cCodIntOS": codigo.strip()})
                print(f"== {codigo} ==")
                print(json.dumps(_resumir(os_), ensure_ascii=False, indent=2))
            except OmieNotFoundError:
                print(f"== {codigo} == NÃO EXISTE")
        for numero in filter(None, args.numeros.split(",")):
            # ListarOS filtrando pelo número para achar o nCodOS.
            resposta = await client.call(
                "servicos/os", "ListarOS",
                {"pagina": 1, "registros_por_pagina": 5,
                 "cNumOS": numero.strip()})
            registros = (resposta.get("osCadastro") or resposta.get("os_cadastro")
                         or [])
            if not registros:
                print(f"== OS {numero} == não achada via ListarOS(cNumOS)")
                continue
            for os_ in registros:
                print(f"== OS {numero} ==")
                print(json.dumps(_resumir(os_), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
