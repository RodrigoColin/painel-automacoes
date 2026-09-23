"""Processa um extrato OFX isolado e devolve um resumo em JSON — sem Omie,
sem titulos, sem escrita nenhuma. E o primeiro degrau da tela "Conciliacao
Bancaria" do Portal Proos: confirma que upload -> execucao -> confirmacao
funciona ponta a ponta antes de plugar o motor de conciliacao completo
(que exige titulos.json ja exportado do Omie).

Uso:
    python scripts/processar_extrato_simples.py --arquivo extrato.ofx \
        --empresa-id a500bee4-6eab-4878-b5ad-7ff792817662

`--empresa-id` (uuid da empresa no painel-automacoes) e opcional — quando
informado, resolve qual cliente/credencial Omie foi vinculado a essa
empresa (ClienteOmie.empresa_id em clientes_omie.json). A maioria das
empresas nao tem vinculo ainda; isso NAO e erro, so aparece como
cliente_slug/cliente_nome nulos na saida.

Saida (stdout, uma linha JSON): {"linhas": N, "periodo_inicio": "AAAA-MM-DD",
"periodo_fim": "AAAA-MM-DD", "movimento_liquido": "123.45",
"banco_detectado": "itau" | null, "cliente_slug": "proos" | null,
"cliente_nome": "Proos" | null}

Erro (stdout, ainda JSON, exit code != 0): {"erro": "..."}
"""

from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path

# Sem isso, print(json.dumps(...)) quebra com UnicodeEncodeError se o nome
# do cliente/banco tiver acento — o stdout do Windows cai no codepage do
# console (cp1252) em vez de UTF-8 fora de um terminal que ja force isso
# (achado real, 2026-09-22, mesma causa do fix em conciliar_extrato_painel.py).
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.conciliacao import ofx  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--arquivo", type=Path, required=True)
    ap.add_argument("--conta-id", default="c")
    ap.add_argument("--empresa-id", default=None)
    args = ap.parse_args()

    if not args.arquivo.exists():
        print(json.dumps({"erro": f"arquivo nao encontrado: {args.arquivo}"}))
        return 1

    try:
        linhas = ofx.ler_arquivo(args.arquivo, conta_id=args.conta_id)
    except Exception as exc:  # noqa: BLE001 — erro de parsing precisa chegar legivel no front
        print(json.dumps({"erro": f"falha ao ler o OFX: {exc}"}))
        return 1

    if not linhas:
        print(json.dumps({"erro": "nenhuma linha reconhecida no arquivo (formato OFX valido?)"}))
        return 1

    cliente_slug = None
    cliente_nome = None
    if args.empresa_id:
        try:
            registry = ClientesRegistry.load()
            cliente = registry.resolver_por_empresa_id(args.empresa_id)
        except ClientesConfigError as exc:
            print(json.dumps({"erro": str(exc)}))
            return 1
        if cliente is not None:
            cliente_slug = cliente.slug
            cliente_nome = cliente.nome

    datas = [l.data for l in linhas]
    movimento = sum((l.valor_com_sinal for l in linhas), Decimal("0"))

    resumo = {
        "linhas": len(linhas),
        "periodo_inicio": min(datas).isoformat(),
        "periodo_fim": max(datas).isoformat(),
        "movimento_liquido": str(movimento),
        "banco_detectado": linhas[0].banco,
        "cliente_slug": cliente_slug,
        "cliente_nome": cliente_nome,
    }
    print(json.dumps(resumo, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
