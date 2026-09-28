"""
Gera o PACOTE DE DADOS do painel "Fluxo de caixa · Oystr" — substitui o
Oystr_Diagnostico_Consolidado_*.xlsx como passagem de dados (decisão de
2026-09-25: ninguém abre o Excel; ele só alimentava o painel).

O que muda em relação ao refresh_oystr_diagnostico.py --modo escrever:
  - Busca no Omie EXATAMENTE os mesmos dados (reusa montar_relatorio(), sem
    recalcular nada — os 7 bugs já corrigidos ali continuam valendo).
  - Em vez de preencher 23 abas (fórmulas, Aging, Fluxo Diário, gráficos...),
    grava só as 7 bases que o painel usa, em JSON, com os MESMOS nomes de
    coluna das abas "Base -" (o build_extra lê as duas fontes igual).
  - "Base - Status Contratos" (antes só saía do analise_faturamento_mrr.py,
    que deixou de ser necessário — o MRR agora está no painel.proos.com.br)
    é gerada aqui direto do ListarContratos, mesma regra de status.
  - Não precisa de arquivo de entrada (--arquivo) nem de modelo Excel.

Saída: <saida>/<cliente>/<AAAA-MM-DD>/
    recebimentos.json, pagamentos.json, receber_aberto.json, pagar_aberto.json,
    contratos_nao_faturados.json, os_nao_faturadas.json, status_contratos.json,
    manifesto.json (período, contagens, totais, horário da rodada)

Uso (PowerShell, na pasta proos-omie-mcp):
    python scripts\\exportar_pacote_caixa.py --cliente oystr --desde 01/01/2025

    --ate      padrão = hoje (sempre usar hoje; ver aviso no refresh_oystr_diagnostico.py)
    --saida    padrão = pasta "dados" dentro do proos-omie-mcp
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.reports import oystr_diagnostico as relatorio  # noqa: E402
from omie_mcp.tools import servicos as tools_servicos  # noqa: E402

# Mesma regra de status do analise_faturamento_mrr.py (STATUS_CONTRATO_MAP).
STATUS_CONTRATO_MAP = {"10": "Ativo", "99": "Cancelado", "90": "Suspenso"}

# Mesmos cabeçalhos/chaves usados em refresh_oystr_diagnostico.escrever_planilha():
# (nome da coluna na aba "Base -", chave no dict de montar_relatorio()).
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


def _json_default(v):
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d") if (v.hour, v.minute, v.second) == (0, 0, 0) else v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return str(v)


def _gravar(pasta: Path, nome: str, obj) -> None:
    caminho = pasta / f"{nome}.json"
    tmp = caminho.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, default=_json_default), encoding="utf-8")
    tmp.replace(caminho)  # grava inteiro ou nada (nunca deixa arquivo pela metade)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cliente", default=None)
    parser.add_argument("--desde", required=True, help="dd/mm/aaaa (ex.: 01/01/2025)")
    parser.add_argument("--ate", default=None, help="dd/mm/aaaa (padrão: hoje)")
    parser.add_argument("--saida", default=None, help="pasta raiz do pacote (padrão: <proos-omie-mcp>/dados)")
    args = parser.parse_args()

    ate = args.ate or datetime.now().strftime("%d/%m/%Y")
    try:
        registry = ClientesRegistry.load()
        slug = registry.resolver_slug(args.cliente)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"[config] {exc}")
        return 1

    raiz = Path(args.saida) if args.saida else Path(__file__).resolve().parent.parent / "dados"
    ate_iso = datetime.strptime(ate, "%d/%m/%Y").strftime("%Y-%m-%d")
    pasta = raiz / slug / ate_iso
    pasta.mkdir(parents=True, exist_ok=True)

    inicio = datetime.now()
    print(f"Cliente: {slug} | período: {args.desde} a {ate} | saída: {pasta}")
    print("Buscando dados no Omie (pode levar alguns minutos)...")
    async with OmieClient(settings) as client:
        dados = await relatorio.montar_relatorio(client, args.desde, ate)
        print("  Buscando contratos (todos os status) para 'Status Contratos'...", flush=True)
        lookups = await relatorio.carregar_lookups(client)
        contratos = await tools_servicos.listar_contratos_servico(client)

    manifesto = {"cliente": slug, "desde": args.desde, "ate": ate, "ref": ate_iso,
                 "inicio": inicio.isoformat(timespec="seconds"), "arquivos": {}}

    for nome, (chave, cols) in COLUNAS.items():
        linhas = [{col: l.get(k) for col, k in cols} for l in dados[chave]]
        _gravar(pasta, nome, linhas)
        manifesto["arquivos"][nome] = {"linhas": len(linhas)}
        print(f"  {nome}.json: {len(linhas)} linha(s)")

    # Status Contratos: mesma estrutura da aba antiga (1 linha por contrato).
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
    status.sort(key=lambda r: r["Cliente"])
    _gravar(pasta, "status_contratos", status)
    manifesto["arquivos"]["status_contratos"] = {"linhas": len(status)}
    print(f"  status_contratos.json: {len(status)} linha(s)")

    manifesto["fim"] = datetime.now().isoformat(timespec="seconds")
    manifesto["estatisticas"] = {k: v for k, v in dados.get("estatisticas", {}).items() if not isinstance(v, list)}
    _gravar(pasta, "manifesto", manifesto)
    print(f"\nPacote gravado em: {pasta}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
