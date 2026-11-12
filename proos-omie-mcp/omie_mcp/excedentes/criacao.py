"""
Criação das OSs de excedentes no Omie (IncluirOS) — fase 2, SÓ depois da
aprovação do analista no portal.

Regras rígidas (skill, seção "Criação"):
  - cEtapa "50" (coluna FATURAR). FaturarOS NÃO existe neste módulo.
  - Valor do item = "Valor total excedentes" da linha (nQtde 1, nValUnit =
    total) — nunca recalcular pelo unitário.
  - NUNCA preencher cDadosAdicNF nem cDadosAdicItem.
  - AlterarOS não corrige campo já preenchido: tudo precisa estar certo
    AQUI. Por isso qualquer dúvida de campo deve ser resolvida antes, na
    fase de plano/validação.
  - Idempotência: ConsultarOS pelo cCodIntOS ANTES de criar; existir não é
    erro, é "ja_existia". O Omie também recusa cCodIntOS repetido — essa
    recusa é tratada como "ja_existia", não como falha.
  - Lotes de 4 (limite de chamadas simultâneas por app do Omie).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from ..client import OmieAPIError, OmieClient
from .resolucao import FonteOmie, OsExistente

_MODULO_OS = "servicos/os"
TAMANHO_LOTE = 4

_INDICIOS_DUPLICADO = ("já cadastrado", "ja cadastrado", "já existe", "ja existe")


@dataclass(frozen=True)
class ItemOS:
    linha_id: int                  # id em excedentes_linha (auditoria)
    n_cod_servico: int
    valor_total: Decimal           # "Valor total excedentes" da linha
    categoria: str | None          # cCodCategItem


@dataclass
class OsParaCriar:
    c_cod_int_os: str
    n_cod_cli: int
    categoria: str | None          # cCodCateg do cabeçalho (serviço excedente)
    vencimento: date
    previsao: date                 # dDtPrevisao
    email_envio: str | None
    itens: list[ItemOS]
    n_cod_ctr: int | None = None   # OS sem contrato: ambos None (regra 3/8)
    numero_contrato: str | None = None
    n_cod_cc: int | None = None
    cidade_prest: str | None = None

    @property
    def valor_total(self) -> Decimal:
        return sum((i.valor_total for i in self.itens), Decimal(0))


@dataclass
class ResultadoCriacao:
    os: OsParaCriar
    status: str                    # criada | ja_existia | falha
    n_cod_os: int | None = None
    numero_os: str | None = None
    erro: str | None = None


def _data(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def montar_payload(os_: OsParaCriar) -> dict:
    """Payload do IncluirOS — único lugar que monta esse dict."""
    cabecalho: dict = {
        "cCodIntOS": os_.c_cod_int_os,
        "cEtapa": "50",
        "dDtPrevisao": _data(os_.previsao),
        "nCodCli": os_.n_cod_cli,
        "cCodParc": "999",
        "nQtdeParc": 1,
    }
    if os_.n_cod_ctr:
        cabecalho["nCodCtr"] = os_.n_cod_ctr

    informacoes: dict = {}
    if os_.categoria:
        informacoes["cCodCateg"] = os_.categoria
    if os_.n_cod_cc:
        informacoes["nCodCC"] = os_.n_cod_cc
    if os_.cidade_prest:
        informacoes["cCidPrestServ"] = os_.cidade_prest
    if os_.numero_contrato:
        # nCodCtr sozinho não preenche o número do contrato na OS.
        informacoes["cNumContrato"] = os_.numero_contrato

    email: dict = {
        "cEnvBoleto": "S",
        "cEnvLink": "S",
        "cEnvPix": "N",
        "cEnvRecibo": "N",
    }
    if os_.email_envio:
        email["cEnviarPara"] = os_.email_envio

    servicos = []
    for seq, item in enumerate(os_.itens, start=1):
        servico: dict = {
            "nSeqItem": seq,
            "nCodServico": item.n_cod_servico,
            "nQtde": 1,
            "nValUnit": float(item.valor_total),
        }
        if item.categoria:
            servico["cCodCategItem"] = item.categoria
        servicos.append(servico)

    return {
        "Cabecalho": cabecalho,
        "Email": email,
        "InformacoesAdicionais": informacoes,
        "Parcelas": [{
            "nParcela": 1,
            "dDtVenc": _data(os_.vencimento),
            "nPercent": 100,
        }],
        "ServicosPrestados": servicos,
    }


def _eh_duplicado(erro: OmieAPIError) -> bool:
    mensagem = str(erro).lower()
    return "ccodintos" in mensagem or any(i in mensagem for i in _INDICIOS_DUPLICADO)


async def _criar_uma(client: OmieClient, fonte: FonteOmie,
                     os_: OsParaCriar) -> ResultadoCriacao:
    existente: OsExistente | None = await fonte.os_existente(os_.c_cod_int_os)
    if existente is not None:
        return ResultadoCriacao(os_, "ja_existia",
                                existente.n_cod_os, existente.numero)
    try:
        resposta = await client.call(_MODULO_OS, "IncluirOS", montar_payload(os_))
    except OmieAPIError as erro:
        if _eh_duplicado(erro):
            achada = await fonte.os_existente(os_.c_cod_int_os)
            return ResultadoCriacao(
                os_, "ja_existia",
                achada.n_cod_os if achada else None,
                achada.numero if achada else None)
        return ResultadoCriacao(os_, "falha", erro=str(erro)[:2000])
    cab = resposta.get("Cabecalho") or {}
    n_cod_os = resposta.get("nCodOS") or cab.get("nCodOS")
    numero = resposta.get("cNumOS") or cab.get("cNumOS")
    return ResultadoCriacao(
        os_, "criada",
        int(n_cod_os) if n_cod_os else None,
        str(numero) if numero else None)


async def criar(client: OmieClient, fonte: FonteOmie, oss: list[OsParaCriar],
                log=print, maximo: int | None = None) -> list[ResultadoCriacao]:
    """Cria as OSs em lotes de 4. `maximo` limita a rodada (OS piloto = 1)."""
    pendentes = oss[:maximo] if maximo else oss
    resultados: list[ResultadoCriacao] = []
    for inicio in range(0, len(pendentes), TAMANHO_LOTE):
        lote = pendentes[inicio:inicio + TAMANHO_LOTE]
        resultados.extend(await asyncio.gather(
            *(_criar_uma(client, fonte, os_) for os_ in lote)))
        feitas = len(resultados)
        log(f"   lote {inicio // TAMANHO_LOTE + 1}: {feitas}/{len(pendentes)} processadas")
    return resultados
