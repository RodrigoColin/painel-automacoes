"""
As 7 bases de títulos do fluxo de caixa, buscadas no Omie.

Portado de scripts/exportar_pacote_caixa.py: reusa montar_relatorio() de
omie_mcp/reports/oystr_diagnostico.py sem recalcular nada (os bugs já
corrigidos ali continuam valendo) e devolve as bases em memória, com os
mesmos nomes de coluna das antigas abas "Base -", em vez de gravar arquivos.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from omie_mcp.client import OmieClient
from omie_mcp.config import OmieSettings
from omie_mcp.reports import oystr_diagnostico as relatorio
from omie_mcp.tools import servicos as tools_servicos

STATUS_CONTRATO_MAP = {"10": "Ativo", "99": "Cancelado", "90": "Suspenso"}

# (nome da coluna na base, chave no dict de montar_relatorio()).
COLUNAS = {
    "receber_aberto": ("base_receber_aberto", [
        ("Razão Social", "Razão Social"), ("CNPJ/CPF", "CNPJ/CPF"), ("Emissão", "Emissão"),
        ("Vencimento", "Vencimento"), ("Categoria", "Categoria"), ("Documento", "Documento"),
        ("Conta Corrente", "Conta Corrente"), ("Valor da Conta", "Valor da Conta"),
        ("Recebido", "Recebido"), ("Previsão", "Previsão")]),
    "pagar_aberto": ("base_pagar_aberto", [
        ("Razão Social", "Razão Social"), ("CNPJ/CPF", "CNPJ/CPF"), ("Emissão", "Emissão"),
        ("Vencimento", "Vencimento"), ("Categoria", "Categoria"), ("Documento", "Documento"),
        ("Conta Corrente", "Conta Corrente"), ("Valor da Conta", "Valor da Conta"),
        ("Valor Pago", "Valor Pago"), ("Previsão", "Previsão")]),
    "recebimentos": ("base_recebimentos", [
        ("Cliente", "Cliente/Fornecedor"), ("Emissão", "Emissão"), ("Vencimento", "Vencimento"),
        ("Data de Crédito ou Débito (No Extrato)", "Data de Crédito ou Débito (No Extrato)"),
        ("Categoria", "Categoria"), ("Documento", "Documento"), ("Conta Corrente", "Conta Corrente"),
        ("Valor da Conta", "Valor da Conta"), ("Recebido", "Recebido")]),
    "pagamentos": ("base_pagamentos", [
        ("Fornecedor", "Cliente/Fornecedor"), ("Emissão", "Emissão"), ("Vencimento", "Vencimento"),
        ("Data de Crédito ou Débito (No Extrato)", "Data de Crédito ou Débito (No Extrato)"),
        ("Categoria", "Categoria"), ("Documento", "Documento"), ("Conta Corrente", "Conta Corrente"),
        ("Valor da Conta", "Valor da Conta"), ("Valor Pago", "Valor Pago")]),
    "contratos_nao_faturados": ("base_contratos_nao_faturados", [
        ("Razão Social", "Razão Social"), ("CNPJ/CPF", "CNPJ/CPF"), ("Contrato", "Contrato"),
        ("Categoria", "Categoria"), ("Valor Mensal", "Valor Mensal"), ("Data Prevista", "Data Prevista")]),
    "os_nao_faturadas": ("base_os_nao_faturadas", [
        ("Razão Social", "Razão Social"), ("CNPJ/CPF", "CNPJ/CPF"), ("OS", "OS"),
        ("Categoria", "Categoria"), ("Valor", "Valor"), ("Data Prevista", "Data Prevista")]),
}


def _json_default(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d") if (v.hour, v.minute, v.second) == (0, 0, 0) else v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def _serializavel(obj: Any) -> Any:
    """Mesmo formato que os arquivos do pacote tinham (datas ISO)."""
    return json.loads(json.dumps(obj, ensure_ascii=False, default=_json_default))


async def exportar_bases(
    settings: OmieSettings, desde: str, ate: str, excluir_contas: set[int]
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, Any]]:
    """`desde`/`ate` em dd/mm/aaaa. Devolve (bases, manifesto)."""
    inicio = datetime.now()
    async with OmieClient(settings) as client:
        dados = await relatorio.montar_relatorio(client, desde, ate, excluir_contas=excluir_contas)
        print("  Buscando contratos (todos os status) para 'Status Contratos'...", flush=True)
        lookups = await relatorio.carregar_lookups(client)
        contratos = await tools_servicos.listar_contratos_servico(client)

    bases: dict[str, list[dict[str, Any]]] = {}
    for nome, (chave, cols) in COLUNAS.items():
        bases[nome] = [{col: linha.get(k) for col, k in cols} for linha in dados[chave]]

    status = []
    for c in contratos:
        cab = c.get("cabecalho", {}) or {}
        cod_cli = cab.get("nCodCli")
        if cod_cli is None:
            continue
        cod = str(cab.get("cCodSit")) if cab.get("cCodSit") is not None else ""
        status.append({
            "Cliente": lookups.nome_cliente(cod_cli), "nCodCli": cod_cli, "nCodCtr": cab.get("nCodCtr"),
            "cCodSit (cru)": cab.get("cCodSit"),
            "Status mapeado": STATUS_CONTRATO_MAP.get(cod, f"Desconhecido (cCodSit={cod!r})"),
            "Valor Mensal (R$)": cab.get("nValTotMes", 0),
            "Vigência Início": cab.get("dVigInicial"), "Vigência Fim": cab.get("dVigFinal"),
        })
    status.sort(key=lambda r: r["Cliente"] or "")
    bases["status_contratos"] = status

    bases = _serializavel(bases)
    manifesto = {
        "desde": desde, "ate": ate, "ref": datetime.strptime(ate, "%d/%m/%Y").date().isoformat(),
        "inicio": inicio.isoformat(timespec="seconds"), "fim": datetime.now().isoformat(timespec="seconds"),
        "arquivos": {nome: {"linhas": len(linhas)} for nome, linhas in bases.items()},
        "estatisticas": _serializavel(
            {k: v for k, v in dados.get("estatisticas", {}).items() if not isinstance(v, list)}
        ),
    }
    return bases, manifesto
