"""
Grava um pacote do painel "Fluxo de caixa" (ja montado por exportar_pacote_
caixa.py + extrair_fluxo_caixa_portal.py + montar_painel_caixa.py) no Postgres
do painel-automacoes — tabela `caixa_pacote_diario` (migration 0003).

So le arquivo e escreve no banco; nao recalcula nada e nao chama o Omie.
A logica de negocio (o que cada base significa, como o extra e' calculado)
continua inteira em exportar_pacote_caixa.py/build_extra_dashboard_caixa.py
— este script e' so o "ultimo passo" novo, trocando arquivo local por banco.

Uso:
    python scripts\\gravar_pacote_caixa.py --pacote dados\\oystr\\2026-09-25

    --cliente   slug em clientes_omie.json (padrao: le do manifesto.json)
    --empresa-id  uuid direto, se por algum motivo o cliente nao tiver
                  empresa_id configurado em clientes_omie.json

Precisa de DATABASE_URL no ambiente (mesma connection string do painel-
automacoes — ver .env.local dele em dev, ou o segredo da VPS em producao).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp import db  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402

# manifesto e' o unico obrigatorio de verdade (tem a data de referencia e o
# slug do cliente); as bases sempre existem se exportar_pacote_caixa.py
# rodou, mas tratar como opcional (lista vazia) evita quebrar por um pacote
# parcial — melhor gravar o que tem do que abortar tudo.
BASES = (
    "recebimentos", "pagamentos", "receber_aberto", "pagar_aberto",
    "contratos_nao_faturados", "os_nao_faturadas", "status_contratos",
)


def _ler_json(caminho: Path):
    if not caminho.exists():
        return None
    return json.loads(caminho.read_text(encoding="utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pacote", required=True)
    ap.add_argument("--cliente", default=None)
    ap.add_argument("--empresa-id", default=None)
    args = ap.parse_args()

    pacote = Path(args.pacote).resolve()
    manifesto = _ler_json(pacote / "manifesto.json")
    if manifesto is None:
        print(f"[erro] falta manifesto.json em {pacote}")
        return 1

    slug = args.cliente or manifesto.get("cliente")
    empresa_id = args.empresa_id
    if empresa_id is None:
        try:
            registry = ClientesRegistry.load()
            cliente = registry.get(slug)
        except ClientesConfigError as exc:
            print(f"[config] {exc}")
            return 1
        if cliente.empresa_id is None:
            print(f"[erro] cliente '{slug}' nao tem empresa_id configurado em "
                  "clientes_omie.json (necessario pra saber em qual empresa do "
                  "painel-automacoes gravar) — use --empresa-id pra contornar.")
            return 1
        empresa_id = cliente.empresa_id

    ref = manifesto.get("ref")
    if not ref:
        print(f"[erro] manifesto.json sem campo 'ref' (data de referencia) em {pacote}")
        return 1
    data_ref = datetime.strptime(ref, "%Y-%m-%d").date()

    bases = {nome: (_ler_json(pacote / f"{nome}.json") or []) for nome in BASES}
    extrato = _ler_json(pacote / "extrato.json")
    extra = _ler_json(pacote / "extra.json")
    checagem = _ler_json(pacote / "checagem.json")

    try:
        conn = db.conectar()
    except RuntimeError as exc:
        print(f"[config] {exc}")
        return 1

    with conn:
        db.gravar_pacote_caixa_diario(
            conn, empresa_id=empresa_id, data_ref=data_ref, manifesto=manifesto,
            extrato=extrato, extra=extra, checagem=checagem, **bases,
        )

    print(f"Pacote de {slug} ({data_ref}) gravado em caixa_pacote_diario "
          f"(empresa_id={empresa_id}).")
    if extra is None:
        print("[aviso] extra.json ausente — rode montar_painel_caixa.py antes "
              "pra ter os agregados do painel.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
