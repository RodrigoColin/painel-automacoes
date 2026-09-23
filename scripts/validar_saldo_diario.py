"""Validacao diaria de saldo: banco (extrato OFX) x Omie (ListarExtrato).

Compara o saldo de FECHAMENTO de cada dia, nao so o saldo final — um saldo
final batendo pode esconder dois erros que se cancelam (achado real: Proos,
2026-09-21, onde essa comparacao revelou que o Omie parou de importar
lancamentos reais da conta por volta de 09-11/09, com SISPAG SALARIOS como
maior ausente).

Sem flag nenhuma, so imprime a tabela no terminal (dry-run). Duas formas de
persistir em `public.validacao_saldo_diario` (migration 0037, mesmo
Supabase que o painel-automacoes le) — use a que estiver disponivel:

  --gravar          escreve direto via DATABASE_URL (psycopg) — exige a
                     connection string do Postgres configurada no ambiente.
  --exportar-json    grava um JSON com as linhas prontas pra upsert, SEM
                     precisar de DATABASE_URL — outro processo (ou uma
                     ferramenta com acesso ao Supabase, ex.: MCP) aplica
                     esse JSON depois. Existe porque a connection string
                     direta nem sempre esta configurada neste ambiente
                     (decisao de 2026-09-21).

`empresa_id` (o uuid da empresa no painel-automacoes) NUNCA e um parametro
de linha de comando — vem do campo "empresa_id" do proprio cliente em
clientes_omie.json. Isso e proposital, nao falta de flag: e o elo entre
"qual credencial Omie usar" (--cliente) e "sob qual tenant gravar dado
financeiro" no Supabase (RLS por empresa_id) — um --empresa-id livre,
digitado a mao, permite atribuir (por erro de copy-paste) o saldo real de
um cliente ao tenant de OUTRO cliente no painel (achado real da revisao
adversarial do Codex, 2026-09-21). Configure assim, uma vez, por cliente:

    {"slug": "proos", ..., "empresa_id": "a500bee4-6eab-4878-b5ad-7ff792817662"}

Uso:
    python scripts/validar_saldo_diario.py --cliente proos \\
        --conta 2117565727 --ofx extrato_setembro.ofx --exportar-json saida.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.conciliacao import ofx  # noqa: E402
from omie_mcp.tools import extrato  # noqa: E402


def _console_seguro(texto: str) -> str:
    enc = sys.stdout.encoding or "utf-8"
    return texto.encode(enc, errors="replace").decode(enc)


async def validar(args: argparse.Namespace) -> int:
    try:
        registry = ClientesRegistry.load()
        slug = registry.resolver_slug(args.cliente)
        cliente = registry.get(slug)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"\nERRO de configuracao de cliente: {exc}")
        return 1

    texto_ofx = Path(args.ofx).read_text(encoding="latin-1", errors="replace")
    saldos_banco = ofx.saldo_por_dia(texto_ofx, conta_id=args.conta)
    if not saldos_banco:
        print("\nERRO: nao consegui ler LEDGERBAL/saldo final desse OFX — "
              "confira se o arquivo tem a tag <LEDGERBAL>.")
        return 2

    desde = min(saldos_banco).strftime("%d/%m/%Y")
    ate = max(saldos_banco).strftime("%d/%m/%Y")

    print(f"Cliente: {slug}  |  conta {args.conta}  |  periodo {desde} a {ate}")

    async with OmieClient(settings) as client:
        saldos_omie = await extrato.saldo_por_dia(client, int(args.conta), desde, ate)

    # Movimento do PROPRIO dia (nao acumulado) — pedido do usuario
    # (2026-09-21): entrou - saiu de cada dia, pra achar EM QUE DIA um
    # problema comecou, nao so que ele existe. Uma diferenca acumulada
    # antiga persiste em todo saldo seguinte e esconde quando um dia novo
    # realmente diverge; o movimento do dia nao tem essa memoria.
    movimentos_banco = ofx.movimento_por_dia(texto_ofx, conta_id=args.conta)
    movimentos_omie = extrato.movimento_por_dia(saldos_omie)

    dias = sorted(set(saldos_banco) | set(saldos_omie))

    def _imprimir_tabela(titulo: str, banco: dict, omie: dict, contar_sem_dado_omie: bool) -> int:
        print(f"\n=== {titulo} ===")
        print(f"{'data':<12} {'banco':>16} {'omie':>16} {'diferenca':>16}")
        divergencias_local = 0
        sem_dado_omie_local = 0
        for d in dias:
            b = banco.get(d)
            o = omie.get(d)
            if b is not None and o is not None:
                diff = b - o
                if abs(diff) > 1:
                    divergencias_local += 1
                print(_console_seguro(
                    f"{d.isoformat():<12} {float(b):>16.2f} {float(o):>16.2f} {float(diff):>16.2f}"))
            elif b is None and o is None:
                continue  # nenhum dos dois tem esse dia nesta visao — nao imprime linha vazia
            else:
                motivo = "sem dado do banco" if b is None else "sem dado do Omie"
                if o is None and contar_sem_dado_omie:
                    sem_dado_omie_local += 1
                print(_console_seguro(
                    f"{d.isoformat():<12} {'-' if b is None else f'{float(b):.2f}':>16} "
                    f"{'-' if o is None else f'{float(o):.2f}':>16} {motivo:>16}"))
        print(f"\n{divergencias_local} dia(s) com diferenca > R$1,00", end="")
        if contar_sem_dado_omie:
            print(f" | {sem_dado_omie_local} dia(s) com movimento no banco e NENHUM "
                  "registro no Omie (mesma atencao de uma divergencia — pode ser "
                  "lancamento que nunca chegou no Omie)")
        else:
            print()
        return divergencias_local

    # "sem dado do Omie" (banco movimentou, Omie nao tem NENHUM registro
    # naquele dia) e o caso que precisa da MESMA atencao de uma diferenca de
    # valor — um par de lancamentos que nunca chegou no Omie pode ficar
    # escondido justamente aqui, sem nunca aparecer como "diferenca" (achado
    # da revisao adversarial do Codex, 2026-09-21). So conta essa contagem
    # extra na visao ACUMULADA — na visao de MOVIMENTO, um dia "sem par
    # consecutivo" e esperado (fins de semana, buracos), nao um alarme.
    _imprimir_tabela("Movimento do dia (nao acumulado)", movimentos_banco, movimentos_omie,
                      contar_sem_dado_omie=False)
    _imprimir_tabela("Saldo acumulado", saldos_banco, saldos_omie, contar_sem_dado_omie=True)
    print(f"\n{len(dias)} dia(s) no total (uniao banco + Omie).")

    if not args.gravar and not args.exportar_json:
        print("\nDRY-RUN — nada gravado/exportado (use --gravar ou --exportar-json).")
        return 0

    if not cliente.empresa_id:
        print(f"\nERRO: cliente '{slug}' nao tem \"empresa_id\" configurado em "
              "clientes_omie.json. --gravar/--exportar-json exigem isso — "
              "adicione o campo (uuid da empresa no painel-automacoes) na "
              "entrada desse cliente antes de rodar de novo. Isso NAO e um "
              "parametro de linha de comando de proposito: evita atribuir o "
              "saldo real de um cliente ao tenant de outro por erro de "
              "digitacao/copy-paste.")
        return 3
    empresa_id = cliente.empresa_id

    if args.exportar_json:
        linhas = [
            {
                "empresa_id": empresa_id,
                "conta_id": args.conta,
                "conta_descricao": args.conta_descricao,
                "data": d.isoformat(),
                "saldo_banco": str(saldos_banco[d]) if d in saldos_banco else None,
                "saldo_omie": str(saldos_omie[d]) if d in saldos_omie else None,
                "movimento_banco": str(movimentos_banco[d]) if d in movimentos_banco else None,
                "movimento_omie": str(movimentos_omie[d]) if d in movimentos_omie else None,
                "fonte_extrato": Path(args.ofx).name,
            }
            for d in dias
        ]
        args.exportar_json.write_text(
            json.dumps(linhas, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"\nEXPORTADO — {len(linhas)} linha(s) em {args.exportar_json} "
              f"(empresa_id={empresa_id}, de clientes_omie.json — aplique em "
              "public.validacao_saldo_diario, upsert por empresa_id+conta_id+data).")

    if args.gravar:
        from omie_mcp import db  # import tardio: so exige psycopg quando --gravar e usado

        conn = db.conectar()
        total = db.gravar_saldo_diario(
            conn,
            empresa_id=empresa_id,
            conta_id=args.conta,
            conta_descricao=args.conta_descricao,
            saldos_banco=saldos_banco,
            saldos_omie=saldos_omie,
            fonte_extrato=Path(args.ofx).name,
            movimentos_banco=movimentos_banco,
            movimentos_omie=movimentos_omie,
        )
        print(f"\nGRAVADO — {total} linha(s) em public.validacao_saldo_diario "
              f"(empresa_id={empresa_id}, de clientes_omie.json).")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cliente", required=True, help="slug em clientes_omie.json")
    ap.add_argument("--conta", required=True, help="nCodCC da conta corrente no Omie")
    ap.add_argument("--conta-descricao", default=None,
                     help="nome legivel da conta pro painel (ex.: 'Itau - Conta Corrente')")
    ap.add_argument("--ofx", required=True, type=Path, help="extrato do banco")
    ap.add_argument("--gravar", action="store_true",
                     help="grava direto via DATABASE_URL (padrao: dry-run)")
    ap.add_argument("--exportar-json", type=Path, default=None,
                     help="exporta as linhas prontas pra upsert em JSON, sem precisar de DATABASE_URL")
    args = ap.parse_args()

    return asyncio.run(validar(args))


if __name__ == "__main__":
    raise SystemExit(main())
