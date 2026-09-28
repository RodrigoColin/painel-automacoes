"""
Extrai o fluxo de caixa diário de um cliente do Omie no MESMO formato que a
tela "Fluxo de caixa" do Portal Proos usa (src/lib/omie/fluxo-caixa.ts), para
montar o artefato com dados reais enquanto o portal não está publicado.

Onde salvar e rodar: na pasta proos-automacoes/oystr (a mesma de fluxo_caixa.py),
porque lê o credenciais.env dali (linhas OYSTR_KEY= e OYSTR_SECRET=).

    python extrair_fluxo_caixa_portal.py --cliente OYSTR --garantida "garantida=61500"

Além da janela diária (7 dias para trás, 45 para a frente), gera o histórico mensal realizado desde
--historico_desde (padrão 2025-01-01) direto do extrato — mesma base do relatório "Fluxo de Caixa por
Categoria Mensal" do Omie — com entradas, saídas, saldo no fim do mês e valor por categoria. Isso custa
~1 chamada por conta por mês (1,5 s cada); use --historico_desde nao para pular.

Gera fluxo_caixa_portal_OYSTR.json na mesma pasta. O arquivo NÃO contém chaves
do Omie — só saldos, movimentos e um diagnóstico dos campos do extrato.

Lógica (igual à do portal e à rotina fluxo_caixa.py já validada):
  - ListarContasCorrentes -> contas ativas, fora as marcadas "não considerar" no
    Omie, as de perda/prejuízo e as informadas em --excluir.
  - ListarExtrato por conta, mês a mês (o Omie trunca período longo em silêncio),
    com 1,5 s entre chamadas.
  - "SALDO ANTERIOR" = saldo real de abertura. Passado: só o que aconteceu
    (título liquidado e lançamento direto na conta). Hoje em diante: tudo,
    inclusive previsão nativa de contratos e OS.
  - Conta garantida é dívida: fica fora do caixa próprio e vira limite livre.
"""

import argparse
import calendar
import html
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import date, datetime, timedelta

import requests

BASE = "https://app.omie.com.br/api/v1"
DIAS_PASSADOS = 7
DIAS_FUTUROS = 45
ESPERA = 1.5

# Contas da Oystr que a rotina fluxo_caixa.py já exclui (o Omie devolve os flags errados).
EXCLUIR_PADRAO = {"OYSTR": {1847900459, 1860513751, 2182599423, 2263959487}}
# Limite da conta (cheque especial) por cliente, aplicado quando o Omie não informa limite na conta
# (2026-09-25: a rodada de 24/09 veio com o limite do Itaú zerado e o painel mostrou "Limite R$ 0").
LIMITE_PADRAO = {"OYSTR": {"itau - conta corrente": 61500.0}}

ORIGENS_PREVISTAS = {
    "Conta a Receber",
    "Conta a Pagar",
    "Previsão de Pedido de Compra",
    "Previsão de Pedido de Venda",
    "Previsão de Contratos Mensais",
    "Previsão de Ordem de Serviço",
}


def carregar_credenciais(cliente):
    caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)), "credenciais.env")
    chave = segredo = None
    with open(caminho, encoding="utf-8") as arquivo:
        for linha in arquivo:
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            nome, valor = linha.split("=", 1)
            nome, valor = nome.strip().upper(), valor.strip().strip('"').strip("'")
            if nome == cliente + "_KEY":
                chave = valor
            elif nome == cliente + "_SECRET":
                segredo = valor
    if not chave or not segredo:
        sys.exit(f"Não achei {cliente}_KEY e {cliente}_SECRET em {caminho}")
    return chave, segredo


def omie(modulo, call, param, chave, segredo):
    for tentativa in range(4):
        resposta = requests.post(
            f"{BASE}/{modulo}/",
            json={"call": call, "app_key": chave, "app_secret": segredo, "param": [param]},
            timeout=60,
        )
        corpo = resposta.json()
        falha = corpo.get("faultstring") if isinstance(corpo, dict) else None
        if not falha:
            return corpo
        if re.search(r"não existem registros", falha, re.I):
            return {}
        if tentativa < 3 and re.search(r"redundant|aguarde|bloquead|limite|tente novamente", falha, re.I):
            espera = 5 * (tentativa + 1)
            print(f"    Omie pediu para esperar ({falha[:70]}...). Aguardando {espera}s")
            time.sleep(espera)
            continue
        raise RuntimeError(f"Omie ({call}): {falha}")


def iso(data_br):
    try:
        return datetime.strptime(data_br or "", "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def br(data_iso):
    return datetime.strptime(data_iso, "%Y-%m-%d").strftime("%d/%m/%Y")


def trechos_mensais(inicio, fim):
    de = inicio
    while de <= fim:
        ultimo = date(de.year, de.month, calendar.monthrange(de.year, de.month)[1])
        ate = min(ultimo, fim)
        yield de, ate
        de = ate + timedelta(days=1)


def limpar(texto):
    return html.unescape(texto or "").strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cliente", required=True)
    parser.add_argument("--excluir", default="", help="nCodCC extras para deixar de fora, separados por vírgula")
    parser.add_argument("--garantida", action="append", default=[],
                        help='conta garantida: "<trecho do nome ou nCodCC>=<limite>". Pode repetir.')
    parser.add_argument("--aplicacao_travada", default="",
                        help="trechos de nome (separados por vírgula) de aplicações SEM liquidez imediata")
    parser.add_argument("--saldo_minimo", type=float, default=None)
    parser.add_argument("--saida", default=None,
                        help="pasta do pacote de dados (ex.: ...\\proos-omie-mcp\\dados\\oystr\\AAAA-MM-DD); grava extrato.json lá "
                             "em vez de fluxo_caixa_portal_<CLIENTE>.json nesta pasta")
    parser.add_argument("--historico_desde", default="2025-01-01",
                        help="início do histórico mensal realizado (AAAA-MM-DD); use 'nao' para pular")
    args = parser.parse_args()

    cliente = args.cliente.upper()
    chave, segredo = carregar_credenciais(cliente)
    excluir = set(EXCLUIR_PADRAO.get(cliente, set()))
    excluir |= {int(c) for c in args.excluir.split(",") if c.strip()}
    garantidas = [tuple(g.split("=", 1)) for g in args.garantida if "=" in g]
    travadas = [t.strip().lower() for t in args.aplicacao_travada.split(",") if t.strip()]

    hoje = date.today()
    inicio, fim = hoje - timedelta(days=DIAS_PASSADOS), hoje + timedelta(days=DIAS_FUTUROS)
    hoje_iso = hoje.isoformat()

    print("Buscando contas correntes...")
    contas_omie = []
    for pagina in range(1, 11):
        lote = omie("geral/contacorrente", "ListarContasCorrentes",
                    {"pagina": pagina, "registros_por_pagina": 100}, chave, segredo)
        contas_omie += lote.get("ListarContasCorrentes", [])
        if pagina >= lote.get("total_de_paginas", 1):
            break

    contas, movimentos, avisos = [], [], []
    historico = {}          # (codigo_conta, "AAAA-MM") -> {"e":..,"s":..,"cat":{categoria: valor liquido}}
    abertura_hist = {}      # codigo_conta -> saldo em historico_desde
    hist_desde = None
    if args.historico_desde.lower() not in ("nao", "não", "n", ""):
        hist_desde = datetime.strptime(args.historico_desde, "%Y-%m-%d").date()
    situacoes, origens, campos = Counter(), Counter(), Counter()
    amostras = {}
    primeira = True

    for conta in contas_omie:
        codigo = conta["nCodCC"]
        nome = limpar(conta.get("descricao")) or str(codigo)
        nome_min = nome.lower()
        entra = (conta.get("inativo", "N") == "N" and conta.get("nao_fluxo", "N") == "N"
                 and conta.get("nao_resumo", "N") == "N" and codigo not in excluir
                 and not re.search(r"perda|preju[ií]zo", nome_min))
        if not entra:
            print(f"  fora do fluxo: {codigo} | {nome}")
            continue

        tipo, limite = "corrente", 0.0
        for alvo, valor in garantidas:
            if alvo.strip() == str(codigo) or alvo.strip().lower() in nome_min:
                tipo, limite = "garantida", float(valor.replace(".", "").replace(",", "."))
        if tipo == "corrente" and re.search(r"garantida|cheque especial", nome_min):
            tipo, limite = "garantida", float(conta.get("valor_limite") or 0)
        if tipo == "corrente" and re.search(r"aplica|cdb|invest|poupan|fundo", nome_min):
            tipo = "aplicacao"
        if tipo == "corrente" and not limite:
            for trecho, valor_lim in LIMITE_PADRAO.get(cliente, {}).items():
                if trecho in nome_min:
                    limite = valor_lim
        liquidez = not any(t in nome_min for t in travadas)

        # --- histórico mensal realizado (mesma base do relatório "Fluxo de Caixa por Categoria Mensal" do Omie) ---
        if hist_desde and hist_desde < inicio:
            try:
                for indice_h, (de, ate) in enumerate(trechos_mensais(hist_desde, inicio - timedelta(days=1))):
                    if not primeira:
                        time.sleep(ESPERA)
                    primeira = False
                    lote = omie("financas/extrato", "ListarExtrato", {
                        "nCodCC": codigo, "cCodIntCC": "",
                        "dPeriodoInicial": de.strftime("%d/%m/%Y"), "dPeriodoFinal": ate.strftime("%d/%m/%Y"),
                    }, chave, segredo)
                    for mov in lote.get("listaMovimentos", []):
                        if (mov.get("cDesCliente") or "").upper() == "SALDO ANTERIOR":
                            if indice_h == 0:
                                abertura_hist[codigo] = float(mov.get("nSaldo") or 0)
                            continue
                        data = iso(mov.get("dDataLancamento"))
                        valor_abs = abs(float(mov.get("nValorDocumento") or 0))
                        origem = mov.get("cOrigem") or ""
                        if not data or valor_abs == 0 or origem in ORIGENS_PREVISTAS or data >= inicio.isoformat():
                            continue
                        if re.search(r"transfer", origem, re.I) or re.search(r"transfer", mov.get("cDesCategoria") or "", re.I):
                            continue  # transferência entre contas próprias não é entrada nem saída do caixa
                        valor = valor_abs if mov.get("cNatureza") == "R" else -valor_abs
                        chave_h = (codigo, data[:7])
                        h = historico.setdefault(chave_h, {"e": 0.0, "s": 0.0, "cat": {}})
                        if valor > 0:
                            h["e"] += valor
                        else:
                            h["s"] -= valor
                        cat = limpar(mov.get("cDesCategoria")) or "Sem categoria"
                        h["cat"][cat] = h["cat"].get(cat, 0.0) + valor
            except Exception as erro:
                avisos.append(f'Histórico mensal de "{nome}" incompleto: {erro}')
                print(f"  ERRO no histórico de {nome}: {erro}")

        saldo, abertura, conciliado_ate, pendentes = 0.0, None, None, 0
        try:
            for indice, (de, ate) in enumerate(trechos_mensais(inicio, fim)):
                if not primeira:
                    time.sleep(ESPERA)
                primeira = False
                lote = omie("financas/extrato", "ListarExtrato", {
                    "nCodCC": codigo, "cCodIntCC": "",
                    "dPeriodoInicial": de.strftime("%d/%m/%Y"), "dPeriodoFinal": ate.strftime("%d/%m/%Y"),
                }, chave, segredo)
                for mov in lote.get("listaMovimentos", []):
                    if (mov.get("cDesCliente") or "").upper() == "SALDO ANTERIOR":
                        if indice == 0 and abertura is None:
                            abertura = float(mov.get("nSaldo") or 0)
                            saldo = abertura
                        continue
                    data = iso(mov.get("dDataLancamento"))
                    valor_abs = abs(float(mov.get("nValorDocumento") or 0))
                    if not data or valor_abs == 0:
                        continue
                    origem = mov.get("cOrigem") or ""
                    origens[origem] += 1
                    situacoes[(origem, mov.get("cSituacao") or "")] += 1
                    campos.update(k for k, v in mov.items() if v not in (None, "", 0))
                    amostras.setdefault(origem, {k: v for k, v in mov.items()
                                                 if k.startswith(("cOrigem", "cSituacao", "cNatureza", "dData", "cTipo"))})

                    previsto = origem in ORIGENS_PREVISTAS
                    realizado = (not previsto) and data <= hoje_iso
                    if data < hoje_iso and not realizado:
                        continue  # previsão vencida não é caixa
                    valor = valor_abs if mov.get("cNatureza") == "R" else -valor_abs
                    if realizado:
                        saldo += valor
                        if re.search("concilia", mov.get("cSituacao") or "", re.I) or mov.get("dDataConciliacao"):
                            conciliado_ate = max(conciliado_ate or data, data)
                        else:
                            pendentes += 1
                    movimentos.append({
                        "id": f"{codigo}-{mov.get('nCodLancamento', len(movimentos))}-{data}",
                        "data": data, "vencimento": iso(mov.get("dDataVencimento")), "conta": codigo,
                        "nome": limpar(mov.get("cRazCliente") or mov.get("cDesCliente")) or "Sem identificação",
                        "categoria": limpar(mov.get("cDesCategoria")) or "Sem categoria",
                        "documento": mov.get("cNumero") or "", "origem": origem,
                        "valor": round(valor, 2), "realizado": realizado,
                    })
        except Exception as erro:  # segue com as outras contas
            avisos.append(f'Não foi possível ler o extrato de "{nome}": {erro}')
            print(f"  ERRO em {nome}: {erro}")
            continue

        soma = tipo == "corrente" or (tipo == "aplicacao" and liquidez)
        contas.append({
            "codigo": codigo, "descricao": nome, "banco": conta.get("codigo_banco") or "",
            "entra": True, "tipo": tipo, "liquidezImediata": liquidez, "limite": limite,
            "saldo": round(saldo, 2), "somaNoCaixa": soma,
            "conciliadoAte": conciliado_ate, "pendentesConciliacao": pendentes,
        })
        print(f"  {codigo} | {nome} | {tipo} | saldo hoje R$ {saldo:,.2f} | conciliado até {conciliado_ate}")

    no_caixa = {c["codigo"] for c in contas if c["somaNoCaixa"]}
    caixa = sum(c["saldo"] for c in contas if c["somaNoCaixa"])
    limite_livre = sum(max(0.0, c["limite"] + min(0.0, c["saldo"])) for c in contas if c["tipo"] == "garantida")

    por_dia = {}
    for mov in movimentos:
        if mov["conta"] not in no_caixa:
            continue
        dia = por_dia.setdefault(mov["data"], {"e": 0.0, "s": 0.0, "r": 0.0})
        if mov["valor"] > 0:
            dia["e"] += mov["valor"]
        else:
            dia["s"] -= mov["valor"]
        if mov["realizado"]:
            dia["r"] += mov["valor"]

    datas = [(inicio + timedelta(days=n)).isoformat() for n in range((fim - inicio).days + 1)]
    vazio = {"e": 0.0, "s": 0.0, "r": 0.0}
    dia_hoje = por_dia.get(hoje_iso, vazio)
    saldo_dia = {hoje_iso: caixa + (dia_hoje["e"] - dia_hoje["s"] - dia_hoje["r"])}
    corrente = saldo_dia[hoje_iso]
    for data in (d for d in datas if d > hoje_iso):
        dia = por_dia.get(data, vazio)
        corrente += dia["e"] - dia["s"]
        saldo_dia[data] = corrente
    corrente = caixa - dia_hoje["r"]
    for data in reversed([d for d in datas if d < hoje_iso]):
        saldo_dia[data] = corrente
        corrente -= por_dia.get(data, vazio)["r"]

    dias = [{
        "data": d, "tipo": "realizado" if d < hoje_iso else "hoje" if d == hoje_iso else "previsto",
        "entradas": round(por_dia.get(d, vazio)["e"], 2), "saidas": round(por_dia.get(d, vazio)["s"], 2),
        "saldo": round(saldo_dia[d], 2),
    } for d in datas]

    historico_mensal = []
    if hist_desde:
        meses_h = sorted({m for (c, m) in historico if c in no_caixa})
        acum = sum(v for c, v in abertura_hist.items() if c in no_caixa)
        abertura_total = acum
        for m in meses_h:
            e = s = 0.0
            cats = {}
            for (c, mm), h in historico.items():
                if mm != m or c not in no_caixa:
                    continue
                e += h["e"]; s += h["s"]
                for cat, v in h["cat"].items():
                    cats[cat] = cats.get(cat, 0.0) + v
            acum += e - s
            historico_mensal.append({"mes": m, "entradas": round(e, 2), "saidas": round(s, 2), "saldo": round(e - s, 2),
                                     "saldoFim": round(acum, 2),
                                     "categorias": {k: round(v, 2) for k, v in sorted(cats.items(), key=lambda kv: -abs(kv[1])) if abs(v) >= 0.005}})
        if historico_mensal:
            print(f"Histórico mensal: {historico_mensal[0]['mes']} a {historico_mensal[-1]['mes']} | abertura R$ {abertura_total:,.2f} | fim R$ {historico_mensal[-1]['saldoFim']:,.2f}")

    movimentos.sort(key=lambda m: (m["data"], -abs(m["valor"])))
    saida = {
        "historicoDesde": hist_desde.isoformat() if hist_desde else None,
        "aberturaHistorico": round(sum(v for c, v in abertura_hist.items() if c in no_caixa), 2) if hist_desde else None,
        "historicoMensal": historico_mensal,
        "cliente": cliente, "consultadoEm": datetime.now().astimezone().isoformat(timespec="seconds"),
        "hoje": hoje_iso, "saldoMinimo": args.saldo_minimo, "contas": contas, "dias": dias,
        "movimentos": movimentos, "caixaProprio": round(caixa, 2), "limiteLivre": round(limite_livre, 2),
        "avisos": avisos,
        "diagnostico": {
            "origens": dict(origens),
            "situacoesPorOrigem": {f"{o} | {s}": n for (o, s), n in situacoes.most_common()},
            "camposPreenchidos": dict(campos.most_common()),
            "amostraPorOrigem": amostras,
        },
    }
    if args.saida:
        os.makedirs(args.saida, exist_ok=True)
        destino = os.path.join(args.saida, "extrato.json")
    else:
        destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"fluxo_caixa_portal_{cliente}.json")
    with open(destino, "w", encoding="utf-8") as arquivo:
        json.dump(saida, arquivo, ensure_ascii=False, indent=1)

    pior = min((d for d in dias if d["tipo"] != "realizado"), key=lambda d: d["saldo"])
    print(f"\nCaixa próprio hoje: R$ {caixa:,.2f} | limite livre: R$ {limite_livre:,.2f}")
    print(f"Menor saldo projetado: R$ {pior['saldo']:,.2f} em {br(pior['data'])}")
    print(f"{len(movimentos)} movimentos em {len(contas)} contas.\nArquivo gravado: {destino}")


if __name__ == "__main__":
    main()
