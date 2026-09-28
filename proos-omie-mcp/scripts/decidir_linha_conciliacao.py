"""Registra a decisao do operador sobre UMA linha da fila de conciliacao —
chamado pela tela "Conciliacao Bancaria" do Portal Proos a cada decisao
(um clique = uma chamada), nunca em lote.

Fecha o loop de aprendizado: decisao -> omie_mcp.conciliacao.aprendizado.
registrar_decisao() -> sombra/{slug}/regras.json atualizado -> a proxima
rodada de scripts/conciliar_extrato_painel.py ja carrega essa regra (ver
_localizar_regras/_carregar_regras la) e, com confirmacoes suficientes
(Config.confirmacoes_para_regra_automatica, hoje 3), decide sozinha.

NUNCA escreve no Omie — so resolve o cliente/slug via ClientesRegistry.
Escrita real no ERP continua exclusiva de scripts/conciliar.py --gravar,
rodado manualmente (politica de quarentena, ver CLAUDE-CODE-HANDOFF.md).

Entrada: payload JSON no STDIN (nao em argv — evita escaping de acento/
virgula da descricao bancaria no shell do Windows, mesmo motivo do
sys.stdout.reconfigure(encoding="utf-8") nos scripts irmaos):

    {
      "linha": {"linha_id": "...", "conta_id": "1628924843",
                "data": "2026-09-01", "valor": "-150.00",
                "descricao": "PIX ENVIADO ..."},
      "sugestao_motor": {"desfecho": "fila", "faixa": "excecao",
                         "tipo_excecao": "sem_titulo_saida"} | null,
      "decisao": {
        "desfecho": "titulo" | "lanc_direto" | "transferencia",
        "titulo_id": "T123" | null,
        "categoria": "..." | null,
        "parceiro_id": "..." | null,
        "conta_destino_id": "..." | null,
        "observacao": "..." | null
      }
    }

`decisao.desfecho` nunca e "fila" aqui — "adiar" e simplesmente NAO chamar
este script (a fila continua como esta, sem registro nenhum).

Uso:
    python scripts/decidir_linha_conciliacao.py --empresa-id <uuid> \\
        --quem operador@proos.com.br < payload.json

Saida (stdout, uma linha JSON): {"aprendeu": true|false,
"regra": {"padrao": "...", "desfecho": "...", "confirmacoes": N} | null}

Erro (stdout, ainda JSON, exit code != 0): {"erro": "..."}
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

# Mesmo achado real dos scripts irmaos (2026-09-22): sem isso, acento na
# descricao bancaria quebra com UnicodeEncodeError fora de um terminal que
# ja force UTF-8 (o caminho real e via Node child_process).
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.conciliacao import (  # noqa: E402
    Decisao, Desfecho, LinhaExtrato, Natureza, RegraCliente, registrar_decisao,
    regras_de_json, regras_para_json,
)


def _caminho_regras(slug: str) -> Path:
    return Path("sombra") / slug / "regras.json"


def _caminho_decisoes(slug: str) -> Path:
    return Path("sombra") / slug / "decisoes.json"


def _carregar_regras(caminho: Path) -> list[RegraCliente]:
    if not caminho.exists():
        return []
    return regras_de_json(json.loads(caminho.read_text(encoding="utf-8")))


def _salvar_regras(caminho: Path, regras: list[RegraCliente]) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(
        json.dumps(regras_para_json(regras), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _registrar_auditoria(caminho: Path, entrada: dict) -> None:
    """Log append-only de toda decisao (mesmo as que nao mexem em regra
    nenhuma, ex. desfecho=titulo) — e o material bruto pra uma futura
    ferramenta de calibracao (aprendizado.calibrar) reconstruir o historico,
    e o unico rastro auditavel dessa tela hoje (nao ha tabela no Supabase)."""
    caminho.parent.mkdir(parents=True, exist_ok=True)
    historico = (
        json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else []
    )
    historico.append(entrada)
    caminho.write_text(
        json.dumps(historico, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _linha_de_payload(dados: dict) -> LinhaExtrato:
    """Reconstroi so o suficiente de LinhaExtrato pro que registrar_decisao
    realmente usa (extrair_padrao le so `.descricao`) — nao precisa ser uma
    reconstrucao fiel da linha original do OFX."""
    valor = Decimal(str(dados["valor"]))
    return LinhaExtrato(
        id=dados["linha_id"],
        conta_id=dados.get("conta_id", ""),
        data=date.fromisoformat(dados["data"]),
        valor=abs(valor),
        natureza=Natureza.CREDITO if valor >= 0 else Natureza.DEBITO,
        descricao=dados["descricao"],
    )


def _rodar(args: argparse.Namespace, corpo: dict) -> int:
    try:
        registry = ClientesRegistry.load()
        cliente = registry.resolver_por_empresa_id(args.empresa_id)
    except ClientesConfigError as exc:
        print(json.dumps({"erro": str(exc)}))
        return 1

    if cliente is None:
        print(json.dumps({
            "erro": "Esta empresa ainda nao esta vinculada a um cliente do "
                    "proos-omie-mcp — configure o empresa_id dela em "
                    "clientes_omie.json antes de registrar decisoes."
        }))
        return 1

    dados_decisao = corpo["decisao"]
    try:
        desfecho = Desfecho(dados_decisao["desfecho"])
    except ValueError:
        print(json.dumps({"erro": f"desfecho invalido: {dados_decisao['desfecho']!r}"}))
        return 1
    if desfecho is Desfecho.FILA:
        print(json.dumps({"erro": "desfecho 'fila' nao e uma decisao — adiar e so nao chamar este script"}))
        return 1

    try:
        linha = _linha_de_payload(corpo["linha"])
    except Exception as exc:  # noqa: BLE001 — precisa chegar legivel no front
        print(json.dumps({"erro": f"payload de linha invalido: {exc}"}))
        return 1

    decisao = Decisao(
        linha=linha,
        desfecho=desfecho,
        titulo_id=dados_decisao.get("titulo_id"),
        categoria=dados_decisao.get("categoria"),
        parceiro_id=dados_decisao.get("parceiro_id"),
        conta_destino_id=dados_decisao.get("conta_destino_id"),
        quem=args.quem or "",
        quando=date.today(),
    )

    caminho_regras = _caminho_regras(cliente.slug)
    regras = _carregar_regras(caminho_regras)
    regra_afetada = registrar_decisao(decisao, regras)
    if regra_afetada is not None:
        _salvar_regras(caminho_regras, regras)

    _registrar_auditoria(_caminho_decisoes(cliente.slug), {
        "linha": corpo["linha"],
        "sugestao_motor": corpo.get("sugestao_motor"),
        "decisao": dados_decisao,
        "observacao": dados_decisao.get("observacao"),
        "quem": args.quem or "",
        "quando": datetime.now().isoformat(timespec="seconds"),
        "regra_afetada": regras_para_json([regra_afetada])[0] if regra_afetada else None,
    })

    print(json.dumps({
        "aprendeu": regra_afetada is not None,
        "regra": (
            {
                "padrao": regra_afetada.padrao,
                "desfecho": regra_afetada.desfecho.value,
                "confirmacoes": regra_afetada.confirmacoes,
            }
            if regra_afetada is not None else None
        ),
    }, ensure_ascii=False))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--empresa-id", required=True)
    ap.add_argument("--quem", default="", help="e-mail de quem decidiu (auditoria)")
    args = ap.parse_args()

    try:
        corpo = json.loads(sys.stdin.read())
    except json.JSONDecodeError as exc:
        print(json.dumps({"erro": f"payload JSON invalido no stdin: {exc}"}))
        return 1

    return _rodar(args, corpo)


if __name__ == "__main__":
    raise SystemExit(main())
