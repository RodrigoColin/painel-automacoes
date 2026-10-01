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

    # Contratos "Ativo" com vigência vencida há pouco tempo (pedido explícito
    # do Rodrigo, 01/10/2026): a previsão nativa do Omie ("Previsão de
    # Contratos Mensais", usada em montar_contratos_nao_faturados_via_extrato)
    # para de projetar um contrato assim que hoje passa do mês do dVigFinal —
    # mesmo que o contrato continue "Ativo" (cCodSit='10') e sendo cobrado na
    # prática (renovação ainda não formalizada no Omie). Achado real em
    # 01/10/2026: 29 de 456 contratos ativos estavam nessa situação, R$90
    # mil/mês de receita recorrente "sumindo" da projeção de outubro.
    # Diferente do pedido de 2026-08-10 (_contrato_vigente_em, hoje código
    # morto — excluía vigência vencida pra não projetar contrato morto pra
    # sempre): agora o pedido é o oposto, mas com limite — só complementa
    # se venceu há no máximo JANELA_VIGENCIA_VENCIDA_DIAS dias (vencido há
    # mais tempo, mais provável que o contrato realmente tenha acabado).
    JANELA_VIGENCIA_VENCIDA_DIAS = 20
    hoje_ref = datetime.strptime(ate, "%d/%m/%Y")
    ja_cobertos = {l["Contrato"] for l in dados["base_contratos_nao_faturados"]}
    meses_complemento: list[tuple[int, int]] = []
    _ano, _mes = hoje_ref.year, hoje_ref.month
    for _ in range(3):  # mês corrente + 2 seguintes, mesma janela do relatório nativo
        meses_complemento.append((_ano, _mes))
        _ano, _mes = (_ano + 1, 1) if _mes == 12 else (_ano, _mes + 1)

    complementados = 0
    for c in contratos:
        cab = c.get("cabecalho", {}) or {}
        if cab.get("cCodSit") != "10" or cab.get("cTipoFat") != "01":
            continue  # só Ativo e faturamento mensal (mesma regra do relatório nativo)
        cod_ctr = cab.get("nCodCtr")
        if cod_ctr is None or cod_ctr in ja_cobertos:
            continue  # Omie já está projetando este contrato — não duplica
        try:
            fim_data = datetime.strptime(cab.get("dVigFinal") or "", "%d/%m/%Y")
        except ValueError:
            continue  # sem dVigFinal válido não é o caso que estamos resolvendo
        if fim_data >= hoje_ref or (hoje_ref - fim_data).days > JANELA_VIGENCIA_VENCIDA_DIAS:
            continue  # ainda vigente (já coberto) ou vencido há tempo demais

        venc_textos = c.get("vencTextos", {}) or {}
        try:
            dia_fixo = int(venc_textos.get("nDiaFixo") or 0)
        except (TypeError, ValueError):
            dia_fixo = 0
        if dia_fixo <= 0:
            # Mesmo fallback do relatório nativo (ver _dia_projetado_no_mes):
            # vencTextos.nDiaFixo=0 às vezes significa "vence nDias após o
            # dia de faturamento do contrato" em vez de "dia fixo do mês".
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
            })
            complementados += 1

    if complementados:
        print(f"  +{complementados} linha(s) complementares de contratos Ativos com vigência "
              f"vencida há até {JANELA_VIGENCIA_VENCIDA_DIAS} dias (previsão nativa do Omie não "
              "projeta mais — ver nota 01/10/2026).", flush=True)

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
