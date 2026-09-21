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
    return codigos.get(m.group(1).zfill(3))
