"""
Execução do faturamento de excedente DENTRO do contrato (clientes com dia de
faturamento 2) — fase 2, só depois da aprovação do analista.

Reconciliação por contrato (regra Rodrigo 2026-11-13, validada contra a base
de novembro e com teste reversível no contrato 2026/00002):
  - serviço de excedente da base que JÁ é item do contrato → atualiza o valor;
  - serviço de excedente da base que NÃO está no contrato → inclui;
  - item de excedente que está no contrato mas NÃO está na base → exclui.

API (confirmada via MCP oficial): servicos/contrato AlterarContrato (inclui/
atualiza itens — codItem existente atualiza, codIntItem novo inclui; impostos
vêm do cadastro do serviço quando codServico é informado) e ExcluirItem.
Gotchas: ConsultarContrato embrulha sob 'contratoCadastro'; item exige 'seq';
referenciar por codItem/codIntItem; "mesmo id em 60s" no ConsultarContrato.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from ..client import OmieClient

_MODULO = "servicos/contrato"

# Impostos mínimos obrigatórios; com codServico informado o Omie assume os do
# cadastro do serviço (confirmado no teste: saiu aliqISS do cadastro, não 0).
_IMPOSTOS_MIN = {
    "aliqISS": 0, "retISS": "N", "aliqIR": 0, "aliqPIS": 0,
    "aliqCSLL": 0, "aliqINSS": 0, "valorCOFINS": 0,
}


@dataclass
class ItemExcedenteBase:
    """Um excedente a faturar no contrato, vindo da base do mês."""
    linha_id: int
    n_cod_serv: int
    valor: Decimal
    categoria: str | None
    cod_int_item: str                 # EXC-AAAAMM-<nCodServ> (idempotência)


@dataclass
class ResultadoContrato:
    n_cod_ctr: int
    numero: str
    incluidos: list[int] = field(default_factory=list)       # linha_id
    atualizados: list[int] = field(default_factory=list)
    excluidos: int = 0
    erro: str | None = None

    @property
    def ok(self) -> bool:
        return self.erro is None


def _int(v: Any) -> int | None:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _item_payload(seq: int, n_cod_serv: int, valor: Decimal,
                  categoria: str | None, cod_item: int | None = None,
                  cod_int_item: str | None = None) -> dict:
    icab: dict = {
        "seq": seq,
        "codServico": n_cod_serv,
        "quant": 1,
        "valorUnit": float(valor),
        "cNaoGerarFinanceiro": "N",
    }
    if categoria:
        icab["cCodCategItem"] = categoria
    if cod_item:
        icab["codItem"] = cod_item          # atualiza item existente
    elif cod_int_item:
        icab["codIntItem"] = cod_int_item   # inclui item novo
    return {"itemCabecalho": icab, "itemImpostos": dict(_IMPOSTOS_MIN)}


async def _itens_excedente_atuais(
    client: OmieClient, n_cod_ctr: int, servs_excedente: set[int],
) -> tuple[dict[int, tuple[int, int]], int]:
    """Itens de excedente HOJE no contrato → {n_cod_serv: (cod_item, seq)}, e
    a maior seq (para numerar inclusões). Uma consulta por contrato (distinta,
    respeita a regra 'mesmo id em 60s')."""
    resposta = await client.call(
        _MODULO, "ConsultarContrato", {"contratoChave": {"nCodCtr": n_cod_ctr}})
    cad = resposta.get("contratoCadastro") or resposta
    atuais: dict[int, tuple[int, int]] = {}
    max_seq = 0
    for item in cad.get("itensContrato") or []:
        ic = item.get("itemCabecalho") or {}
        seq = _int(ic.get("seq")) or 0
        max_seq = max(max_seq, seq)
        sid = _int(ic.get("codServico"))
        if sid in servs_excedente and ic.get("codItem"):
            atuais[sid] = (_int(ic.get("codItem")), seq)
    return atuais, max_seq


async def reconciliar(
    client: OmieClient, n_cod_ctr: int, numero: str,
    base_itens: list[ItemExcedenteBase], servs_excedente: set[int],
    log=print,
) -> ResultadoContrato:
    """Aplica a reconciliação de excedentes de UM contrato. Sequencial e
    idempotente: atualizar com o mesmo valor é no-op; incluir usa codIntItem
    fixo (reenviar não duplica)."""
    r = ResultadoContrato(n_cod_ctr=n_cod_ctr, numero=numero)
    try:
        atuais, max_seq = await _itens_excedente_atuais(
            client, n_cod_ctr, servs_excedente)

        alterar: list[dict] = []
        base_servs: set[int] = set()
        for b in base_itens:
            base_servs.add(b.n_cod_serv)
            if b.n_cod_serv in atuais:
                cod_item, seq = atuais[b.n_cod_serv]
                alterar.append(_item_payload(
                    seq, b.n_cod_serv, b.valor, b.categoria, cod_item=cod_item))
                r.atualizados.append(b.linha_id)
            else:
                max_seq += 1
                alterar.append(_item_payload(
                    max_seq, b.n_cod_serv, b.valor, b.categoria,
                    cod_int_item=b.cod_int_item))
                r.incluidos.append(b.linha_id)

        excluir = [cod_item for sid, (cod_item, _seq) in atuais.items()
                   if sid not in base_servs]

        if alterar:
            await client.call(_MODULO, "AlterarContrato", {
                "cabecalho": {"nCodCtr": n_cod_ctr},
                "itensContrato": alterar,
            })
        if excluir:
            await client.call(_MODULO, "ExcluirItem", {
                "contratoChave": {"nCodCtr": n_cod_ctr},
                "ItensExclusao": [{"codItem": ci} for ci in excluir],
            })
            r.excluidos = len(excluir)

        log(f"   contrato {numero}: +{len(r.incluidos)} incluído(s), "
            f"~{len(r.atualizados)} atualizado(s), -{r.excluidos} excluído(s)")
    except Exception as erro:  # um contrato que falha não derruba os outros
        r.erro = str(erro)[:2000]
        log(f"   contrato {numero}: FALHA {r.erro}")
    return r
