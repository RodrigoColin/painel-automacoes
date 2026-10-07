"""
Uma rodada do fluxo de caixa para uma empresa.

    extrato (ListarExtrato)  ─┐
    bases (títulos, lanç. CC) ─┼─► montar_extra ─► caixa_pacote_diario
    fluxo_caixa_config        ─┘

As bases vão de 1º de janeiro do ano anterior até hoje; o extrato cobre 7
dias para trás e 45 para a frente, mais o saldo de abertura do histórico.

Uso manual (na VPS: `docker compose run --rm caixa python -m caixa.rodada ...`):

    python -m caixa.rodada --empresa-id <uuid> [--saida pasta] [--nao-gravar]

`--saida` grava também os JSON (extrato, extra, bases) numa pasta, para
conferir; `--nao-gravar` não toca em caixa_pacote_diario.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any, Callable

from omie_mcp import db, infisical
from omie_mcp.config import OmieSettings

from . import contas as regras_contas
from . import sombra as conferencia_sombra
from .bases import exportar_bases
from .extra import montar_extra
from .extrato import extrair_extrato


@dataclass
class ConfigEmpresa:
    saldo_minimo: float | None = None
    contas: dict[str, dict[str, Any]] = field(default_factory=dict)
    historico_fixo: list[dict[str, Any]] | None = None
    linhas_receita: list[dict[str, Any]] = field(default_factory=list)


def carregar_config(conn, empresa_id: str) -> ConfigEmpresa:
    with conn.cursor() as cur:
        cur.execute(
            """
            select saldo_minimo, contas, historico_fixo, linhas_receita
            from public.fluxo_caixa_config where empresa_id = %s
            """,
            (empresa_id,),
        )
        linha = cur.fetchone()
    if linha is None:
        return ConfigEmpresa()
    saldo_minimo, contas, historico_fixo, linhas_receita = linha
    return ConfigEmpresa(
        saldo_minimo=float(saldo_minimo) if saldo_minimo is not None else None,
        contas=contas or {},
        historico_fixo=historico_fixo or None,
        linhas_receita=linhas_receita or [],
    )


def executar(
    conn,
    empresa_id: str,
    *,
    etapa: Callable[[str], None] = lambda _: None,
    log: Callable[[str], None] = print,
    gravar: bool = True,
    saida: Path | None = None,
) -> list[str]:
    """Roda o pipeline inteiro e devolve os avisos da rodada."""
    config = carregar_config(conn, empresa_id)
    chave, segredo = infisical.buscar_credenciais_omie(empresa_id)
    hoje = date.today()
    abertura_em = date(hoje.year - 1, 1, 1)

    etapa("extrato")
    log("== Extrato e previsão diária ==")
    extrato, contas_omie = extrair_extrato(
        chave, segredo, config.contas,
        saldo_minimo=config.saldo_minimo, abertura_em=abertura_em, hoje=hoje, log=log,
    )
    excluir = regras_contas.contas_excluidas(contas_omie, config.contas)

    etapa("bases")
    log("== Bases de títulos do Omie ==")
    bases, manifesto = asyncio.run(exportar_bases(
        OmieSettings.for_cliente(chave, segredo),
        abertura_em.strftime("%d/%m/%Y"), hoje.strftime("%d/%m/%Y"), excluir,
    ))

    etapa("agregados")
    log("== Agregados ==")
    extra = montar_extra(
        bases, extrato, hoje.isoformat(),
        historico_fixo=config.historico_fixo, linhas_receita=config.linhas_receita,
    )

    avisos = list(extrato.get("avisos") or [])
    if extrato.get("hoje") != manifesto.get("ref"):
        avisos.append(f"Extrato de {extrato.get('hoje')} e bases de {manifesto.get('ref')}: datas diferentes.")

    etapa("sombra")
    log("== Conferência sombra (ListarMovimentos, meses fechados) ==")
    try:
        resultado_sombra = asyncio.run(conferencia_sombra.conferir(
            OmieSettings.for_cliente(chave, segredo), bases, excluir, hoje,
        ))
    except Exception as exc:  # a sombra nunca derruba a rodada
        resultado_sombra = {"status": "erro", "erro": str(exc)}
    log(f"sombra: {resultado_sombra.get('status')}"
        + (f" ({resultado_sombra.get('erro')})" if resultado_sombra.get("status") == "erro" else ""))
    if resultado_sombra.get("status") == "divergente":
        detalhe = "; ".join(
            f"{l['mes']}: ent {l['difEnt']:+,.2f} / sai {l['difSai']:+,.2f}"
            for l in resultado_sombra.get("meses") or []
            if abs(l["difEnt"]) > conferencia_sombra.TOLERANCIA
            or abs(l["difSai"]) > conferencia_sombra.TOLERANCIA
        )
        avisos.append(f"Conferência sombra DIVERGENTE do realizado do Omie — {detalhe}"[:400])

    checagem = {
        "ref": extrato.get("hoje"),
        "consultadoEm": extrato.get("consultadoEm"),
        "caixaProprio": extrato.get("caixaProprio"),
        "limiteConta": sum(c.get("limite") or 0 for c in extrato["contas"]),
        "vencidoAno": extra["inad"]["total"],
        "avisos": avisos,
        "sombra": resultado_sombra,
    }

    if saida:
        saida.mkdir(parents=True, exist_ok=True)
        for nome, conteudo in {"extrato": extrato, "extra": extra, "checagem": checagem,
                               "manifesto": manifesto, **bases}.items():
            (saida / f"{nome}.json").write_text(json.dumps(conteudo, ensure_ascii=False), encoding="utf-8")
        log(f"JSON gravados em {saida}")

    if gravar:
        etapa("gravando")
        db.gravar_pacote_caixa_diario(
            conn, empresa_id=empresa_id, data_ref=hoje, manifesto=manifesto,
            extrato=extrato, extra=extra, checagem=checagem, **bases,
        )
        log(f"Pacote de {hoje} gravado em caixa_pacote_diario.")
    return avisos


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--empresa-id", required=True)
    ap.add_argument("--saida", type=Path, default=None)
    ap.add_argument("--nao-gravar", action="store_true")
    args = ap.parse_args()
    conn = db.conectar()
    try:
        avisos = executar(conn, args.empresa_id, gravar=not args.nao_gravar, saida=args.saida)
    finally:
        conn.close()
    for aviso in avisos:
        print(f"[aviso] {aviso}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
