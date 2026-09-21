"""
Atualiza as 5 abas "Base -" do Oystr_Diagnostico_Consolidado.xlsx com
dados reais do Omie (em vez de export manual) — as 4 originais (Receber
Aberto, Pagar Aberto, Recebimentos, Pagamentos) mais "Base - Contratos
Recorrentes Nao Faturados" (2026-08-10, ver docstring de
omie_mcp/reports/oystr_diagnostico.py — "Receita recorrente ainda não
faturada"). O resto da planilha (Aging, Compromissos Futuros, Despesas
por Grupo, Resumo Executivo, Fluxo Diário) já recalcula sozinho em cima
dessas abas — este script NÃO mexe em mais nada além das abas "Base -",
e dentro delas só nas colunas de dado (nunca na tabela de mapeamento
Categoria->Grupo fixa em M2:N42 da aba "Base - Pagar Aberto").

Dois modos, por segurança — sempre rode --modo relatorio primeiro:

  --modo relatorio (padrão): só busca os dados no Omie e imprime
    estatísticas (quantos títulos em cada aba, taxa de conciliação dos
    títulos já liquidados/pagos com o extrato). NÃO escreve no arquivo.
    Serve pra conferir os números antes de confiar no automático.

  --modo escrever: além do relatório, escreve os dados nas 4 abas. Por
    padrão salva num arquivo NOVO, com nome padronizado
    "Oystr_Diagnostico_Consolidado_AAAAMMDD_HHMMSS.xlsx" (data/hora da
    rodada, ex.: Oystr_Diagnostico_Consolidado_20260819_155132.xlsx) —
    pedido do Rodrigo em 2026-08-19, pra ter um padrão único e ordenável
    por nome em vez do sufixo antigo "_atualizado" (que gerava sempre o
    mesmo nome, ambíguo entre rodadas, e virou motivo de confusão sobre
    qual arquivo era "o" oficial). Salvo na mesma pasta do --arquivo de
    entrada. Use --sobrescrever pra salvar em cima do arquivo de entrada
    em vez de gerar um novo (faça um backup antes).

Uso:
    python scripts\\refresh_oystr_diagnostico.py --cliente oystr ^
        --arquivo Oystr_Diagnostico_Consolidado.xlsx ^
        --desde 01/01/2025 --ate 05/08/2026

    python scripts\\refresh_oystr_diagnostico.py --cliente oystr ^
        --arquivo Oystr_Diagnostico_Consolidado.xlsx ^
        --desde 01/01/2025 --ate 05/08/2026 --modo escrever

IMPORTANTE — sempre usar a data de HOJE em --ate (não copiar as datas fixas
dos exemplos acima). Achado em 2026-08-10: rodar com --ate atrasado em
relação a hoje faz "Base - Recebimentos"/"Base - Pagamentos" pararem de
enxergar qualquer título baixado depois de --ate — e como esse título já
saiu de "Aberto" (foi baixado), ele some dos dois lados ao mesmo tempo,
abrindo um buraco no dia "Hoje" da aba Fluxo Diário (visto: R$9.390,49
sumidos com --ate 3 dias atrasado). O script agora avisa na tela se --ate
estiver atrasado, mas o certo é sempre passar a data de hoje.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpyxl import load_workbook  # noqa: E402

from omie_mcp.client import OmieClient  # noqa: E402
from omie_mcp.clients import ClientesConfigError, ClientesRegistry  # noqa: E402
from omie_mcp.reports import aging_recebiveis  # noqa: E402
from omie_mcp.reports import fluxo_diario_mensal  # noqa: E402
from omie_mcp.reports import oystr_diagnostico as relatorio  # noqa: E402

# Fórmulas regeneradas por linha (row = número da linha, 1-based).
_FORMULA_DIAS_ATRASO = "=TODAY()-D{row}"
_FORMULA_FAIXA = (
    '=IF(K{row}<0,"0) A vencer",IF(K{row}<=30,"1) 0-30 dias",'
    'IF(K{row}<=60,"2) 31-60 dias",IF(K{row}<=90,"3) 61-90 dias",'
    'IF(K{row}<=180,"4) 91-180 dias","5) +180 dias")))))'
)
_FORMULA_GRUPO_PAGAR = (
    '=IFERROR(INDEX($N$2:$N$42,MATCH(E{row},$M$2:$M$42,0)),"Outros/Não mapeado")'
)
_FORMULA_SALDO = "=H{row}-I{row}"  # J = A Receber / A Pagar = Valor da Conta - Recebido/Pago


def _limpar_e_escrever(ws, cabecalho_para_coluna, linhas, formulas_por_coluna, linha_inicial=2):
    """Escreve `linhas` (lista de dicts chave=nome da coluna do cabeçalho)
    a partir de `linha_inicial`, e limpa (None) qualquer sobra de linhas
    antigas além do novo total — só nas colunas presentes em
    `cabecalho_para_coluna` (nunca mexe em colunas fora desse mapa, ex.:
    M/N de "Base - Pagar Aberto")."""
    # IMPORTANTE: ws.cell(row, col, None) NÃO limpa a célula no openpyxl —
    # com value=None ele só faz um "get" e não escreve nada. Pra limpar (ou
    # escrever um valor que pode legitimamente ser None, como "Data de
    # Crédito" em título ainda não conciliado) é preciso setar `.value`
    # diretamente no objeto da célula.
    max_row_antiga = ws.max_row
    ultima_linha_nova = linha_inicial + len(linhas) - 1

    for i, linha in enumerate(linhas):
        row = linha_inicial + i
        for cabecalho, col in cabecalho_para_coluna.items():
            ws.cell(row, col).value = linha.get(cabecalho)
        for col, template in formulas_por_coluna.items():
            ws.cell(row, col).value = template.format(row=row)

    # limpa sobra de linhas antigas (linhas que existiam mas não têm mais dado novo)
    if max_row_antiga > ultima_linha_nova:
        colunas_para_limpar = set(cabecalho_para_coluna.values()) | set(formulas_por_coluna.keys())
        for row in range(ultima_linha_nova + 1, max_row_antiga + 1):
            for col in colunas_para_limpar:
                ws.cell(row, col).value = None

    return ultima_linha_nova


def escrever_planilha(caminho_entrada, caminho_saida, dados):
    wb = load_workbook(caminho_entrada, data_only=False)

    ws = wb["Base - Receber Aberto"]
    _limpar_e_escrever(
        ws,
        {"Razão Social": 1, "CNPJ/CPF": 2, "Emissão": 3, "Vencimento": 4, "Categoria": 5,
         "Documento": 6, "Conta Corrente": 7, "Valor da Conta": 8, "Recebido": 9,
         "Previsão": 13},
        dados["base_receber_aberto"],
        {10: _FORMULA_SALDO,  # J = A Receber = H - I
         11: _FORMULA_DIAS_ATRASO, 12: _FORMULA_FAIXA},
    )

    # 2026-08-13: lista de clientes com saldo vencido (Top 20 + "Todos")
    # recalculada dinamicamente a cada rodada — ver docstring de
    # aging_recebiveis.py (achado real: cliente novo com título vencido
    # nunca aparecia numa lista antes digitada à mão).
    aging_recebiveis.montar_aba_aging_recebiveis(wb, dados["base_receber_aberto"])

    ws = wb["Base - Pagar Aberto"]
    _limpar_e_escrever(
        ws,
        {"Razão Social": 1, "CNPJ/CPF": 2, "Emissão": 3, "Vencimento": 4, "Categoria": 5,
         "Documento": 6, "Conta Corrente": 7, "Valor da Conta": 8, "Valor Pago": 9,
         "Previsão": 12},
        dados["base_pagar_aberto"],
        {10: _FORMULA_SALDO,  # J = A Pagar = H - I
         11: _FORMULA_GRUPO_PAGAR},  # K = Grupo (fórmula usando a tabela fixa M2:N42)
    )

    ws = wb["Base - Recebimentos"]
    _limpar_e_escrever(
        ws,
        {"Cliente/Fornecedor": 1, "Emissão": 2, "Vencimento": 3,
         "Data de Crédito ou Débito (No Extrato)": 4, "Categoria": 5, "Documento": 6,
         "Conta Corrente": 7, "Valor da Conta": 8, "Recebido": 9},
        dados["base_recebimentos"],
        {},
    )

    ws = wb["Base - Pagamentos"]
    _limpar_e_escrever(
        ws,
        {"Cliente/Fornecedor": 1, "Emissão": 2, "Vencimento": 3,
         "Data de Crédito ou Débito (No Extrato)": 4, "Categoria": 5, "Documento": 6,
         "Conta Corrente": 7, "Valor da Conta": 8, "Valor Pago": 9},
        dados["base_pagamentos"],
        {},
    )

    # Aba nova (2026-08-10): receita de contrato recorrente ainda sem
    # título gerado — ver "Receita recorrente ainda não faturada" no
    # docstring de omie_mcp/reports/oystr_diagnostico.py. Cria do zero na
    # primeira vez que o script roda numa planilha antiga que ainda não
    # tem essa aba (idempotente: se já existir, só reescreve o conteúdo).
    #
    # BUG REAL corrigido em 2026-08-12: o nome original "Base - Contratos
    # Recorrentes Nao Faturados" tem 42 caracteres — o Excel só aceita até
    # 31 caracteres pra nome de aba. openpyxl deixa escrever (só avisa com
    # um UserWarning), mas o Excel de verdade pode recusar abrir o arquivo
    # ou truncar/renomear a aba sozinho, quebrando a referência
    # `'Base - Contratos Recorrentes Nao Faturados'!...` usada nas
    # fórmulas de fluxo_diario_mensal.py. Encontrado na primeira rodada
    # real de `--modo escrever` com essa aba (warning apareceu no
    # terminal do Rodrigo). Nome encurtado pra caber no limite — se uma
    # planilha antiga já tiver a aba com o nome LONGO (não deveria
    # acontecer neste caso, mas por segurança), migra o conteúdo pro nome
    # novo em vez de duplicar.
    nome_aba_contratos = "Base - Contratos Nao Faturados"
    nome_aba_contratos_antigo = "Base - Contratos Recorrentes Nao Faturados"
    if nome_aba_contratos_antigo in wb.sheetnames and nome_aba_contratos not in wb.sheetnames:
        wb[nome_aba_contratos_antigo].title = nome_aba_contratos
    if nome_aba_contratos not in wb.sheetnames:
        ws = wb.create_sheet(nome_aba_contratos)
        for col, titulo in enumerate(
            ["Razão Social", "CNPJ/CPF", "Contrato", "Categoria", "Valor Mensal", "Data Prevista"],
            start=1,
        ):
            ws.cell(row=1, column=col, value=titulo)
    else:
        ws = wb[nome_aba_contratos]
    _limpar_e_escrever(
        ws,
        {"Razão Social": 1, "CNPJ/CPF": 2, "Contrato": 3, "Categoria": 4,
         "Valor Mensal": 5, "Data Prevista": 6},
        dados["base_contratos_nao_faturados"],
        {},
    )

    # Aba nova (2026-08-13, bug #7): OS avulsa/pontual ainda não faturada
    # — categoria SEPARADA de "Base - Contratos Nao Faturados" porque não é
    # receita recorrente (pedido do Rodrigo: "as OSs não são projeção de
    # receita recorrente, mas são não recorrente/pontual"). Fonte: previsão
    # nativa do Omie (`ListarExtrato`, cOrigem "Previsão de Ordem de
    # Serviço") — ver montar_os_nao_faturadas_via_extrato() em
    # omie_mcp/reports/oystr_diagnostico.py. Mesmo padrão idempotente de
    # criação da aba de contratos acima.
    nome_aba_os = "Base - OS Nao Faturadas"
    if nome_aba_os not in wb.sheetnames:
        ws = wb.create_sheet(nome_aba_os)
        for col, titulo in enumerate(
            ["Razão Social", "CNPJ/CPF", "OS", "Categoria", "Valor", "Data Prevista"],
            start=1,
        ):
            ws.cell(row=1, column=col, value=titulo)
    else:
        ws = wb[nome_aba_os]
    _limpar_e_escrever(
        ws,
        {"Razão Social": 1, "CNPJ/CPF": 2, "OS": 3, "Categoria": 4,
         "Valor": 5, "Data Prevista": 6},
        dados["base_os_nao_faturadas"],
        {},
    )

    # Reconstrói a aba "Fluxo Diario <mês atual>" do zero em TODO --modo
    # escrever, pra qualquer mudança de fórmula (ex.: Vencimento -> Previsão,
    # 2026-08-08) se propagar automaticamente sem precisar de rebuild manual.
    aba_atual = fluxo_diario_mensal.atualizar_mes_atual(wb)
    print(f"\n[rotina mensal] aba '{aba_atual}' reconstruída (fórmula viva, mês atual).")

    # A partir do dia 20 do mês, garante que a aba "Fluxo Diario <mês seguinte>"
    # já existe (fórmula viva, puxando das abas "Base -" acima) — pedido do
    # Rodrigo em 2026-08-07. Não faz nada antes do dia 20, nem se a aba já
    # existir (seguro rodar em todo --modo escrever, não só a partir do dia 20).
    aba_criada = fluxo_diario_mensal.criar_proximo_mes_se_necessario(wb)
    if aba_criada:
        print(f"\n[rotina mensal] dia >= 20: aba '{aba_criada}' criada automaticamente "
              f"(fórmula viva) pro mês seguinte.")

    wb.save(caminho_saida)


def imprimir_relatorio(dados):
    est = dados["estatisticas"]
    print("\n=== Relatório (nada foi escrito no arquivo ainda) ===")
    print(f"Base - Receber Aberto: {est['receber_aberto']} títulos em aberto")
    print(f"Base - Pagar Aberto:   {est['pagar_aberto']} títulos em aberto")
    print(f"Base - Recebimentos:   {est['recebimentos_total']} títulos liquidados no período "
          f"| {est['recebimentos_conciliados']} conciliados com o extrato "
          f"({est['recebimentos_conciliados']}/{est['recebimentos_total']})")
    print(f"Base - Pagamentos:     {est['pagamentos_total']} títulos pagos no período "
          f"| {est['pagamentos_conciliados']} conciliados com o extrato "
          f"({est['pagamentos_conciliados']}/{est['pagamentos_total']})")
    print(f"Base - Contratos Recorrentes Nao Faturados: "
          f"{est['contratos_nao_faturados']} contrato(s)/mês projetado(s) "
          f"(mês atual + 2 seguintes) somando "
          f"R$ {est['contratos_nao_faturados_valor_total']:,.2f}")
    for item in est.get("contratos_nao_faturados_por_mes", []):
        print(f"  - {item['mes']:02d}/{item['ano']}: {item['contagem']} contrato(s), "
              f"R$ {item['valor']:,.2f}")
    if "os_nao_faturadas" in est:
        print(f"Base - OS Nao Faturadas: "
              f"{est['os_nao_faturadas']} OS/mês projetada(s) (mês atual + 2 seguintes) "
              f"somando R$ {est['os_nao_faturadas_valor_total']:,.2f}")
        for item in est.get("os_nao_faturadas_por_mes", []):
            print(f"  - {item['mes']:02d}/{item['ano']}: {item['contagem']} OS, "
                  f"R$ {item['valor']:,.2f}")

    nao_conciliados_r = [l for l in dados["base_recebimentos"] if not l["conciliado"]]
    nao_conciliados_p = [l for l in dados["base_pagamentos"] if not l["conciliado"]]
    if nao_conciliados_r:
        print(f"\n{len(nao_conciliados_r)} recebimento(s) SEM par no extrato "
              "(Data de Crédito ficará em branco — revisar manualmente), exemplos:")
        for l in nao_conciliados_r[:5]:
            print(f"  - {l['Cliente/Fornecedor']} | venc. {l['Vencimento']} | "
                  f"R$ {l['Valor da Conta']} | lançamento {l['codigo_lancamento_omie']}")
    if nao_conciliados_p:
        print(f"\n{len(nao_conciliados_p)} pagamento(s) SEM par no extrato "
              "(Data de Crédito ficará em branco — revisar manualmente), exemplos:")
        for l in nao_conciliados_p[:5]:
            print(f"  - {l['Cliente/Fornecedor']} | venc. {l['Vencimento']} | "
                  f"R$ {l['Valor da Conta']} | lançamento {l['codigo_lancamento_omie']}")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cliente", default=None)
    parser.add_argument("--arquivo", required=True,
                         help="caminho do Oystr_Diagnostico_Consolidado.xlsx")
    parser.add_argument("--desde", required=True, help="dd/mm/aaaa")
    parser.add_argument("--ate", required=True, help="dd/mm/aaaa")
    parser.add_argument("--modo", choices=["relatorio", "escrever"], default="relatorio")
    parser.add_argument("--sobrescrever", action="store_true",
                         help="com --modo escrever, salva em cima do arquivo de entrada "
                              "em vez de criar um arquivo novo com nome padronizado "
                              "Oystr_Diagnostico_Consolidado_AAAAMMDD_HHMMSS.xlsx")
    parser.add_argument("--debug-cliente", type=int, default=None,
                         help="código Omie do cliente (nCodCli) pra imprimir um rastro "
                              "detalhado, passo a passo, de como a projeção de receita "
                              "recorrente (contratos não faturados) decide incluir ou "
                              "pular cada mês desse cliente específico. Use --modo "
                              "relatorio (mais rápido, não escreve nada) junto com essa "
                              "flag pra investigar por que um contrato específico está "
                              "sendo incluído/excluído sem precisar adivinhar lendo código.")
    parser.add_argument("--banco", action="store_true",
                         help="além de (ou em vez de) escrever no Excel, grava os mesmos "
                              "dados no banco Postgres apontado por DATABASE_URL (ver "
                              "omie_mcp/db.py e db/schema.sql). Independente de --modo: "
                              "grava sempre que os dados forem buscados com sucesso, "
                              "mesmo em --modo relatorio. Nunca sobrescreve uma rodada "
                              "anterior — cada execução vira uma linha nova em "
                              "rodadas_extracao, carimbando as linhas de dado com o "
                              "mesmo rodada_id. Requer `pip install \"psycopg[binary]\"` "
                              "e a variável de ambiente DATABASE_URL configurada; se "
                              "psycopg não estiver instalado ou DATABASE_URL não estiver "
                              "definida, o script AVISA e não trava — a saída em Excel "
                              "continua funcionando normalmente sem essa dependência.")
    args = parser.parse_args()

    try:
        registry = ClientesRegistry.load()
        slug = registry.resolver_slug(args.cliente)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"[config] {exc}")
        return 1

    caminho_entrada = Path(args.arquivo)
    if not caminho_entrada.exists():
        print(f"[erro] arquivo não encontrado: {caminho_entrada}")
        return 1

    # Aviso pra evitar o buraco de 2026-08-10 (ver docstring do módulo):
    # --ate atrasado em relação a hoje faz título baixado nesse meio-tempo
    # sumir de "Aberto" (baixado) E de "Recebimentos"/"Pagamentos" (fora da
    # janela) ao mesmo tempo — invisível no relatório sem nenhum erro.
    try:
        ate_dt = datetime.strptime(args.ate, "%d/%m/%Y").date()
        hoje = datetime.now().date()
        if ate_dt < hoje:
            dias_atras = (hoje - ate_dt).days
            print(
                f"[aviso] --ate {args.ate} está {dias_atras} dia(s) atrás de hoje "
                f"({hoje.strftime('%d/%m/%Y')}) — títulos baixados entre {args.ate} e "
                f"hoje NÃO vão aparecer em 'Base - Recebimentos'/'Base - Pagamentos' "
                f"(mesmo já tendo saído de 'Aberto'), o que pode abrir um buraco no dia "
                f"'Hoje' da aba Fluxo Diário. Recomendado: rode de novo com --ate "
                f"{hoje.strftime('%d/%m/%Y')} (data de hoje) antes de confiar no "
                f"resultado."
            )
    except ValueError:
        pass  # formato inesperado — deixa o parsing normal do relatório reclamar

    print(f"Cliente: {slug} | período: {args.desde} a {args.ate}")
    print("Buscando dados no Omie (pode levar alguns minutos)...")

    async with OmieClient(settings) as client:
        dados = await relatorio.montar_relatorio(
            client, args.desde, args.ate, debug_cod_cli=args.debug_cliente
        )

    imprimir_relatorio(dados)

    # --- Gravação opcional no banco (--banco) --------------------------------
    # Independente de --modo (relatorio/escrever) e do Excel: os MESMOS dados
    # já buscados acima (`dados`, o dict de montar_relatorio()) só são
    # gravados como estão — nenhuma lógica de negócio nova aqui, ver
    # omie_mcp/db.py. Uma falha na gravação em banco NUNCA derruba o
    # restante do script (mesmo princípio já usado pra _salvar_cache_titulos
    # em oystr_diagnostico.py — o dado já foi buscado do Omie a duras penas,
    # perder só a cópia em banco não pode custar também a saída em Excel).
    if args.banco:
        try:
            from omie_mcp import db
            conn = db.conectar()
            db.garantir_schema(conn)
            rodada_id = db.nova_rodada(
                conn, empresa=slug, tipo="diagnostico",
                data_de=args.desde, data_ate=args.ate,
                parametros={"desde": args.desde, "ate": args.ate, "modo": args.modo},
            )
            try:
                n = db.gravar_titulos_movimento(conn, rodada_id, slug, dados)
                db.concluir_rodada(conn, rodada_id, status="concluida")
                print(f"\n[banco] rodada {rodada_id} gravada: {n} linha(s) em titulos_movimento.")
            except Exception as exc:  # noqa: BLE001 — nunca deixa isso derrubar o script
                db.concluir_rodada(conn, rodada_id, status="falhou", erro=str(exc))
                print(f"\n[banco][aviso] falha ao gravar rodada {rodada_id}: {exc}")
        except Exception as exc:  # noqa: BLE001 — psycopg ausente, DATABASE_URL ausente, etc.
            print(f"\n[banco][aviso] gravação em banco pulada (--banco foi pedido, mas "
                  f"falhou antes de gravar qualquer coisa): {exc}")

    if args.modo == "escrever":
        if args.sobrescrever:
            caminho_saida = caminho_entrada
        else:
            # Padrão de nome pedido pelo Rodrigo em 2026-08-19: nome fixo +
            # timestamp da rodada (AAAAMMDD_HHMMSS) — único, ordenável por
            # nome, e nunca ambíguo sobre qual arquivo é o mais recente.
            # Salvo na mesma pasta do arquivo de entrada.
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            caminho_saida = caminho_entrada.with_name(
                f"Oystr_Diagnostico_Consolidado_{timestamp}{caminho_entrada.suffix}"
            )
        escrever_planilha(caminho_entrada, caminho_saida, dados)
        print(f"\nPlanilha atualizada salva em: {caminho_saida}")
    else:
        print("\n(modo relatório — nada foi escrito; rode com --modo escrever quando "
              "os números acima parecerem corretos)")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
