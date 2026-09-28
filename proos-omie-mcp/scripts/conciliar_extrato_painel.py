"""Roda o motor COMPLETO de conciliacao (titulo a titulo, automatico/
revisao/excecao) contra um extrato OFX isolado — chamado pela tela
"Conciliacao Bancaria" do Portal Proos depois que o passo simples
(scripts/processar_extrato_simples.py) ja confirmou que o extrato foi lido
e que a empresa tem um cliente Omie vinculado.

SEMPRE leitura — nunca grava nada no Omie. `--gravar` continua exclusivo
de scripts/conciliar.py, rodado manualmente pelo operador; esta tela ainda
nao tem esse botao de proposito (decisao explicita do usuario, ver
scripts/atualizar_titulo_recorrente.py pro mesmo principio).

Precisa de tres coisas que o passo simples nao precisa:
1. `--empresa-id` resolvendo um cliente com credenciais Omie configuradas
   (ver ClientesRegistry.resolver_por_empresa_id em omie_mcp/clients.py).
2. A conta corrente no Omie (nCodCC, o codigo interno) — usado tanto como
   conta_id de cada linha do OFX quanto pra checar duplicidade (item 3).
   `--conta-omie` e OPCIONAL: se nao informado, o script tenta resolver
   sozinho casando o BANKID/ACCTID do bloco BANKACCTFROM do extrato contra
   ListarContasCorrentes (ver omie_mcp.tools.contas_correntes.
   resolver_conta_por_extrato) — o operador nao precisa saber o nCodCC de
   cor (achado real, 2026-09-22: exigir isso na tela travava quem nao
   tinha esse numero decorado). So pede o nCodCC explicito quando a
   resolucao automatica falha (extrato sem ACCTID, ou 2+ contas
   candidatas — nunca adivinha).
3. Um titulos.json ja exportado desse cliente (scripts/
   exportar_base_sombra.py) — sem titulos, nao ha o que casar, e o script
   avisa exatamente isso em vez de silenciosamente rodar so o parse.
   Com `--atualizar-titulos`, busca os titulos ao vivo no Omie antes de
   rodar (mais lento, dados frescos) em vez de usar o snapshot em disco.

Convencao de onde procurar o titulos.json: `sombra/{slug}/titulos.json`;
se nao existir e o slug for "proos", cai pro arquivo legado
`sombra/titulos.json` (o unico titulos.json real hoje, de antes dessa
convencao por-cliente existir).

Duplicidade: linha do extrato que ja tem lancamento correspondente no Omie
(mesma conta+data+valor) e' marcada como TipoExcecao.DUPLICIDADE em vez de
reavaliada como se fosse trabalho novo — mesma checagem do scripts/
conciliar.py (ver omie_mcp/conciliacao/duplicidade.py), best-effort: se a
Omie falhar aqui, segue sem a checagem em vez de travar a tela inteira.

Uso:
    python scripts/conciliar_extrato_painel.py --arquivo extrato.ofx \
        --empresa-id a500bee4-6eab-4878-b5ad-7ff792817662 \
        --conta-omie 1628924843 [--atualizar-titulos]

Saida (stdout, uma linha JSON):
{"cliente_slug": "proos", "cliente_nome": "Proos",
 "titulos_arquivo": "sombra/titulos.json", "titulos_atualizados": false,
 "total": 109, "desfecho_titulo": 59, "desfecho_transferencia": 39, ...,
 "faixa_automatico": 16, "faixa_revisao": 6, "faixa_excecao": 87,
 "excecao_sem_titulo_saida": 48, "excecao_duplicidade": 12, ...}

Erro (JSON, exit code != 0): {"erro": "..."}
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Optional

# Sem isso, print(json.dumps(...)) quebra com UnicodeEncodeError sempre que
# um nome de parceiro/titulo tiver acento — o stdout do Windows cai no
# codepage do console (cp1252) em vez de UTF-8 quando chamado fora de um
# terminal que ja force UTF-8 (achado real, 2026-09-22: rodar este script
# via PowerShell direto, sem passar por bash, reproduz o erro; o caminho
# real da tela do Portal Proos, via Node child_process, nao pode depender
# do ambiente de quem chamou pra acertar isso sozinho).
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.conciliacao import (  # noqa: E402
    Config, Contexto, RegraCliente, Titulo, buscar_linhas_ja_existentes, conciliar, ofx,
    regras_de_json, resumir, verificar_contas_omie_cash,
)
from omie_mcp.tools.contas_correntes import (  # noqa: E402
    ContaBancariaAmbigua, listar_contas_correntes, resolver_conta_por_extrato,
)

import exportar_base_sombra  # noqa: E402


def _localizar_titulos(slug: str) -> Path | None:
    candidato = Path("sombra") / slug / "titulos.json"
    if candidato.exists():
        return candidato
    if slug == "proos":
        legado = Path("sombra") / "titulos.json"
        if legado.exists():
            return legado
    return None


def _localizar_regras(slug: str) -> Path | None:
    """`sombra/{slug}/regras.json` — regras aprendidas com as decisoes do
    operador (ver scripts/decidir_linha_conciliacao.py). Sem fallback
    legado: diferente de titulos.json, esse arquivo e novo e nunca existiu
    solto em `regras.json` na raiz pra nenhum cliente do painel."""
    candidato = Path("sombra") / slug / "regras.json"
    return candidato if candidato.exists() else None


def _carregar_regras(caminho: Path | None) -> list[RegraCliente]:
    if caminho is None:
        return []
    return regras_de_json(json.loads(caminho.read_text(encoding="utf-8")))


def _carregar_titulos(caminho: Path) -> list[Titulo]:
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    return [
        Titulo(
            id=str(t["id"]),
            tipo=t["tipo"],
            vencimento=date.fromisoformat(t["vencimento"]),
            valor=Decimal(str(t["valor"])),
            parceiro_nome=t.get("parceiro_nome", ""),
            parceiro_documento=t.get("parceiro_documento"),
            numero_documento=t.get("numero_documento"),
            categoria=t.get("categoria"),
            tem_documento_anexo=bool(t.get("tem_documento_anexo", False)),
            conciliado=bool(t.get("conciliado", False)),
        )
        for t in dados
    ]


async def _atualizar_titulos_ao_vivo(slug: str, conta_omie: str, linhas) -> Path | None:
    """Chama exportar_base_sombra.exportar() de verdade contra o Omie —
    reaproveita a funcao inteira (nao duplica a logica de paginacao/
    cruzamento com cadastro de clientes) em vez de reimplementar aqui.
    Devolve o caminho do titulos.json fresco, ou None se a exportacao
    falhar (nesse caso o chamador cai pro snapshot em disco, se houver)."""
    datas = [l.data for l in linhas]
    args_exportar = argparse.Namespace(
        cliente=slug,
        conta_omie=[conta_omie],
        desde=min(datas).strftime("%d/%m/%Y"),
        ate=max(datas).strftime("%d/%m/%Y"),
        saida=str(Path("sombra") / slug),
    )
    try:
        codigo = await exportar_base_sombra.exportar(args_exportar)
    except Exception as exc:  # noqa: BLE001 — best-effort, cai pro snapshot em disco
        print(f"AVISO: falha ao atualizar titulos ao vivo ({exc}). Usando snapshot em disco, se houver.")
        return None
    if codigo != 0:
        print("AVISO: exportar_base_sombra terminou com erro. Usando snapshot em disco, se houver.")
        return None
    return Path("sombra") / slug / "titulos.json"


async def _resolver_conta_omie(
    args: argparse.Namespace, cliente_slug: str, texto_ofx: str
) -> tuple[Optional[str], Optional[str]]:
    """Devolve (conta_omie, erro). Se `--conta-omie` foi informado, usa
    direto (override do operador sempre vence). Senao, tenta resolver
    sozinho contra ListarContasCorrentes ao vivo."""
    if args.conta_omie:
        return args.conta_omie, None

    bankid, acctid = ofx.identificar_conta_bancaria(texto_ofx)
    try:
        registry = ClientesRegistry.load()
        settings = registry.settings_for(cliente_slug)
        async with OmieClient(settings) as client:
            contas = await listar_contas_correntes(client)
        conta_omie = resolver_conta_por_extrato(contas, bankid, acctid)
        return conta_omie, None
    except ContaBancariaAmbigua as exc:
        return None, str(exc)
    except Exception as exc:  # noqa: BLE001 — precisa virar erro legivel, nao crash
        return None, (
            f"Nao foi possivel resolver a conta automaticamente ({exc}). "
            "Informe o nCodCC manualmente."
        )


async def _rodar(args: argparse.Namespace) -> int:
    if not args.arquivo.exists():
        print(json.dumps({"erro": f"arquivo nao encontrado: {args.arquivo}"}))
        return 1

    texto_ofx = args.arquivo.read_text(encoding="latin-1", errors="replace")

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
                    "clientes_omie.json antes de rodar a conciliacao completa."
        }))
        return 1

    conta_omie, erro_conta = await _resolver_conta_omie(args, cliente.slug, texto_ofx)
    if erro_conta:
        print(json.dumps({"erro": erro_conta}))
        return 1

    try:
        linhas = ofx.ler_texto(texto_ofx, conta_id=conta_omie)
    except Exception as exc:  # noqa: BLE001 — precisa chegar legivel no front
        print(json.dumps({"erro": f"falha ao ler o OFX: {exc}"}))
        return 1

    if not linhas:
        print(json.dumps({"erro": "nenhuma linha reconhecida no arquivo (formato OFX valido?)"}))
        return 1

    # exigir=False (best-effort): isso aqui nunca grava nada, entao uma
    # falha transitoria da API nao precisa travar uma analise so de
    # leitura — mas se CONFIRMAR que e Omie.CASH, aborta sempre (analisar
    # essa conta produz resultado sem sentido: ela e conciliada sozinha
    # pelo proprio Omie, nao pelo banco de verdade).
    pode_seguir = await verificar_contas_omie_cash(
        cliente.slug, {conta_omie}, exigir=False
    )
    if not pode_seguir:
        print(json.dumps({
            "erro": f"A conta {conta_omie} e Omie.CASH — ja e conciliada "
                    "automaticamente pelo proprio Omie, nunca deve ser analisada "
                    "por esta tela. Confira o nCodCC informado."
        }))
        return 1

    titulos_atualizados = False
    caminho_titulos = None
    if args.atualizar_titulos:
        caminho_titulos = await _atualizar_titulos_ao_vivo(cliente.slug, conta_omie, linhas)
        titulos_atualizados = caminho_titulos is not None

    if caminho_titulos is None:
        caminho_titulos = _localizar_titulos(cliente.slug)

    if caminho_titulos is None:
        print(json.dumps({
            "erro": f"Nenhum titulos.json encontrado para '{cliente.slug}' "
                    f"(esperado em sombra/{cliente.slug}/titulos.json). Rode "
                    "scripts/exportar_base_sombra.py primeiro pra esse cliente, "
                    "ou marque 'atualizar titulos' pra buscar ao vivo."
        }))
        return 1

    try:
        titulos = _carregar_titulos(caminho_titulos)
    except Exception as exc:  # noqa: BLE001 — arquivo corrompido/formato errado
        print(json.dumps({"erro": f"falha ao ler {caminho_titulos}: {exc}"}))
        return 1

    linhas_ja_conciliadas = await buscar_linhas_ja_existentes(
        cliente.slug, conta_omie, linhas
    )

    caminho_regras = _localizar_regras(cliente.slug)
    regras = _carregar_regras(caminho_regras)

    resultados = conciliar(
        Contexto(
            linhas=linhas,
            titulos=titulos,
            regras=regras,
            hoje=date.today(),
            linhas_ja_conciliadas=linhas_ja_conciliadas,
        ),
        Config(),
    )
    resumo = resumir(resultados)

    saida = {
        "cliente_slug": cliente.slug,
        "cliente_nome": cliente.nome,
        "conta_omie": conta_omie,
        "conta_omie_resolvida_automaticamente": not bool(args.conta_omie),
        "titulos_arquivo": str(caminho_titulos),
        "titulos_atualizados": titulos_atualizados,
        "regras_arquivo": str(caminho_regras) if caminho_regras else None,
        "regras_carregadas": len(regras),
        # lista achatada dos titulos em aberto — sem isso a tela nao tem
        # nenhum jeito de o operador buscar manualmente um titulo quando o
        # motor nao achou candidato nenhum (nao existe endpoint de busca).
        "titulos_carregados": [
            {
                "id": t.id, "tipo": t.tipo, "parceiro_nome": t.parceiro_nome,
                "valor": str(t.valor), "vencimento": t.vencimento.isoformat(),
                "numero_documento": t.numero_documento,
            }
            for t in titulos if not t.conciliado
        ],
        # linha a linha — sem isso a tela so mostra a contagem agregada,
        # sem nenhum jeito do operador ver QUAL linha caiu em cada faixa
        # ou QUAL titulo foi casado. Resultado.to_dict() ja e o mesmo
        # formato usado no fila.json da linha de comando.
        "resultados": [r.to_dict() for r in resultados],
        **resumo,
    }
    print(json.dumps(saida, ensure_ascii=False))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arquivo", type=Path, required=True)
    ap.add_argument("--empresa-id", required=True)
    ap.add_argument("--conta-omie", default=None,
                     help="nCodCC real da conta corrente no Omie — opcional, tenta "
                          "resolver sozinho pelo ACCTID do extrato se omitido")
    ap.add_argument("--atualizar-titulos", action="store_true",
                     help="busca titulos ao vivo no Omie em vez do snapshot em disco (mais lento)")
    args = ap.parse_args()
    return asyncio.run(_rodar(args))


if __name__ == "__main__":
    raise SystemExit(main())
