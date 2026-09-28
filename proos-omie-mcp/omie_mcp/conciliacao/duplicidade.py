"""Checagem de duplicidade contra o Omie ao vivo — cruza linhas do extrato
com o que cada conta corrente JA TEM la (ListarLancCC) antes de propor como
trabalho novo.

Promovido de scripts/conciliar.py pra ca (2026-09-22) porque uma segunda
chamada (scripts/conciliar_extrato_painel.py, usado pela tela de
Conciliacao Bancaria do Portal Proos) passou a precisar da MESMA logica —
duplicar 80 linhas de integracao com o Omie entre dois scripts arriscava
os dois divergirem com o tempo; aqui so existe uma vez.
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, Sequence, Union

from .modelos import LinhaExtrato


async def buscar_linhas_ja_existentes(
    cliente_slug: str,
    contas_omie: Union[str, Iterable[str]],
    linhas: Sequence[LinhaExtrato],
) -> frozenset[str]:
    """Cruza as linhas do extrato contra o que cada conta corrente JA TEM no
    Omie (ListarLancCC), por conta+data+valor — pra pegar lancamento que ja
    existe la (auto-importado do banco, ou lancado a mao por alguem) ANTES
    de propor como se fosse trabalho novo.

    `contas_omie` aceita uma conta so ou uma lista (lote multi-conta) — a
    checagem e por conta+data+valor, nao so data+valor: duas contas
    diferentes no mesmo lote podem legitimamente ter uma transferencia com
    o mesmo valor no mesmo dia, e isso NAO e duplicidade.

    Achado real: um lancamento direto de tarifa foi gravado via API sem essa
    checagem e duplicou um que o proprio Omie ja tinha importado do extrato
    (2026-09-21, Proos). O motor ja tem `TipoExcecao.DUPLICIDADE` pronto pra
    isso (`linhas_ja_conciliadas`) — so faltava alimentar de verdade.

    Best-effort: se nao conseguir credenciais ou a Omie falhar, volta vazio
    (sem checagem) em vez de derrubar o dry-run — o `--gravar` continua
    protegido pela idempotencia de `gravadas.json`, essa checagem e uma
    camada a mais contra o que foi feito FORA do nosso proprio tool.
    """
    if not linhas:
        return frozenset()
    from ..client import OmieClient
    from ..clients import ClientesConfigError, ClientesRegistry
    from ..tools import lancamentos_cc

    contas_alvo = (
        {str(c) for c in contas_omie}
        if isinstance(contas_omie, (list, tuple, set, frozenset))
        else {str(contas_omie)}
    )

    try:
        registry = ClientesRegistry.load()
        settings = registry.settings_for(cliente_slug)
    except ClientesConfigError as exc:
        print(f"\nAVISO: nao deu pra checar lancamentos existentes na Omie ({exc}). "
              "Seguindo sem essa checagem.")
        return frozenset()

    datas = [l.data for l in linhas]
    desde = min(datas).strftime("%d/%m/%Y")
    ate = max(datas).strftime("%d/%m/%Y")

    try:
        async with OmieClient(settings) as client:
            existentes = await lancamentos_cc.listar_lancamentos_cc(
                client, data_pagamento_de=desde, data_pagamento_ate=ate,
            )
    except Exception as exc:  # noqa: BLE001 — best-effort, nunca derruba o dry-run
        print(f"\nAVISO: nao deu pra buscar lancamentos existentes na Omie ({exc}). "
              "Seguindo sem essa checagem.")
        return frozenset()

    chaves_existentes: set[str] = set()
    for lanc in existentes:
        conta_lanc = str(lancamentos_cc.conta_corrente_id(lanc))
        if conta_lanc not in contas_alvo:
            continue
        data_lanc = lancamentos_cc.data_lancamento(lanc)
        valor_lanc = lancamentos_cc.valor_lancamento(lanc)
        if not data_lanc:
            continue
        try:
            data_iso = datetime.strptime(data_lanc, "%d/%m/%Y").date().isoformat()
        except ValueError:
            continue
        chaves_existentes.add(f"{conta_lanc}|{data_iso}|{float(valor_lanc):.2f}")

    ja_existem = frozenset(
        l.id for l in linhas
        if f"{l.conta_id}|{l.data.isoformat()}|{float(l.valor):.2f}" in chaves_existentes
    )
    if ja_existem:
        print(f"\n{len(ja_existem)} linha(s) do extrato ja tem lancamento "
              f"correspondente no Omie (conta+data+valor) — marcadas como duplicidade.")
    return ja_existem
