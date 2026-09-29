"""
Fluxo de caixa diário pelo extrato do Omie (ListarExtrato).

Portado de scripts/extrair_fluxo_caixa_portal.py sem mudar a lógica — a
mesma da tela antiga (src/lib/omie/fluxo-caixa.ts) e da rotina fluxo_caixa.py:

  - ListarContasCorrentes -> contas que entram no fluxo (ver contas.py).
  - ListarExtrato por conta, mês a mês (o Omie trunca período longo em
    silêncio), com 1,5 s entre chamadas.
  - "SALDO ANTERIOR" = saldo real de abertura. Passado: só o que aconteceu
    (título liquidado e lançamento direto na conta). Hoje em diante: tudo,
    inclusive previsão nativa de contratos e OS.
  - Conta garantida é dívida: fica fora do caixa próprio e vira limite livre.

O que mudou: contas excluídas e limites vêm das marcações da empresa (antes
eram fixos para a Oystr), credenciais chegam por parâmetro, e há uma leitura
extra do saldo de abertura em `abertura_em` (1º de janeiro do ano anterior),
ponto de partida do histórico mensal.
"""

from __future__ import annotations

import calendar
import html
import re
import time
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any, Callable

import requests

from . import contas as regras_contas

BASE = "https://app.omie.com.br/api/v1"
DIAS_PASSADOS = 7
DIAS_FUTUROS = 45
ESPERA = 1.5

ORIGENS_PREVISTAS = {
    "Conta a Receber",
    "Conta a Pagar",
    "Previsão de Pedido de Compra",
    "Previsão de Pedido de Venda",
    "Previsão de Contratos Mensais",
    "Previsão de Ordem de Serviço",
}


class _Omie:
    def __init__(self, chave: str, segredo: str, log: Callable[[str], None]):
        self.chave, self.segredo, self.log = chave, segredo, log
        self._ultima = 0.0

    def __call__(self, modulo: str, call: str, param: dict[str, Any]) -> dict[str, Any]:
        espera = ESPERA - (time.monotonic() - self._ultima)
        if espera > 0:
            time.sleep(espera)
        try:
            for tentativa in range(4):
                resposta = requests.post(
                    f"{BASE}/{modulo}/",
                    json={"call": call, "app_key": self.chave, "app_secret": self.segredo, "param": [param]},
                    timeout=60,
                )
                corpo = resposta.json()
                falha = corpo.get("faultstring") if isinstance(corpo, dict) else None
                if not falha:
                    return corpo
                if re.search(r"não existem registros", falha, re.I):
                    return {}
                if tentativa < 3 and re.search(r"redundant|aguarde|bloquead|limite|tente novamente", falha, re.I):
                    espera_s = 5 * (tentativa + 1)
                    self.log(f"    Omie pediu para esperar ({falha[:70]}...). Aguardando {espera_s}s")
                    time.sleep(espera_s)
                    continue
                raise RuntimeError(f"Omie ({call}): {falha}")
            raise RuntimeError(f"Omie ({call}): tentativas esgotadas")
        finally:
            self._ultima = time.monotonic()


def iso(data_br: str | None) -> str | None:
    try:
        return datetime.strptime(data_br or "", "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def trechos_mensais(inicio: date, fim: date):
    de = inicio
    while de <= fim:
        ultimo = date(de.year, de.month, calendar.monthrange(de.year, de.month)[1])
        ate = min(ultimo, fim)
        yield de, ate
        de = ate + timedelta(days=1)


def limpar(texto: str | None) -> str:
    return html.unescape(texto or "").strip()


def listar_contas(omie: _Omie) -> list[dict[str, Any]]:
    contas: list[dict[str, Any]] = []
    for pagina in range(1, 11):
        lote = omie("geral/contacorrente", "ListarContasCorrentes", {"pagina": pagina, "registros_por_pagina": 100})
        contas += lote.get("ListarContasCorrentes", [])
        if pagina >= lote.get("total_de_paginas", 1):
            break
    return contas


def _saldo_anterior(omie: _Omie, codigo: int, dia: date) -> float | None:
    fim = date(dia.year, dia.month, calendar.monthrange(dia.year, dia.month)[1])
    lote = omie("financas/extrato", "ListarExtrato", {
        "nCodCC": codigo, "cCodIntCC": "",
        "dPeriodoInicial": dia.strftime("%d/%m/%Y"), "dPeriodoFinal": fim.strftime("%d/%m/%Y"),
    })
    for mov in lote.get("listaMovimentos", []):
        if (mov.get("cDesCliente") or "").upper() == "SALDO ANTERIOR":
            return float(mov.get("nSaldo") or 0)
    return None


def extrair_extrato(
    chave: str,
    segredo: str,
    marcacoes: dict[str, dict[str, Any]],
    *,
    saldo_minimo: float | None = None,
    abertura_em: date | None = None,
    hoje: date | None = None,
    log: Callable[[str], None] = print,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Devolve o extrato montado e a lista crua de contas do Omie (para
    derivar as contas excluídas das bases de títulos sem listar de novo)."""
    omie = _Omie(chave, segredo, log)
    hoje = hoje or date.today()
    inicio, fim = hoje - timedelta(days=DIAS_PASSADOS), hoje + timedelta(days=DIAS_FUTUROS)
    hoje_iso = hoje.isoformat()

    log("Buscando contas correntes...")
    contas_omie = listar_contas(omie)

    contas, movimentos, avisos = [], [], []
    situacoes, origens, campos = Counter(), Counter(), Counter()
    amostras: dict[str, Any] = {}
    abertura_total = 0.0

    for conta in contas_omie:
        codigo = conta["nCodCC"]
        nome = limpar(conta.get("descricao")) or str(codigo)
        m = regras_contas.marcacao(conta, marcacoes)
        if not m["entra"]:
            log(f"  fora do fluxo: {codigo} | {nome}")
            continue
        tipo, limite, liquidez = m["tipo"], float(m["limite"] or 0), bool(m["liquidezImediata"])
        soma = regras_contas.soma_no_caixa(m)

        saldo, abertura, conciliado_ate, pendentes = 0.0, None, None, 0
        try:
            if abertura_em and soma:
                valor = _saldo_anterior(omie, codigo, abertura_em)
                abertura_total += valor or 0.0

            for indice, (de, ate) in enumerate(trechos_mensais(inicio, fim)):
                lote = omie("financas/extrato", "ListarExtrato", {
                    "nCodCC": codigo, "cCodIntCC": "",
                    "dPeriodoInicial": de.strftime("%d/%m/%Y"), "dPeriodoFinal": ate.strftime("%d/%m/%Y"),
                })
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
            log(f"  ERRO em {nome}: {erro}")
            continue

        contas.append({
            "codigo": codigo, "descricao": nome, "banco": conta.get("codigo_banco") or "",
            "entra": True, "tipo": tipo, "liquidezImediata": liquidez, "limite": limite,
            "saldo": round(saldo, 2), "somaNoCaixa": soma,
            "conciliadoAte": conciliado_ate, "pendentesConciliacao": pendentes,
        })
        log(f"  {codigo} | {nome} | {tipo} | saldo hoje R$ {saldo:,.2f} | conciliado até {conciliado_ate}")

    if not contas:
        avisos.append("Nenhuma conta corrente marcada para o fluxo de caixa.")

    no_caixa = {c["codigo"] for c in contas if c["somaNoCaixa"]}
    caixa = sum(c["saldo"] for c in contas if c["somaNoCaixa"])
    limite_livre = sum(max(0.0, c["limite"] + min(0.0, c["saldo"])) for c in contas if c["tipo"] == "garantida")

    por_dia: dict[str, dict[str, float]] = {}
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

    movimentos.sort(key=lambda m: (m["data"], -abs(m["valor"])))
    return {
        "consultadoEm": datetime.now().astimezone().isoformat(timespec="seconds"),
        "hoje": hoje_iso, "saldoMinimo": saldo_minimo, "contas": contas, "dias": dias,
        "movimentos": movimentos, "caixaProprio": round(caixa, 2), "limiteLivre": round(limite_livre, 2),
        "aberturaEm": abertura_em.isoformat() if abertura_em else None,
        "abertura": round(abertura_total, 2) if abertura_em else None,
        "avisos": avisos,
        "diagnostico": {
            "origens": dict(origens),
            "situacoesPorOrigem": {f"{o} | {s}": n for (o, s), n in situacoes.most_common()},
            "camposPreenchidos": dict(campos.most_common()),
            "amostraPorOrigem": amostras,
        },
    }, contas_omie
