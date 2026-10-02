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
        ("Categoria", "Categoria"), ("Valor Mensal", "Valor Mensal"), ("Data Prevista", "Data Prevista"),
        ("Complementar", "Complementar")]),
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


def _complementar_vigencia_vencida(
    dados: dict[str, Any], contratos: list[dict[str, Any]], lookups: Any, ate: str
) -> None:
    """Contrato "Ativo" (cCodSit='10') com vigência (dVigFinal) vencida há pouco tempo ainda
    entra na projeção de receita (contratos não faturados) -- a previsão nativa da Omie
    ("Previsão de Contratos Mensais", que montar_contratos_nao_faturados_via_extrato usa sem
    filtro próprio) para de projetar um contrato assim que a data atual passa do mês do
    dVigFinal, mesmo que o contrato continue sendo cobrado na prática (renovação que ainda não
    foi formalizada no cadastro do Omie). Só complementa vencido desde o dia 1º do mês ANTERIOR
    ao vigente -- achado real na Oystr, 01/10/2026 (scripts/exportar_pacote_caixa.py, commits
    a29ed82/4addc4f), portado aqui pro pipeline nativo multi-cliente a pedido do Rodrigo."""
    hoje_ref = datetime.strptime(ate, "%d/%m/%Y")
    ano_corte, mes_corte = (hoje_ref.year - 1, 12) if hoje_ref.month == 1 else (hoje_ref.year, hoje_ref.month - 1)
    corte = datetime(ano_corte, mes_corte, 1)
    ja_cobertos = {l["Contrato"] for l in dados["base_contratos_nao_faturados"]}
    meses_complemento: list[tuple[int, int]] = []
    ano, mes = hoje_ref.year, hoje_ref.month
    for _ in range(3):  # mês corrente + 2 seguintes, mesma janela do relatório nativo
        meses_complemento.append((ano, mes))
        ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)

    complementados = 0
    for c in contratos:
        cab = c.get("cabecalho", {}) or {}
        if cab.get("cCodSit") != "10" or cab.get("cTipoFat") != "01":
            continue  # só Ativo e faturamento mensal (mesma regra do relatório nativo)
        cod_ctr = cab.get("nCodCtr")
        if cod_ctr is None or cod_ctr in ja_cobertos:
            continue  # a Omie já está projetando este contrato -- não duplica
        try:
            fim_data = datetime.strptime(cab.get("dVigFinal") or "", "%d/%m/%Y")
        except ValueError:
            continue  # sem dVigFinal válido não é o caso que estamos resolvendo
        if fim_data >= hoje_ref or fim_data < corte:
            continue  # ainda vigente (já coberto) ou vencido antes do mês anterior ao vigente

        venc_textos = c.get("vencTextos", {}) or {}
        try:
            dia_fixo = int(venc_textos.get("nDiaFixo") or 0)
        except (TypeError, ValueError):
            dia_fixo = 0
        if dia_fixo <= 0:
            # vencTextos.nDiaFixo=0 às vezes significa "vence N dias após o dia de
            # faturamento do contrato" em vez de "dia fixo do mês" (mesmo fallback do
            # relatório nativo, ver _dia_projetado_no_mes).
            try:
                dia_fat = int(cab.get("nDiaFat") or 0)
            except (TypeError, ValueError):
                dia_fat = 0
            try:
                n_dias_prazo = int(venc_textos.get("nDias") or 0)
            except (TypeError, ValueError):
                n_dias_prazo = 0
            dia_fixo = dia_fat + n_dias_prazo if dia_fat > 0 else 0
        if dia_fixo <= 0:
            continue

        valor = round(float(cab.get("nValTotMes") or 0), 2)
        if valor <= 0:
            continue
        cod_cli = cab.get("nCodCli")
        categoria = lookups.categoria((c.get("infAdic") or {}).get("cCodCateg"))

        for ano_m, mes_m in meses_complemento:
            dia = relatorio._dia_projetado_no_mes(
                dia_fixo, venc_textos.get("cAntecipar"), venc_textos.get("cPostergar"), ano_m, mes_m
            )
            if dia is None:
                continue
            data_prevista = date(ano_m, mes_m, dia)
            if data_prevista < hoje_ref.date():
                continue  # não projeta pro passado
            dados["base_contratos_nao_faturados"].append({
                "Razão Social": lookups.nome_cliente(cod_cli),
                "CNPJ/CPF": lookups.cnpj_cliente(cod_cli),
                "Contrato": cod_ctr,
                "Categoria": categoria,
                "Valor Mensal": valor,
                "Data Prevista": data_prevista,
                # marca pra extra.py: essas linhas não existem no extrato nativo da Omie
                # (D["dias"]), só aqui -- extra.py precisa somar isso à parte no "ent"/"acum"
                # do mês corrente, que é ancorado no extrato (ver hist, mes==MES_CUR).
                "Complementar": True,
            })
            complementados += 1

    if complementados:
        print(f"  +{complementados} linha(s) complementares de contratos Ativos com vigência "
              f"vencida desde {corte.strftime('%d/%m/%Y')} (previsão nativa da Omie não projeta mais).",
              flush=True)


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

    _complementar_vigencia_vencida(dados, contratos, lookups, ate)

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
