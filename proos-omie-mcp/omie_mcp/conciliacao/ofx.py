"""Leitor de OFX -> LinhaExtrato.

Sem dependencia externa: OFX brasileiro e SGML (tags nao fechadas), entao um
parser de XML padrao nao serve. Trata OFX 1.x (SGML, cabecalho key:value) e
OFX 2.x (XML de verdade).

Deduplicacao: FITID e o identificador da transacao no proprio banco — e o que
impede a mesma linha entrar duas vezes quando o operador sobe o arquivo de novo
ou quando a captura automatica passar a existir.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterator, Optional

from .modelos import LinhaExtrato, Natureza

_TAG = re.compile(r"<([A-Z0-9./_]+)>([^<\r\n]*)", re.IGNORECASE)

# Pseudo-transacoes de saldo embutidas pelo banco dentro da lista de
# STMTTRN — NAO sao movimento de dinheiro, sao um "retrato" do saldo do dia
# (TRNAMT = o proprio saldo, nao um valor movimentado). Achado real (Proos,
# extrato Itau, 2026-09-21): 31 ocorrencias de "SALDO TOTAL DISPONIVEL DIA"
# (uma por dia util) + 1 "SALDO ANTERIOR" no MESMO arquivo que tinha
# transacoes de verdade — sem filtro, essas 32 linhas (quase 1/4 do
# arquivo) entravam no motor como se fossem pagamentos/recebimentos reais,
# corrompendo qualquer comparacao de saldo dia-a-dia banco x Omie.
#
# Match por REGEX, nao string exata — o mesmo arquivo real tinha o "Í" de
# "DISPONÍVEL" salvo como DOIS bytes corrompidos (U+FFFD + 0x8D — nem letra
# acentuada nem ASCII valido depois da normalizacao, e nem um unico
# caractere); ".+" (um ou mais, nao so um) no lugar da letra acentuada
# cobre isso sem precisar mapear os bytes exatos. Padrao ANCORADO (^...$)
# de proposito — "PAGTO A VISTA SALDO DEV" (achado real no extrato da
# Startlaw) e uma transacao de verdade que so cita "saldo" no meio do
# texto; um filtro por substring apagaria ela por engano.
_PADROES_PSEUDO_SALDO = [
    re.compile(r"^SALDO ANTERIOR$"),
    re.compile(r"^SALDO TOTAL DISPON.+VEL DIA$"),
    re.compile(r"^SALDO DISPON.+VEL DIA$"),
]


def _normalizar_memo(texto: str) -> str:
    mapa = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ",
                          "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC")
    return " ".join(texto.translate(mapa).upper().split())


def _eh_pseudo_saldo(memo: str) -> bool:
    normalizado = _normalizar_memo(memo)
    return any(p.match(normalizado) for p in _PADROES_PSEUDO_SALDO)


def ler_arquivo(
    caminho: str | Path,
    conta_id: str,
    banco: Optional[str] = None,
    encoding: str = "latin-1",
) -> list[LinhaExtrato]:
    """Le um .ofx do disco e devolve as linhas normalizadas."""
    texto = Path(caminho).read_text(encoding=encoding, errors="replace")
    return ler_texto(texto, conta_id=conta_id, banco=banco)


def ler_texto(
    texto: str, conta_id: str, banco: Optional[str] = None
) -> list[LinhaExtrato]:
    banco = banco or _detectar_banco(texto)
    linhas: list[LinhaExtrato] = []
    vistos: set[str] = set()
    ids_usados: dict[str, int] = {}

    for bloco in _blocos_transacao(texto):
        campos = _campos(bloco)

        if _eh_pseudo_saldo(campos.get("MEMO") or ""):
            continue

        valor_bruto = campos.get("TRNAMT")
        if valor_bruto is None:
            continue
        try:
            valor = Decimal(valor_bruto.replace(",", "."))
        except InvalidOperation:
            continue

        data_mov = _data(campos.get("DTPOSTED") or campos.get("DTAVAIL"))
        if data_mov is None:
            continue

        fitid = (campos.get("FITID") or "").strip()
        if not fitid:
            fitid = f"{conta_id}-{data_mov.isoformat()}-{valor}-{len(linhas)}"
        # alguns bancos repetem FITID em transacoes distintas (Bradesco):
        # a chave de dedup e FITID + data + valor, nao so FITID
        chave = f"{fitid}|{data_mov.isoformat()}|{valor}"
        if chave in vistos:
            continue
        vistos.add(chave)
        if fitid in ids_usados:
            fitid = f"{fitid}#{ids_usados[fitid]}"
            ids_usados[fitid.split('#')[0]] += 1
        else:
            ids_usados[fitid] = 1

        descricao = " ".join(
            parte.strip()
            for parte in (campos.get("MEMO"), campos.get("NAME"))
            if parte and parte.strip()
        ) or campos.get("TRNTYPE", "")

        linhas.append(
            LinhaExtrato(
                id=fitid,
                conta_id=conta_id,
                data=data_mov,
                valor=abs(valor),
                natureza=Natureza.CREDITO if valor >= 0 else Natureza.DEBITO,
                descricao=descricao.strip(),
                contraparte_nome=(campos.get("NAME") or "").strip() or None,
                contraparte_documento=_documento(campos),
                banco=banco,
                fonte="ofx",
            )
        )

    linhas.sort(key=lambda l: (l.data, l.id))
    return linhas


def renumerar_para_lote_multiconta(linhas: list[LinhaExtrato]) -> list[LinhaExtrato]:
    """Garante `id` globalmente unico quando o lote combina 2+ contas.

    Achado real (Acordo Fechado, 2026-09-21): o Itau numera FITID como
    "AAAAMMDD" + sequencial DENTRO DO DIA, reiniciando do zero em CADA
    conta — duas contas Itau da MESMA empresa (ex.: conta corrente e conta
    garantida) colidem no mesmo id ("20260806001" nas duas). Isso corrompe
    qualquer logica que trata `linha.id` como globalmente unico dentro de um
    lote (pares de transferencia em motor.py, idempotencia de gravacao em
    escrita_omie.py) quando o lote junta mais de uma conta — linhas
    completamente diferentes eram tratadas como a mesma linha.

    So reescreve o id (prefixando com `conta_id`) quando ha 2+ contas
    distintas no lote — uso single-conta (o caso comum, ja validado ao vivo
    em producao) mantem o FITID original intacto, sem prefixo.
    """
    contas = {l.conta_id for l in linhas}
    if len(contas) < 2:
        return linhas
    from dataclasses import replace
    return [replace(l, id=f"{l.conta_id}:{l.id}") for l in linhas]


def saldo_final(texto: str) -> Optional[tuple[date, Decimal]]:
    """Le <LEDGERBAL> — o saldo que precisa bater com o ERP no fechamento."""
    trecho = re.search(r"<LEDGERBAL>(.*?)(?:</LEDGERBAL>|<AVAILBAL>|$)", texto, re.S | re.I)
    if not trecho:
        return None
    campos = _campos(trecho.group(1))
    try:
        valor = Decimal((campos.get("BALAMT") or "").replace(",", "."))
    except InvalidOperation:
        return None
    data_saldo = _data(campos.get("DTASOF"))
    if data_saldo is None:
        return None
    return data_saldo, valor


def movimento_por_dia(texto: str, conta_id: str = "c") -> dict[date, Decimal]:
    """Soma assinada (entrou - saiu) de CADA dia, sem acumular.

    Diferente de `saldo_por_dia()`: isso e a variacao do PROPRIO dia, nao o
    saldo de fechamento — pedido do usuario (2026-09-21) pra separar "esse
    dia especifico teve problema" de "o problema ja vinha acumulado de um
    dia anterior". Um dia sem nenhuma transacao real simplesmente nao vira
    chave neste dict (nao e zero — e ausencia de dado, mesma convencao do
    resto do modulo).
    """
    linhas = ler_texto(texto, conta_id=conta_id)
    por_dia: dict[date, Decimal] = {}
    for l in linhas:
        por_dia[l.data] = por_dia.get(l.data, Decimal("0")) + l.valor_com_sinal
    return por_dia


def saldo_por_dia(texto: str, conta_id: str = "c") -> dict[date, Decimal]:
    """Saldo do banco no FECHAMENTO de cada dia com transacao no arquivo.

    Reconstroi de tras pra frente a partir de `saldo_final()` (LEDGERBAL) —
    o OFX so garante o saldo final, nao um saldo por dia explicito, entao
    cada dia anterior e o saldo final menos a soma (com sinal) de tudo que
    aconteceu DEPOIS dele. Usa `ler_texto()` (mesmo parser do motor), entao
    ja herda o filtro de pseudo-transacao de saldo (`_eh_pseudo_saldo`) —
    sem isso, o calculo ficaria errado por contar o "retrato" do saldo do
    dia como se fosse dinheiro se movendo (achado real: Proos, 2026-09-21).

    `conta_id` e so um rotulo interno pro parser — nao importa pra este
    calculo, que e por arquivo (uma conta por vez).
    """
    saldo_e_data = saldo_final(texto)
    if saldo_e_data is None:
        return {}
    data_final, valor_final = saldo_e_data

    por_dia = movimento_por_dia(texto, conta_id=conta_id)
    if not por_dia:
        return {data_final: valor_final}

    # do dia mais recente pro mais antigo: o saldo no fim de um dia e o
    # saldo final menos tudo que aconteceu nos dias SEGUINTES a ele — por
    # isso comeca do fim (`valor_final`) e vai descontando dia a dia.
    resultado: dict[date, Decimal] = {}
    acumulado = valor_final
    for d in sorted(por_dia, reverse=True):
        resultado[d] = acumulado
        acumulado -= por_dia[d]
    resultado.setdefault(data_final, valor_final)
    return resultado


# --------------------------------------------------------------------------

def _blocos_transacao(texto: str) -> Iterator[str]:
    for m in re.finditer(
        r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>))", texto, re.S | re.I
    ):
        yield m.group(1)


def _campos(bloco: str) -> dict[str, str]:
    campos: dict[str, str] = {}
    for tag, valor in _TAG.findall(bloco):
        tag = tag.upper().lstrip("/")
        valor = valor.strip()
        if valor and tag not in campos:
            campos[tag] = valor
    return campos


def _data(bruto: Optional[str]) -> Optional[date]:
    if not bruto:
        return None
    digitos = re.sub(r"[^0-9]", "", bruto)[:8]
    if len(digitos) < 8:
        return None
    try:
        return datetime.strptime(digitos, "%Y%m%d").date()
    except ValueError:
        return None


_PADRAO_DOCUMENTO = re.compile(
    r"\b(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b"
)


def _documento(campos: dict[str, str]) -> Optional[str]:
    """CNPJ/CPF da contraparte, quando o banco escreve na descricao.

    MEMO/NAME primeiro: e onde aparece como texto livre em extrato brasileiro
    (ex.: "PIX ENVIADO W&R 49.165.796/0001-21"). CHECKNUM/REFNUM/PAYEEID sao
    numero de controle do banco, nao documento — e o formato do Itau
    (CHECKNUM = data + sequencial, sempre 11 digitos) colidia direto com o
    padrao de CPF sem pontuacao, roubando a evidencia de CNPJ de praticamente
    toda linha antes mesmo de olhar o MEMO (confirmado ao vivo contra o
    extrato da Oystr em 2026-09-20 — zerava o score de CNPJ do motor em
    massa). Por isso so entram como ultimo recurso, e exigindo pontuacao.
    """
    for chave in ("MEMO", "NAME"):
        valor = campos.get(chave)
        if not valor:
            continue
        m = _PADRAO_DOCUMENTO.search(valor)
        if m:
            return m.group(1)
    for chave in ("CHECKNUM", "REFNUM", "PAYEEID"):
        valor = campos.get(chave)
        if not valor:
            continue
        m = _PADRAO_DOCUMENTO.search(valor)
        if m and any(c in m.group(1) for c in ".-/"):
            return m.group(1)
    return None


def _detectar_banco(texto: str) -> Optional[str]:
    m = re.search(r"<BANKID>\s*(\d+)", texto, re.I)
    if not m:
        m = re.search(r"<ORG>\s*([^\r\n<]+)", texto, re.I)
        if m:
            nome = m.group(1).strip().lower()
            for chave in ("itau", "inter", "santander", "btg", "sicredi", "bradesco"):
                if chave in nome:
                    return chave
        return None

    codigos = {
        "341": "itau", "077": "inter", "033": "santander",
        "208": "btg", "748": "sicredi", "237": "bradesco",
        "001": "bb", "104": "caixa", "260": "nubank",
    }
    # BANKID vem com 3 OU 4 digitos dependendo do banco/exportacao (achado
    # real: extrato Itau da Proos usa "<BANKID>0341", nao "341" — um
    # `.zfill(3)` sozinho nao ajuda porque a string ja tem 4 caracteres;
    # precisa tirar o zero a esquerda antes de comparar com o dicionario).
    return codigos.get(str(int(m.group(1))).zfill(3))


def identificar_conta_bancaria(texto: str) -> tuple[Optional[str], Optional[str]]:
    """Extrai (BANKID, ACCTID) do bloco BANKACCTFROM do OFX — o codigo do
    banco e o numero da conta NO FORMATO DO BANCO (agencia+conta,
    concatenados ou nao, varia por banco/exportacao).

    Usado pra resolver automaticamente qual conta corrente do Omie
    corresponde a esse extrato (ver omie_mcp.conciliacao.conta_bancaria),
    sem o operador precisar saber o nCodCC (codigo interno do Omie) de cor
    — achado real, 2026-09-22: exigir isso na tela travava quem nao tinha
    esse numero decorado.
    """
    bankid = None
    m = re.search(r"<BANKID>\s*(\d+)", texto, re.I)
    if m:
        bankid = m.group(1)

    acctid = None
    m = re.search(r"<ACCTID>\s*([\w.\-]+)", texto, re.I)
    if m:
        acctid = m.group(1).strip()

    return bankid, acctid
