"""
Consultas ao Omie para montar o plano de excedentes — SÓ LEITURA.

Concentra aqui toda a extração de campos das respostas do Omie, porque a
documentação pública desses endpoints é escassa: se um nome de campo
estiver diferente do esperado, é NESTE arquivo que se corrige (os demais
módulos trabalham com os dataclasses abaixo).

Aprendizados herdados do repo (ver reports/oystr_diagnostico.py):
  - contrato: cabecalho.cCodSit '10' = Ativo; vencTextos.nDiaFixo com
    fallback cabecalho.nDiaFat; cPostergarVenc/cAntecipaVenc movem o
    vencimento de dia não útil.
  - ListarContratos devolve emailCliente EM BRANCO: o e-mail de envio só
    vem na consulta individual (ConsultarContrato, ~8 KB por contrato).
  - html.unescape em nomes vindos do Omie.
"""

from __future__ import annotations

import html
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from ..client import OmieAPIError, OmieClient, OmieNotFoundError
from .vencimento import RegraContrato

_MODULO_CLIENTES = "geral/clientes"
_MODULO_CONTRATO = "servicos/contrato"
_MODULO_OS = "servicos/os"


def _int(v: Any) -> int | None:
    try:
        n = int(float(v))
        return n or None
    except (TypeError, ValueError):
        return None


def _dec(v: Any) -> Decimal | None:
    try:
        return Decimal(str(v))
    except Exception:
        return None


def _primeiro(d: dict, *chaves: str, default: Any = None) -> Any:
    for chave in chaves:
        if chave in d and d[chave] not in (None, ""):
            return d[chave]
    return default


@dataclass(frozen=True)
class ItemContrato:
    n_cod_servico: int | None
    valor_total: Decimal | None
    cod_item: int | None = None     # codItem — referência p/ alterar/excluir


@dataclass
class ContratoResumo:
    """O que precisamos de cada contrato vindo do ListarContratos."""
    n_cod_ctr: int
    numero: str                     # cNumCtr (número humano, ex. "6")
    n_cod_cli: int | None
    situacao: str                   # cCodSit ('10' = ativo)
    n_dia_fat: int = 0              # cabecalho.nDiaFat — 2 = fatura no contrato
    itens: list[ItemContrato] = field(default_factory=list)
    regra_venc: RegraContrato = RegraContrato()

    @property
    def ativo(self) -> bool:
        return self.situacao == "10"

    @property
    def fatura_no_contrato(self) -> bool:
        # Regra Oystr (Rodrigo 2026-11-13): dia de faturamento 2 = o excedente
        # entra no próprio contrato recorrente, não numa OS.
        return self.n_dia_fat == 2

    def item_de_servico(self, n_cod_servico: int) -> ItemContrato | None:
        for i in self.itens:
            if i.n_cod_servico == n_cod_servico:
                return i
        return None


@dataclass(frozen=True)
class DetalheContrato:
    email_envio: str                # emailCliente.cUtilizarEmails
    categoria: str | None           # infAdic/cabecalho cCodCateg, se houver
    n_cod_cc: int | None
    cidade_prest: str | None        # cCidPrestServ
    regra_venc: RegraContrato
    numero: str


@dataclass(frozen=True)
class DetalheCliente:
    email: str
    cidade: str | None
    estado: str | None


@dataclass(frozen=True)
class OsExistente:
    n_cod_os: int | None
    numero: str | None
    etapa: str | None


def _regra_venc(cab: dict, venc: dict) -> RegraContrato:
    return RegraContrato(
        dia_fixo=_int(venc.get("nDiaFixo")) or 0,
        dias_apos=_int(venc.get("nDias")) or 0,
        dia_faturamento=_int(cab.get("nDiaFat")) or 0,
        postergar=str(_primeiro(venc, "cPostergarVenc", "cPostergar", default="S")) == "S",
        antecipar=str(_primeiro(venc, "cAntecipaVenc", "cAntecipar", default="N")) == "S",
        proximo_mes=str(_primeiro(venc, "cProxMes", default="N")) == "S",
    )


def _montar_resumo(contrato: dict) -> ContratoResumo | None:
    cab = contrato.get("cabecalho") or {}
    n_cod_ctr = _int(cab.get("nCodCtr"))
    if not n_cod_ctr:
        return None
    itens = []
    for item in contrato.get("itensContrato") or []:
        icab = item.get("itemCabecalho") or item
        itens.append(ItemContrato(
            n_cod_servico=_int(_primeiro(icab, "codServico", "nCodServico", "codServ")),
            valor_total=_dec(_primeiro(icab, "valorUnit", "valorTotal", "valorTot", "nValTotal")),
            cod_item=_int(icab.get("codItem")),
        ))
    return ContratoResumo(
        n_cod_ctr=n_cod_ctr,
        numero=str(cab.get("cNumCtr") or "").strip(),
        n_cod_cli=_int(cab.get("nCodCli")),
        situacao=str(cab.get("cCodSit") or ""),
        n_dia_fat=_int(cab.get("nDiaFat")) or 0,
        itens=itens,
        regra_venc=_regra_venc(cab, contrato.get("vencTextos") or {}),
    )


class FonteOmie:
    """Consultas com cache por lote — nenhuma escrita acontece aqui."""

    def __init__(self, client: OmieClient):
        self._client = client
        self._contratos: list[ContratoResumo] | None = None
        self._clientes_por_cnpj: dict[str, int | None] = {}

    async def cliente_por_cnpj(self, cnpj_digitos: str) -> int | None:
        """nCodCli pelo CNPJ (ListarClientesResumido, filtro cnpj_cpf)."""
        if cnpj_digitos in self._clientes_por_cnpj:
            return self._clientes_por_cnpj[cnpj_digitos]
        registros = await self._client.call_paginated(
            _MODULO_CLIENTES, "ListarClientesResumido",
            params={"clientesFiltro": {"cnpj_cpf": cnpj_digitos}},
            records_key=["clientes_cadastro_resumido", "cadastros"],
        )
        n_cod = None
        if registros:
            n_cod = _int(_primeiro(registros[0], "codigo_cliente", "nCodCli", "codigo_cliente_omie"))
        self._clientes_por_cnpj[cnpj_digitos] = n_cod
        return n_cod

    async def contratos(self) -> list[ContratoResumo]:
        """Todos os contratos (uma busca por lote, depois só memória)."""
        if self._contratos is None:
            brutos = await self._client.call_paginated(
                _MODULO_CONTRATO, "ListarContratos",
                params={},
                records_key=["contratoCadastro", "cadastros", "listaContratosCadastro"],
            )
            self._contratos = [
                r for r in (_montar_resumo(c) for c in brutos) if r is not None
            ]
        return self._contratos

    async def contratos_ativos_do_cliente(self, n_cod_cli: int) -> list[ContratoResumo]:
        return [c for c in await self.contratos()
                if c.ativo and c.n_cod_cli == n_cod_cli]

    async def contratos_do_cliente(self, n_cod_cli: int) -> list[ContratoResumo]:
        """Todos os contratos do cliente, em QUALQUER situação — usado na
        checagem de idempotência (um contrato pode ter sido cancelado depois
        de a OS do mês já ter sido criada)."""
        return [c for c in await self.contratos() if c.n_cod_cli == n_cod_cli]

    async def consultar_contrato(self, n_cod_ctr: int) -> DetalheContrato:
        """Consulta individual — única fonte confiável do e-mail de envio."""
        resposta = await self._client.call(
            _MODULO_CONTRATO, "ConsultarContrato",
            {"contratoChave": {"nCodCtr": n_cod_ctr}},
        )
        contrato = resposta.get("contratoCadastro") or resposta
        cab = contrato.get("cabecalho") or {}
        inf = contrato.get("infAdic") or {}
        email_bloco = contrato.get("emailCliente") or {}
        return DetalheContrato(
            email_envio=str(email_bloco.get("cUtilizarEmails") or "").strip(),
            categoria=_primeiro(inf, "cCodCateg", default=_primeiro(cab, "cCodCateg")),
            n_cod_cc=_int(_primeiro(inf, "nCodCC", "nCodCc")),
            cidade_prest=_primeiro(inf, "cCidPrestServ"),
            regra_venc=_regra_venc(cab, contrato.get("vencTextos") or {}),
            numero=str(cab.get("cNumCtr") or "").strip(),
        )

    async def consultar_cliente(self, n_cod_cli: int) -> DetalheCliente:
        registro = await self._client.call(
            _MODULO_CLIENTES, "ConsultarCliente",
            {"codigo_cliente_omie": n_cod_cli},
        )
        return DetalheCliente(
            email=str(registro.get("email") or "").strip(),
            cidade=registro.get("cidade"),
            estado=registro.get("estado"),
        )

    async def os_existente(self, c_cod_int_os: str) -> OsExistente | None:
        """ConsultarOS pelo código de integração — idempotência.

        Nota (suporte Omie 2026-11-13): consultar o MESMO cCodIntOS mais de uma
        vez em 60s é bloqueado. Numa rodada mensal normal cada id é consultado
        uma vez só, então está ok; o risco é reprocessar a mesma planilha em
        segundos. Otimização futura (quando der para validar o filtro ao vivo):
        trocar por um único ListarOS do período e casar por cCodIntOS local."""
        try:
            resposta = await self._client.call(
                _MODULO_OS, "ConsultarOS", {"cCodIntOS": c_cod_int_os},
            )
        except OmieNotFoundError:
            return None
        except OmieAPIError as erro:
            # O ConsultarOS devolve "OS não cadastrada para o Código de
            # Integração [...]" com um faultcode que o cliente não mapeia
            # como not-found (achado real 2026-11-12).
            if "cadastrada" in str(erro).lower():
                return None
            raise
        cab = resposta.get("Cabecalho") or resposta.get("cabecalho") or {}
        return OsExistente(
            n_cod_os=_int(cab.get("nCodOS")),
            numero=str(cab.get("cNumOS") or "").strip() or None,
            etapa=str(cab.get("cEtapa") or "").strip() or None,
        )


def nome_limpo(nome: str) -> str:
    return html.unescape(nome or "").strip()
