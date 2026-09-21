"""Escrita no ERP — traduz um Resultado do motor em chamadas ao Omie.

Principios inegociaveis desta camada:

1. **Dry-run e o padrao.** Nada grava sem `executar=True` explicito. O modo
   sombra nunca deve gravar por acidente.
2. **Idempotencia.** Toda gravacao passa por uma chave de idempotencia
   (`conta + linha_id`). Se a linha ja foi gravada, nao grava de novo — o
   risco real aqui nao e falhar, e lancar em duplicidade.
3. **So a faixa automatica grava sozinha.** Revisao e excecao esperam a
   decisao do operador virar uma `Decisao` explicita.
4. **Trilha de auditoria.** Toda gravacao registra o que o motor decidiu, com
   que score, sobre quais evidencias, e qual id o Omie devolveu.

O `client` esperado e o `OmieClient` do proos-omie-mcp (metodo assincrono
`call(endpoint, call, param)`), mas qualquer objeto com essa assinatura
serve — por isso da pra testar com um cliente falso, sem rede. `gravar()` e
async por causa disso; chame com `await` (ou `asyncio.run(...)` fora de um
loop ja rodando).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, Optional, Protocol, Sequence

from .modelos import Desfecho, Faixa, Natureza, Resultado


class ClienteOmie(Protocol):
    # O OmieClient real (omie_mcp/client.py) e assincrono — se este protocolo
    # ficar sincrono, gravar() chama client.call(...) sem await e recebe uma
    # corrotina nao executada de volta, quebrando toda gravacao real (nao so
    # transferencia). Bug encontrado nesta validacao, sem teste antigo que
    # cobrisse cliente async — ClienteFalso tambem virou async por causa disso.
    async def call(self, endpoint: str, call: str, param: dict) -> dict: ...


# ---------------------------------------------------------------------------

@dataclass
class Gravacao:
    """Uma operacao de escrita — planejada ou executada."""

    linha_id: str
    operacao: str                 # LancarPagamento, IncluirLancCC, ...
    endpoint: str
    payload: dict
    executada: bool = False
    id_omie: Optional[str] = None
    erro: Optional[str] = None
    # auditoria
    desfecho: Optional[str] = None
    score: int = 0
    evidencias: list[dict] = field(default_factory=list)
    quando: Optional[datetime] = None
    origem: str = "motor"         # motor | operador

    def to_dict(self) -> dict[str, Any]:
        return {
            "linha_id": self.linha_id,
            "operacao": self.operacao,
            "endpoint": self.endpoint,
            "payload": self.payload,
            "executada": self.executada,
            "id_omie": self.id_omie,
            "erro": self.erro,
            "desfecho": self.desfecho,
            "score": self.score,
            "evidencias": self.evidencias,
            "quando": self.quando.isoformat() if self.quando else None,
            "origem": self.origem,
        }


@dataclass
class ConfigEscrita:
    conta_corrente_omie: str           # nCodCC
    codigo_categoria_padrao: str = ""
    codigo_tipo_documento: str = ""    # cCodTipoDoc (dinheiro, ted, pix...)
    conta_investimento_omie: Optional[str] = None
    observacao_prefixo: str = "Conciliado pelo Portal Proos"


# ---------------------------------------------------------------------------

def _br(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def _num(v: Decimal) -> float:
    return float(round(v, 2))


def planejar(
    resultado: Resultado,
    cfg: ConfigEscrita,
    origem: str = "motor",
) -> Optional[Gravacao]:
    """Traduz um Resultado na chamada Omie correspondente. Nao executa nada."""
    linha = resultado.linha
    obs = f"{cfg.observacao_prefixo} — {linha.descricao[:80]}"
    evidencias = [
        {"nome": e.nome, "pontos": e.pontos, "detalhe": e.detalhe}
        for e in (
            resultado.candidato.evidencias
            if resultado.candidato else resultado.evidencias
        )
    ]

    def montar(operacao: str, endpoint: str, payload: dict) -> Gravacao:
        return Gravacao(
            linha_id=linha.id, operacao=operacao, endpoint=endpoint,
            payload=payload, desfecho=resultado.desfecho.value,
            score=resultado.score, evidencias=evidencias, origem=origem,
        )

    # --- baixa de titulo ---
    if resultado.desfecho is Desfecho.TITULO and resultado.candidato:
        titulo = resultado.candidato.titulo
        diferenca = resultado.candidato.diferenca
        juros = _num(diferenca) if diferenca > 0 else 0.0
        desconto = _num(-diferenca) if diferenca < 0 else 0.0

        payload = {
            "codigo_lancamento": int(titulo.id) if titulo.id.isdigit() else titulo.id,
            "codigo_conta_corrente": int(cfg.conta_corrente_omie),
            "valor": _num(linha.valor),
            "data": _br(linha.data),
            "observacao": obs,
        }
        if juros:
            payload["juros"] = juros
        if desconto:
            payload["desconto"] = desconto
        if cfg.codigo_tipo_documento:
            payload["codigo_tipo_documento"] = cfg.codigo_tipo_documento

        if titulo.tipo == "CP":
            return montar("LancarPagamento", "financas/contapagar/", payload)
        return montar("LancarRecebimento", "financas/contareceber/", payload)

    # --- lancamento direto em conta corrente ---
    if resultado.desfecho is Desfecho.LANCAMENTO_DIRETO:
        valor = _num(linha.valor)
        payload = {
            "cabecalho": {
                "nCodCC": int(cfg.conta_corrente_omie),
                "dDtLanc": _br(linha.data),
                "nValorLanc": valor,
                "cTipo": "D" if linha.natureza is Natureza.DEBITO else "C",
                "cObs": obs,
            },
            "detalhes": {
                "cCodCateg": (
                    resultado.categoria_sugerida or cfg.codigo_categoria_padrao
                ),
            },
        }
        return montar(
            "IncluirLancCC", "financas/contacorrentelancamentos/", payload
        )

    # --- transferencia entre contas da empresa ---
    if resultado.desfecho is Desfecho.TRANSFERENCIA:
        # `conta_destino_id` e o id de CONTA da outra ponta — `linha_par_id`
        # e o id da LINHA do extrato e nunca deve ir num campo nCodCC (bug
        # confirmado na validacao adversarial: gravaria transferencia com
        # conta de destino errada).
        destino = resultado.conta_destino_id or cfg.conta_investimento_omie
        if destino is None:
            return None  # sem destino conhecido, nao ha o que gravar

        origem_cc = cfg.conta_corrente_omie
        # a saida sai da conta da linha; a entrada vai para o destino
        de, para = (
            (origem_cc, destino)
            if linha.natureza is Natureza.DEBITO
            else (destino, origem_cc)
        )
        payload = {
            "nCodCCOrigem": de,
            "nCodCCDestino": para,
            "dDtLanc": _br(linha.data),
            "nValorLanc": _num(linha.valor),
            "cObs": obs,
        }
        return montar(
            "TransferirEntreContas", "financas/contacorrentelancamentos/", payload
        )

    return None  # FILA nao grava nada


# ---------------------------------------------------------------------------

@dataclass
class Relatorio:
    planejadas: list[Gravacao] = field(default_factory=list)
    executadas: list[Gravacao] = field(default_factory=list)
    puladas: list[tuple[str, str]] = field(default_factory=list)  # (linha, motivo)
    falhas: list[Gravacao] = field(default_factory=list)

    def resumo(self) -> str:
        return (
            f"planejadas {len(self.planejadas)} | executadas "
            f"{len(self.executadas)} | puladas {len(self.puladas)} | "
            f"falhas {len(self.falhas)}"
        )


async def gravar(
    resultados: Sequence[Resultado],
    cfg: ConfigEscrita,
    client: Optional[ClienteOmie] = None,
    executar: bool = False,
    ja_gravadas: Optional[set[str]] = None,
    apenas_automaticas: bool = True,
    apos_gravar: Optional[Callable[[str], None]] = None,
) -> Relatorio:
    """Planeja (e opcionalmente executa) a gravacao do lote no Omie.

    `executar=False` e o padrao: devolve o plano sem tocar no ERP.
    `ja_gravadas` guarda as chaves de idempotencia ja usadas — o chamador
    persiste isso (tabela `match` no Postgres) entre rodadas; em JSON local,
    ver `apos_gravar`.

    `apos_gravar(chave)`, se informado, e chamado logo apos CADA gravacao bem
    sucedida — antes de seguir pra proxima linha do lote. Sem isso, um
    chamador que persiste `ja_gravadas` so no final do lote perde o registro
    de tudo que ja foi gravado de verdade no Omie se o processo cair no meio
    (janela real de gravacao em duplicidade — achado da validacao adversarial
    de 2026-09-20).
    """
    rel = Relatorio()
    ja_gravadas = ja_gravadas if ja_gravadas is not None else set()

    for r in resultados:
        chave = f"{cfg.conta_corrente_omie}:{r.linha.id}"

        if chave in ja_gravadas:
            rel.puladas.append((r.linha.id, "ja gravada (idempotencia)"))
            continue
        if r.desfecho is Desfecho.FILA:
            rel.puladas.append((r.linha.id, "fila — aguarda decisao do operador"))
            continue
        if apenas_automaticas and r.faixa is not Faixa.AUTOMATICO:
            rel.puladas.append((r.linha.id, f"faixa {r.faixa.value}"))
            continue

        gravacao = planejar(r, cfg)
        if gravacao is None:
            rel.puladas.append((r.linha.id, "sem operacao correspondente"))
            continue

        rel.planejadas.append(gravacao)

        if not executar:
            continue
        if client is None:
            gravacao.erro = "executar=True sem client"
            rel.falhas.append(gravacao)
            continue

        try:
            resposta = await client.call(
                gravacao.endpoint, gravacao.operacao, gravacao.payload
            )
            gravacao.executada = True
            gravacao.quando = datetime.now()
            gravacao.id_omie = str(
                resposta.get("nCodLanc")
                or resposta.get("codigo_lancamento")
                or resposta.get("nCodBaixa")
                or ""
            ) or None
            ja_gravadas.add(chave)
            if apos_gravar is not None:
                apos_gravar(chave)
            rel.executadas.append(gravacao)
        except Exception as e:  # noqa: BLE001 — queremos seguir o lote
            gravacao.erro = f"{type(e).__name__}: {e}"
            rel.falhas.append(gravacao)

    return rel


# ---------------------------------------------------------------------------

class ClienteFalso:
    """Cliente de teste: registra as chamadas em vez de mandar pro Omie."""

    def __init__(self, falhar_em: Sequence[str] = ()) -> None:
        self.chamadas: list[tuple[str, str, dict]] = []
        self.falhar_em = set(falhar_em)
        self._seq = 1000

    async def call(self, endpoint: str, call: str, param: dict) -> dict:
        self.chamadas.append((endpoint, call, param))
        if call in self.falhar_em:
            raise RuntimeError(f"Omie recusou {call} (simulado)")
        self._seq += 1
        return {"nCodLanc": self._seq}
