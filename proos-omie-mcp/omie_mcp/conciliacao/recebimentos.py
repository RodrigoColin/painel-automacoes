"""Busca, no Omie, os titulos que JA foram recebidos/baixados no periodo
(CR liquidado) — insumo dos passos CONCILIAR_RECEBIDO do motor:

  - casar PIX QR sem contraparte no extrato com o recebimento que ja existe
    (recupera quem o banco escondeu);
  - decompor credito consolidado de boleto no conjunto de boletos de um dia.

Fonte: `financas/mf:ListarMovimentos` (cNatureza=R, nValPago>0). O nome do
parceiro NAO vem no movimento (so o CPF/CNPJ) — cruzamos com `ListarClientes`.

GOTCHA confirmado (jul/26): o mf devolve CADA titulo DUAS vezes — deduplica-se
por `nCodTitulo`. So entao a soma de um dia (usada na decomposicao de boleto)
fica correta.

Best-effort: se faltar credencial ou a Omie falhar, devolve [] (os passos
CONCILIAR_RECEBIDO simplesmente nao rodam; o resto da conciliacao segue).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable, Optional, Sequence, Union

from .modelos import RecebimentoOmie

# quantos dias ANTES do periodo do extrato ainda buscar recebimentos: o banco
# credita boleto/PIX com defasagem de compensacao (ver Config.dias_credito_boleto
# e dias_recebimento_credito); um credito no inicio do extrato pode casar com um
# recebimento liquidado alguns dias antes.
_MARGEM_DIAS = 10


def _so_digitos(texto: Optional[str]) -> str:
    return "".join(c for c in (texto or "") if c.isdigit())


def _data_iso(bruto: Optional[str]) -> Optional[date]:
    if not bruto:
        return None
    try:
        return datetime.strptime(str(bruto).strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


async def buscar_recebimentos(
    cliente_slug: str,
    contas_omie: Union[str, Iterable[str], None],
    desde: date,
    ate: date,
) -> list[RecebimentoOmie]:
    """Devolve os recebimentos (CR liquidados) do periodo [desde-margem, ate],
    deduplicados por titulo, com nome do parceiro resolvido via cadastro.

    `contas_omie` nao filtra a busca (um PIX pode ter sido recebido noutra
    conta Omie que nao a do extrato) — a conta vem preenchida em cada
    RecebimentoOmie (`conta_corrente_id`) e quem decide usa conforme o passo
    (a decomposicao de boleto exige mesma conta; o casamento de PIX nao).
    """
    from ..client import OmieClient
    from ..clients import ClientesConfigError, ClientesRegistry
    from ..tools import clientes as tools_clientes

    try:
        registry = ClientesRegistry.load()
        slug = registry.resolver_slug(cliente_slug)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"\nAVISO: nao deu pra buscar recebimentos na Omie ({exc}). "
              "Passos de PIX/decomposicao de boleto nao rodam nesta rodada.")
        return []

    d0 = (desde - timedelta(days=_MARGEM_DIAS)).strftime("%d/%m/%Y")
    d1 = ate.strftime("%d/%m/%Y")

    try:
        async with OmieClient(settings) as client:
            # cadastro -> doc/codigo => nome
            cadastro = await tools_clientes.listar_clientes(client)
            nome_por_doc: dict[str, str] = {}
            nome_por_codigo: dict[int, str] = {}
            for c in cadastro:
                nome = c.get("razao_social") or c.get("nome_fantasia") or ""
                doc = _so_digitos(c.get("cnpj_cpf"))
                if doc:
                    nome_por_doc.setdefault(doc, nome)
                cod = c.get("codigo_cliente_omie")
                if cod is not None:
                    nome_por_codigo[cod] = nome

            vistos: set = set()
            recebimentos: list[RecebimentoOmie] = []
            pagina = 1
            while True:
                resp = await client.call(
                    "financas/mf", "ListarMovimentos",
                    {"nPagina": pagina, "nRegPorPagina": 500,
                     "dDtPagtoDe": d0, "dDtPagtoAte": d1},
                )
                for mov in resp.get("movimentos", []):
                    det = mov.get("detalhes", {})
                    res = mov.get("resumo", {})
                    if det.get("cNatureza") != "R":
                        continue
                    pago = float(res.get("nValPago") or 0)
                    if pago <= 0:
                        continue
                    titulo_id = det.get("nCodTitulo")
                    if titulo_id in vistos:  # mf devolve cada titulo 2x
                        continue
                    vistos.add(titulo_id)
                    data_rec = _data_iso(det.get("dDtPagamento"))
                    if data_rec is None:
                        continue
                    doc = _so_digitos(det.get("cCPFCNPJCliente"))
                    nome = (
                        nome_por_doc.get(doc)
                        or nome_por_codigo.get(det.get("nCodCliente"))
                        or ""
                    )
                    recebimentos.append(RecebimentoOmie(
                        id=str(titulo_id),
                        valor=Decimal(str(pago)),
                        data=data_rec,
                        parceiro_nome=nome,
                        parceiro_documento=det.get("cCPFCNPJCliente"),
                        tipo_documento=det.get("cTipo"),
                        conta_corrente_id=(
                            str(det.get("nCodCC")) if det.get("nCodCC") is not None else None
                        ),
                    ))
                if pagina >= int(resp.get("nTotPaginas", 1) or 1):
                    break
                pagina += 1
    except Exception as exc:  # noqa: BLE001 — best-effort, nunca derruba a rodada
        print(f"\nAVISO: nao deu pra buscar recebimentos na Omie ({exc}). "
              "Passos de PIX/decomposicao de boleto nao rodam nesta rodada.")
        return []

    if recebimentos:
        bol = sum(1 for r in recebimentos if (r.tipo_documento or "").upper() == "BOL")
        print(f"\n{len(recebimentos)} recebimento(s) ja baixado(s) no Omie no periodo "
              f"({bol} boleto(s)) — insumo p/ casar PIX e decompor boleto.")
    return recebimentos
