"""
Monta o pacote de fluxo de caixa (extrato + 7 bases + manifesto) a partir do
Nibo, na MESMA forma que caixa/extrato.py + caixa/bases.py produzem do Omie.

Fontes do Nibo:
  - GET /accounts                              -> contas (saldo via extrato)
  - GET /accounts/{id}/views/statement         -> realizado + saldo corrente + abertura
  - GET /schedules/credit | /schedules/debit   -> a receber / a pagar (abertos) e
                                                  índice de categoria do realizado

Decisões que espelham o Omie (ver docstrings de caixa/extrato.py e caixa/extra.py):
  - abertura do histórico = saldo no início do período no 1º dia de `abertura_em`
    (linha StartAccountBalance do extrato), não o openBalance de cadastro.
  - "previsão vencida não é caixa": agendamento em aberto com vencimento < hoje
    não vira linha futura do extrato (continua no a-receber/a-pagar p/ inadimplência).
  - contratos/OS não existem no Nibo -> bases vazias (montar_extra lida bem).
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from typing import Any, Callable

from .cliente import NiboClient, NiboError, NiboTokenExpirado  # noqa: F401 (reexport via __init__)

DIAS_PASSADOS = 7
DIAS_FUTUROS = 45


def _fim_mes_seguinte(hoje: date) -> date:
    """Último dia do mês seguinte — mesma janela que a aba Diário (porte de
    caixa/extrato.py::_fim_mes_seguinte)."""
    ano, mes = (hoje.year + 1, 1) if hoje.month == 12 else (hoje.year, hoje.month + 1)
    return date(ano, mes, calendar.monthrange(ano, mes)[1])


def _dia(valor: str | None) -> str | None:
    """Datetime ISO do Nibo ('2026-11-20T00:00:00Z') -> 'YYYY-MM-DD'."""
    if not valor:
        return None
    s = str(valor)[:10]
    return s if len(s) == 10 else None


def _texto(s: str | None) -> str:
    """Conserta, com cautela, nomes que o Nibo às vezes devolve com UTF-8 duplo
    ('saÃºde' em vez de 'saúde'). Só mexe quando há o rastro ('Ã'/'Â')."""
    t = (s or "").strip()
    if "Ã" in t or "Â" in t:
        try:
            return t.encode("latin-1").decode("utf-8")
        except (UnicodeError, ValueError):
            return t
    return t


def _marcar_conta(acc: dict[str, Any], marcacoes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Mesma ideia de caixa/contas.py::config_padrao, adaptada ao cadastro de
    conta do Nibo. Marcação da empresa (fluxo_caixa_config.contas, chaveada pelo
    id OU nome da conta) prevalece campo a campo."""
    import re

    nome = (acc.get("name") or "").lower()
    cartao = bool(re.search(r"cart[aã]o de cr[eé]dito", nome))
    garantida = bool(re.search(r"garantida|cheque especial", nome))
    aplicacao = not garantida and bool(re.search(r"aplica|cdb|invest|poupan|fundo|aplic", nome))
    padrao = {
        # cartão de crédito não é conta de caixa (seus pagamentos aparecem como
        # saída da conta bancária que o quita); fica fora por padrão, mas a
        # empresa pode reincluir pela marcação.
        "entra": (not acc.get("isArchived")) and (not acc.get("isVirtual")) and (not cartao),
        "tipo": "garantida" if garantida else "aplicacao" if aplicacao else "corrente",
        "liquidezImediata": True,
        "limite": 0.0,
    }
    propria = marcacoes.get(acc.get("id")) or marcacoes.get(acc.get("name")) or {}
    final = {**padrao, **{k: v for k, v in propria.items() if v is not None}}
    return final


def _soma_no_caixa(m: dict[str, Any]) -> bool:
    return m["tipo"] == "corrente" or (m["tipo"] == "aplicacao" and bool(m["liquidezImediata"]))


def contas_excluidas(contas_raw: list[dict[str, Any]], marcacoes: dict[str, dict[str, Any]]) -> set[int]:
    """Códigos sintéticos das contas que não entram no fluxo (simétrico ao
    contas.py::contas_excluidas do Omie). Só é útil se as bases forem montadas
    à parte — montar_pacote já filtra internamente."""
    excluir: set[int] = set()
    for i, acc in enumerate(contas_raw, start=1):
        if not _marcar_conta(acc, marcacoes)["entra"]:
            excluir.add(i)
    return excluir


def _indice_agendamentos(cli: NiboClient, desde_iso: str) -> dict[str, dict[str, Any]]:
    """{scheduleId -> categoria/vencimento/emissão} dos agendamentos (pagos e
    abertos) com competência a partir de `desde`, para enriquecer as linhas do
    extrato realizado (que não trazem categoria)."""
    idx: dict[str, dict[str, Any]] = {}
    for path in ("schedules/credit", "schedules/debit"):
        for s in cli.listar(path, filtro=f"accrualDate ge {desde_iso}", orderby="accrualDate"):
            sid = s.get("scheduleId")
            if not sid:
                continue
            idx[sid] = {
                "categoria": _texto((s.get("category") or {}).get("name")),
                "vencimento": _dia(s.get("dueDate")),
                "emissao": _dia(s.get("accrualDate")),
            }
    return idx


def _linha_receber_aberto(s: dict[str, Any]) -> dict[str, Any]:
    stk = s.get("stakeholder") or {}
    return {
        "Razão Social": _texto(stk.get("name")),
        "CNPJ/CPF": stk.get("cpfCnpj") or "",
        "Emissão": _dia(s.get("accrualDate")),
        "Vencimento": _dia(s.get("dueDate")),
        "Categoria": _texto((s.get("category") or {}).get("name")),
        "Documento": _texto(s.get("reference") or s.get("description")),
        "Conta Corrente": "",  # agendamento em aberto ainda não tem conta de baixa
        "Valor da Conta": round(float(s.get("value") or 0), 2),
        "Recebido": round(abs(float(s.get("paidValue") or 0)), 2),
        "Valor a Receber Real": round(float(s.get("openValue") or 0), 2),
        # Nibo não tem previsão separada do vencimento; None faz montar_extra cair
        # no Vencimento (pa["prev"]/ra["prev"] = ...fillna(venc)).
        "Previsão": None,
        "codigo_lancamento_omie": s.get("scheduleId"),
    }


def _linha_pagar_aberto(s: dict[str, Any]) -> dict[str, Any]:
    stk = s.get("stakeholder") or {}
    return {
        "Razão Social": _texto(stk.get("name")),
        "CNPJ/CPF": stk.get("cpfCnpj") or "",
        "Emissão": _dia(s.get("accrualDate")),
        "Vencimento": _dia(s.get("dueDate")),
        "Categoria": _texto((s.get("category") or {}).get("name")),
        "Documento": _texto(s.get("reference") or s.get("description")),
        "Conta Corrente": "",
        "Valor da Conta": round(float(s.get("value") or 0), 2),
        "Valor Pago": round(abs(float(s.get("paidValue") or 0)), 2),
        "Previsão": None,
    }


def montar_pacote(
    token: str,
    marcacoes: dict[str, dict[str, Any]],
    *,
    saldo_minimo: float | None = None,
    abertura_em: date | None = None,
    hoje: date | None = None,
    log: Callable[[str], None] = print,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, list[dict[str, Any]]], dict[str, Any]]:
    """Devolve (extrato, contas_raw, bases, manifesto). `ate` é sempre hoje (o
    painel projeta a partir de hoje) e `desde`/abertura = abertura_em."""
    cli = NiboClient(token, log=log)
    hoje = hoje or date.today()
    desde = abertura_em or date(hoje.year - 1, 1, 1)
    hoje_iso = hoje.isoformat()
    inicio_ext = hoje - timedelta(days=DIAS_PASSADOS)
    fim_ext = max(hoje + timedelta(days=DIAS_FUTUROS), _fim_mes_seguinte(hoje))
    iniciado_em = datetime.now().astimezone()

    log("Buscando contas no Nibo...")
    contas_raw = cli.listar("accounts", orderby="name")
    for i, acc in enumerate(contas_raw, start=1):
        acc["_codigo"] = i
        acc["_marc"] = _marcar_conta(acc, marcacoes)

    log("Montando índice de categoria dos agendamentos...")
    idx = _indice_agendamentos(cli, desde.isoformat())

    contas: list[dict[str, Any]] = []
    movimentos: list[dict[str, Any]] = []
    avisos: list[str] = []
    base_rec: list[dict[str, Any]] = []
    base_pag: list[dict[str, Any]] = []
    abertura_total = 0.0
    conta_previsao: int | None = None  # código onde penduramos as previsões futuras

    for acc in contas_raw:
        m = acc["_marc"]
        code = acc["_codigo"]
        nome = (acc.get("name") or str(code)).strip()
        if not m["entra"]:
            log(f"  fora do fluxo: {nome}")
            continue
        soma = _soma_no_caixa(m)
        try:
            linhas = cli.extrato(acc["id"], desde.isoformat(), hoje_iso)
        except NiboTokenExpirado:
            raise
        except NiboError as exc:
            avisos.append(f'Não foi possível ler o extrato de "{nome}": {exc}')
            log(f"  ERRO em {nome}: {exc}")
            continue

        # Saldo = abertura + soma de TODOS os lançamentos (inclui transferências,
        # que movem dinheiro nesta conta). NÃO usar o currentBalance da última
        # linha: o views/statement devolve os lançamentos de um mesmo dia em ordem
        # arbitrária (não a ordem do saldo corrente), então a "última linha" pode
        # trazer um saldo intradiário, não o do fim do período. Achado real
        # 23/10/2026 (Unicred PJ: última linha dava 79.584,96; saldo real 78.458,87).
        abertura: float | None = None
        soma_mov = 0.0
        for e in linhas:
            if e.get("type") == "StartAccountBalance":
                if abertura is None:
                    abertura = float(e.get("currentBalance") or 0)
                continue
            soma_mov += float(e.get("value") or 0)
        saldo = round((abertura or 0.0) + soma_mov, 2) + 0.0  # "+ 0.0" normaliza -0.0 -> 0.0
        if soma and abertura is not None:
            abertura_total += abertura

        for e in linhas:
            if e.get("type") == "StartAccountBalance" or e.get("isTransfer"):
                continue
            data = _dia(e.get("date"))
            if not data or data > hoje_iso:
                continue
            valor = round(float(e.get("value") or 0), 2)
            if valor == 0:
                continue
            sched = idx.get(e.get("scheduleId")) if e.get("scheduleId") else None
            categoria = (sched or {}).get("categoria") or ""
            venc = (sched or {}).get("vencimento") or data
            emis = (sched or {}).get("emissao") or data
            contraparte = _texto(e.get("stakeholderName")) or "Sem identificação"
            doc = _texto(e.get("description")) or (e.get("entryId") or "")
            linha = {
                "Emissão": emis, "Vencimento": venc,
                "Data de Crédito ou Débito (No Extrato)": data,
                "Categoria": categoria, "Documento": doc,
                "Conta Corrente": nome, "Valor da Conta": abs(valor),
            }
            if valor > 0:
                linha["Cliente"] = contraparte
                linha["Recebido"] = abs(valor)
                base_rec.append(linha)
            else:
                linha["Fornecedor"] = contraparte
                linha["Valor Pago"] = abs(valor)
                base_pag.append(linha)
            if data >= inicio_ext.isoformat():
                movimentos.append({
                    "id": f"{code}-{e.get('entryId') or len(movimentos)}-{data}",
                    "data": data, "vencimento": venc if sched else None, "conta": code,
                    "nome": contraparte, "categoria": categoria or "Sem categoria",
                    "documento": doc, "origem": "Nibo",
                    "valor": valor, "realizado": True,
                })

        contas.append({
            "codigo": code, "descricao": nome, "banco": _texto(acc.get("bankName")),
            "entra": True, "tipo": m["tipo"], "liquidezImediata": bool(m["liquidezImediata"]),
            "limite": float(m["limite"] or 0), "saldo": round(saldo, 2), "somaNoCaixa": soma,
            "conciliadoAte": None, "pendentesConciliacao": 0,
        })
        if soma and conta_previsao is None:
            conta_previsao = code
        log(f"  {code} | {nome} | {m['tipo']} | saldo hoje R$ {saldo:,.2f}")

    if not contas:
        avisos.append("Nenhuma conta marcada para o fluxo de caixa.")

    caixa = sum(c["saldo"] for c in contas if c["somaNoCaixa"])
    limite_livre = sum(
        max(0.0, c["limite"] + min(0.0, c["saldo"])) for c in contas if c["tipo"] == "garantida"
    )

    log("Buscando agendamentos em aberto (a receber / a pagar)...")
    abertos_credit = cli.listar("schedules/credit", filtro="isPaid eq false", orderby="dueDate")
    abertos_debit = cli.listar("schedules/debit", filtro="isPaid eq false", orderby="dueDate")
    base_ra = [_linha_receber_aberto(s) for s in abertos_credit]
    base_pa = [_linha_pagar_aberto(s) for s in abertos_debit]

    # Movimentos futuros do extrato (dias "previsto"), sintetizados dos abertos
    # por vencimento — o statement do Nibo não traz previsão nativa.
    if conta_previsao is not None:
        for s, sinal in ([(x, 1) for x in abertos_credit] + [(x, -1) for x in abertos_debit]):
            venc = _dia(s.get("dueDate"))
            if not venc or venc < hoje_iso or venc > fim_ext.isoformat():
                continue  # vencida não é caixa; fora da janela não entra em dias
            aberto_val = float(s.get("openValue") or 0)
            if aberto_val <= 0:
                continue
            movimentos.append({
                "id": f"prev-{s.get('scheduleId')}",
                "data": venc, "vencimento": venc, "conta": conta_previsao,
                "nome": _texto((s.get("stakeholder") or {}).get("name")) or "Sem identificação",
                "categoria": _texto((s.get("category") or {}).get("name")) or "Sem categoria",
                "documento": _texto(s.get("reference") or s.get("description")),
                "origem": "Conta a Receber" if sinal > 0 else "Conta a Pagar",
                "valor": round(sinal * aberto_val, 2), "realizado": False,
            })
    elif base_ra or base_pa:
        avisos.append("Sem conta de caixa marcada — projeção futura do extrato não montada.")

    # A projeção pra frente é só o que o Nibo tem CONFIGURADO: ele materializa
    # recorrências e parcelas como agendamentos em aberto com vencimento futuro
    # (hasRecurrence), que já entraram em base_ra/base_pa e nas previsões do
    # extrato acima. Nada de média/estimativa de histórico — decisão do Rodrigo
    # 22/10: projetar o configurado, não inventar. (Ergomed: despesa recorrente
    # vai até 2028; receita recorrente simplesmente não é configurada no Nibo, e
    # a projeção reflete isso com honestidade em vez de fabricar receita.)

    # ---- dias + progressão de saldo (porte idêntico de caixa/extrato.py) ----
    no_caixa = {c["codigo"] for c in contas if c["somaNoCaixa"]}
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

    datas = [(inicio_ext + timedelta(days=n)).isoformat() for n in range((fim_ext - inicio_ext).days + 1)]
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
    movimentos.sort(key=lambda mv: (mv["data"], -abs(mv["valor"])))

    extrato = {
        "consultadoEm": iniciado_em.isoformat(timespec="seconds"),
        "hoje": hoje_iso, "saldoMinimo": saldo_minimo, "contas": contas, "dias": dias,
        "movimentos": movimentos, "caixaProprio": round(caixa, 2), "limiteLivre": round(limite_livre, 2),
        "aberturaEm": desde.isoformat(), "abertura": round(abertura_total, 2),
        "avisos": avisos,
        "diagnostico": {"fonte": "nibo", "contas": len(contas), "movimentos": len(movimentos)},
    }

    bases = {
        "receber_aberto": base_ra, "pagar_aberto": base_pa,
        "recebimentos": base_rec, "pagamentos": base_pag,
        "contratos_nao_faturados": [], "os_nao_faturadas": [], "status_contratos": [],
    }

    ate_br = hoje.strftime("%d/%m/%Y")
    manifesto = {
        "fonte": "nibo",
        "desde": desde.strftime("%d/%m/%Y"), "ate": ate_br, "ref": hoje_iso,
        "inicio": iniciado_em.isoformat(timespec="seconds"),
        "fim": datetime.now().astimezone().isoformat(timespec="seconds"),
        "arquivos": {nome: {"linhas": len(linhas)} for nome, linhas in bases.items()},
        "estatisticas": {
            "contas": len(contas), "recebimentos": len(base_rec), "pagamentos": len(base_pag),
            "receber_aberto": len(base_ra), "pagar_aberto": len(base_pa),
        },
    }
    return extrato, contas_raw, bases, manifesto
