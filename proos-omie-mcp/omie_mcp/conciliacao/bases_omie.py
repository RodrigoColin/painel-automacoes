"""Coleta ao vivo, do Omie, os titulos em aberto (CP + CR) do periodo, no
formato que o motor consome (`list[Titulo]`), a partir de um OmieClient JA
construido.

Mesma logica do `scripts/exportar_base_sombra.py` (margem de 20 dias no
vencimento, valor BRUTO, nome/CNPJ do parceiro cruzados do cadastro, titulo
ja PAGO/RECEBIDO marcado `conciliado`), mas SEM depender do registry por slug
nem escrever arquivos — pensado pro worker server-side, que resolve as
credenciais pelo Infisical (empresa_id) e roda na VPS, onde nao existem os
snapshots `sombra/{slug}/titulos.json`.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Optional

from ..client import OmieClient
from ..tools import clientes as tools_clientes
from ..tools import contas_pagar, contas_receber
from .modelos import Titulo

_STATUS_CANCELADO = {"CANCELADO"}
_STATUS_FECHADO = {"PAGO", "RECEBIDO"}
_MARGEM_VENCIMENTO_DIAS = 20


def _campo(dado: dict, *caminhos: str, padrao: Any = None) -> Any:
    for caminho in caminhos:
        atual: Any = dado
        ok = True
        for parte in caminho.split("."):
            if isinstance(atual, dict) and parte in atual:
                atual = atual[parte]
            else:
                ok = False
                break
        if ok and atual not in (None, ""):
            return atual
    return padrao


def _data_iso(bruto: Optional[str]):
    if not bruto:
        return None
    bruto = str(bruto).strip()
    for formato in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(bruto, formato).date()
        except ValueError:
            continue
    return None


def _br(d) -> str:
    return d.strftime("%d/%m/%Y")


async def coletar_titulos_abertos(
    client: OmieClient, desde, ate
) -> list[Titulo]:
    """Titulos (CP + CR) com vencimento na janela [desde-20d, ate+20d].

    `desde`/`ate` sao `datetime.date`. Titulo ja PAGO/RECEBIDO vem com
    `conciliado=True` (o motor o exclui da busca de candidato, mas ele ainda
    serve de auditoria); CANCELADO e descartado.
    """
    desde_margem = desde - timedelta(days=_MARGEM_VENCIMENTO_DIAS)
    ate_margem = ate + timedelta(days=_MARGEM_VENCIMENTO_DIAS)
    filtros = {
        "filtrar_por_data_de": _br(desde_margem),
        "filtrar_por_data_ate": _br(ate_margem),
    }

    brutos_cp = await contas_pagar.listar_contas_pagar(client, filtros=filtros)
    brutos_cr = await contas_receber.listar_contas_receber(client, filtros=filtros)

    cadastro = await tools_clientes.listar_clientes(client)
    nome_por_codigo: dict[int, str] = {}
    doc_por_codigo: dict[int, str] = {}
    for c in cadastro:
        cod = c.get("codigo_cliente_omie")
        if cod is None:
            continue
        nome_por_codigo[cod] = c.get("razao_social") or c.get("nome_fantasia") or ""
        doc_por_codigo[cod] = c.get("cnpj_cpf") or ""

    titulos: list[Titulo] = []
    for tipo, brutos in (("CP", brutos_cp), ("CR", brutos_cr)):
        for t in brutos:
            status = str(_campo(t, "status_titulo", padrao="")).upper()
            if status in _STATUS_CANCELADO:
                continue
            vcto = _data_iso(_campo(t, "data_vencimento", "dDtVenc", "data_previsao"))
            if vcto is None or not (desde_margem <= vcto <= ate_margem):
                continue
            cod_parceiro = _campo(t, "codigo_cliente_fornecedor")
            valor = _campo(t, "valor_documento", "nValorTitulo", padrao=0)
            titulos.append(Titulo(
                id=str(_campo(t, "codigo_lancamento_omie", "nCodTitulo")),
                tipo=tipo,
                vencimento=vcto,
                valor=Decimal(str(valor if valor not in (None, "") else "0")),
                parceiro_nome=nome_por_codigo.get(cod_parceiro, ""),
                parceiro_documento=doc_por_codigo.get(cod_parceiro) or None,
                numero_documento=_campo(t, "numero_documento_fiscal", "numero_documento"),
                categoria=_campo(t, "codigo_categoria", "cCodCateg"),
                tem_documento_anexo=bool(_campo(t, "possui_anexo", padrao=False)),
                conciliado=status in _STATUS_FECHADO,
            ))
    return titulos
