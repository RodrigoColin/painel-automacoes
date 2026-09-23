"""Exporta do Omie as duas bases que o modo sombra precisa.

  titulos.json   — os titulos (CP + CR) que existiam no periodo, para o motor
                   tentar casar.
  gabarito.json  — o que o HUMANO de fato fez, lido de `ListarLancCC`:
                   `diversos.nCodLancCR` / `nCodLancCP` aponta o titulo que foi
                   baixado por aquele lancamento bancario. Essa e a resposta
                   certa contra a qual o motor e medido.

Roda no terminal do Rodrigo (o sandbox nao alcanca app.omie.com.br).

Uso:
    python scripts/exportar_base_sombra.py --cliente oystr \\
        --conta-omie 1628924843 --desde 01/08/2026 --ate 31/08/2026

PONTOS A CONFERIR NA PRIMEIRA RODADA (marcados com CONFERIR no codigo):
os nomes de funcao usados aqui (ClientesRegistry.load/resolver_slug/
settings_for, OmieClient, listar_contas_pagar/receber, listar_lancamentos_cc)
sao os mesmos usados em omie_mcp/server.py e ja rodam em producao — o que
ainda NAO esta confirmado contra a API real e o NOME DO FILTRO de data de
`ListarContasPagar`/`ListarContasReceber` (`filtrar_por_data_de/ate`: e uma
hipotese de pesquisa externa, ver tests/sample_fields_12.py) e se o valor do
titulo vem bruto ou liquido de retencao.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.client import OmieClient
from omie_mcp.clients import ClientesConfigError, ClientesRegistry
from omie_mcp.tools import clientes as tools_clientes
from omie_mcp.tools import contas_pagar, contas_receber, lancamentos_cc
from omie_mcp.conciliacao import dicionario_banco as dic

# Termos que indicam transferencia entre contas da propria empresa — mesma
# lista usada em omie_mcp/conciliacao/motor.py (_parece_transferencia).
# Mantida em sincronia manualmente: se mudar aqui, mudar la tambem.
_TERMOS_TRANSFERENCIA = (
    "TRANSF ENTRE CONTAS", "TRANSFERENCIA ENTRE CONTAS", "TRANSF C/C",
    "TED MESMA TITULARIDADE", "PIX MESMA TITULARIDADE", "TRANSF PROPRIA",
)


def _parece_transferencia(texto: str) -> bool:
    normalizado = dic._normalizar(texto or "")
    return any(t in normalizado for t in _TERMOS_TRANSFERENCIA)


# ---------------------------------------------------------------------------
# helpers tolerantes: o omie_mcp evoluiu, entao nao assumimos assinatura fixa
# ---------------------------------------------------------------------------

def _campo(dado: dict, *caminhos: str, padrao: Any = None) -> Any:
    """Busca o primeiro caminho que existir. Ex.: _campo(t, 'data_vencimento')."""
    for caminho in caminhos:
        atual: Any = dado
        ok = True
        for parte in caminho.split("."):
            if isinstance(atual, dict) and parte in atual:
                atual = atual[parte]
            else:
                ok = False
                break
        if ok and atual not in (None, ""):
            return atual
    return padrao


def _data_iso(bruto: Optional[str]) -> Optional[str]:
    """dd/mm/aaaa (Omie) -> aaaa-mm-dd (nosso formato)."""
    if not bruto:
        return None
    bruto = str(bruto).strip()
    for formato in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(bruto, formato).date().isoformat()
        except ValueError:
            continue
    return None


def _decimal_str(valor: Any) -> str:
    if valor in (None, ""):
        return "0"
    return f"{float(valor):.2f}"


def _somar_dias_br(data_br: str, dias: int) -> str:
    """dd/mm/aaaa +/- dias, devolvido no mesmo formato (dd/mm/aaaa)."""
    from datetime import timedelta

    d = datetime.strptime(data_br, "%d/%m/%Y").date() + timedelta(days=dias)
    return d.strftime("%d/%m/%Y")


# ---------------------------------------------------------------------------

async def exportar(args: argparse.Namespace) -> int:
    try:
        registry = ClientesRegistry.load()
        slug = registry.resolver_slug(args.cliente)
        settings = registry.settings_for(slug)
    except ClientesConfigError as exc:
        print(f"\nERRO de configuracao de cliente: {exc}")
        return 1

    desde_iso = _data_iso(args.desde)
    ate_iso = _data_iso(args.ate)
    # Margem de 20 dias no vencimento (pra tras e pra frente): um titulo
    # vencido antes do periodo do extrato pode ter sido pago dentro dele, e
    # vice-versa. Mesma margem ja adotada em producao no oystr_diagnostico —
    # so se aplica a busca de TITULOS (por vencimento); o gabarito continua
    # filtrado exatamente pelo periodo pedido (e por data de PAGAMENTO, nao
    # de vencimento, entao nao precisa da mesma margem).
    desde_margem = _somar_dias_br(args.desde, -20)
    ate_margem = _somar_dias_br(args.ate, 20)
    desde_iso_margem = _data_iso(desde_margem)
    ate_iso_margem = _data_iso(ate_margem)
    print(f"Cliente: {slug}  |  periodo {desde_iso} a {ate_iso}  "
          f"(titulos buscados com margem {desde_margem} a {ate_margem})")

    async with OmieClient(settings) as client:
        if args.conta_omie:
            from omie_mcp.tools.contas_correntes import contas_omie_cash
            cash = {str(c) for c in await contas_omie_cash(client)}
            achadas = cash & set(args.conta_omie)
            if achadas:
                print(f"\nERRO: {', '.join(sorted(achadas))} e conta Omie.CASH — "
                      "conciliada automaticamente pelo proprio Omie, nunca deve "
                      "entrar em --conta-omie. Remova essa conta e rode de novo.")
                return 1

        # -------------------------------------------------------------
        # 1. Titulos do periodo (CP + CR), todos os status
        # -------------------------------------------------------------
        print("\n[1/3] Buscando titulos (CP + CR) e cadastro de clientes/fornecedores...")
        titulos: list[dict] = []

        # RESOLVIDO em 2026-09-20 contra a Oystr: `filtrar_por_data_de/ate`
        # e aceito pela API (nao dá erro), mas NAO filtra por vencimento de
        # verdade — vieram titulos de 2023 a 2028 numa busca de 2 meses.
        # Mantido mesmo assim (nao piora nada, e pode ajudar quando a API
        # decidir respeitar), mas o corte real agora e feito abaixo, no
        # cliente, contra desde_margem/ate_margem.
        filtros_data = {
            "filtrar_por_data_de": desde_margem,
            "filtrar_por_data_ate": ate_margem,
        }
        brutos_cp = await contas_pagar.listar_contas_pagar(client, filtros=filtros_data)
        brutos_cr = await contas_receber.listar_contas_receber(client, filtros=filtros_data)

        # RESOLVIDO em 2026-09-20: ListarContasPagar/Receber NAO traz nome
        # nem CNPJ do parceiro inline — so `codigo_cliente_fornecedor`. Sem
        # isso, o motor perde duas das evidencias mais fortes (nome e CNPJ).
        # Precisa do cadastro completo pra cruzar.
        cadastro = await tools_clientes.listar_clientes(client)
        nome_por_codigo: dict[int, str] = {}
        documento_por_codigo: dict[int, str] = {}
        for c in cadastro:
            codigo = c.get("codigo_cliente_omie")
            if codigo is None:
                continue
            nome_por_codigo[codigo] = c.get("razao_social") or c.get("nome_fantasia") or ""
            documento_por_codigo[codigo] = c.get("cnpj_cpf") or ""
        print(f"      {len(cadastro)} clientes/fornecedores cadastrados")

        # Status reais confirmados ao vivo (Proos, 2026-09-21): RECEBIDO,
        # PAGO, CANCELADO, ATRASADO, A VENCER. ListarContasPagar/Receber
        # devolve titulo JA LIQUIDADO junto com titulo aberto — sem marcar
        # `conciliado`, o motor tratava titulo ja pago/recebido como
        # candidato valido pra uma NOVA baixa (risco real de baixa
        # duplicada, achado ao investigar uma duplicidade de lancamento
        # direto no mesmo dia).
        _STATUS_CANCELADO = {"CANCELADO"}
        _STATUS_FECHADO = {"PAGO", "RECEBIDO"}
        descartados_fora_da_margem = 0
        conciliados = 0
        for tipo, brutos in (("CP", brutos_cp), ("CR", brutos_cr)):
            for t in brutos:
                status = str(_campo(t, "status_titulo", padrao="")).upper()
                if status in _STATUS_CANCELADO:
                    continue

                vencimento = _data_iso(
                    _campo(t, "data_vencimento", "dDtVenc", "data_previsao")
                )
                if vencimento is None:
                    continue
                if not (desde_iso_margem <= vencimento <= ate_iso_margem):
                    descartados_fora_da_margem += 1
                    continue

                codigo_parceiro = _campo(t, "codigo_cliente_fornecedor")

                titulos.append({
                    "id": str(_campo(t, "codigo_lancamento_omie", "nCodTitulo")),
                    "tipo": tipo,
                    "vencimento": vencimento,
                    # valor BRUTO da nota. O liquido (com retencao) so vem
                    # pronto via ListarExtrato — CONFERIR: os campos
                    # retem_ir/retem_iss/retem_pis/retem_cofins/retem_csll/
                    # retem_inss (booleanos "S"/"N", confirmados na resposta
                    # real) dizem QUAIS impostos incidem neste titulo — dá pra
                    # calcular o liquido exato se o acerto do modo sombra
                    # ficar sistematicamente baixo nos titulos com algum
                    # retem_* = "S".
                    "valor": _decimal_str(
                        _campo(t, "valor_documento", "nValorTitulo", padrao=0)
                    ),
                    "parceiro_nome": nome_por_codigo.get(codigo_parceiro, ""),
                    "parceiro_documento": documento_por_codigo.get(codigo_parceiro) or None,
                    "numero_documento": _campo(
                        t, "numero_documento_fiscal", "numero_documento"
                    ),
                    "categoria": _campo(t, "codigo_categoria", "cCodCateg"),
                    "tem_documento_anexo": bool(_campo(t, "possui_anexo", padrao=False)),
                    # PAGO/RECEBIDO: mantido na lista (auditoria/fechamento),
                    # mas marcado conciliado — conciliar() ja exclui titulo
                    # conciliado da busca de candidato (titulos_disponiveis).
                    "conciliado": status in _STATUS_FECHADO,
                })
                if status in _STATUS_FECHADO:
                    conciliados += 1

        print(f"      {len(titulos)} titulos ({len(brutos_cp)} CP + {len(brutos_cr)} CR "
              f"brutos, {descartados_fora_da_margem} descartados por vencimento fora "
              f"da margem de 20 dias, {conciliados} ja pagos/recebidos e marcados "
              f"conciliado)")

        # -------------------------------------------------------------
        # 2. Gabarito: o que o humano fez, via lancamentos de conta corrente
        # -------------------------------------------------------------
        print("\n[2/3] Buscando lancamentos de conta corrente (gabarito)...")
        # Nomes da chamada e dos campos confirmados contra dado real. O
        # parametro n_cod_cc do proprio omie_mcp NAO — testado ao vivo em
        # 2026-09-20 contra a Oystr e a API rejeitou com "Tag [NCODCC] nao
        # faz parte da estrutura [lanccListarRequest]". E um bug existente em
        # omie_mcp/tools/lancamentos_cc.py (usado tambem por server.py), fora
        # do escopo deste script — aqui so evitamos o parametro quebrado e
        # filtramos pela conta do lado de fora, como o codigo original fazia.
        lancs = await lancamentos_cc.listar_lancamentos_cc(
            client,
            data_pagamento_de=args.desde,
            data_pagamento_ate=args.ate,
        )

        # Lista por chave, NAO um dict de entrada unica: duas transacoes
        # reais podem cair na mesma data+valor (ex.: dois boletos de
        # fornecedores diferentes, mesmo valor, mesmo dia — achado real na
        # Leadfy, 2026-09-21). Sobrescrever silenciosamente perdia uma das
        # duas respostas certas antes mesmo do modo sombra comparar,
        # inflando artificialmente o numero de "erro" do motor por um
        # problema de medicao, nao do motor. modo_sombra.py desambigua pela
        # observacao quando ha mais de uma entrada na mesma chave.
        gabarito: dict[str, list[dict]] = {}
        sem_titulo = 0
        transferencias = 0
        fora_da_conta = 0

        contas_alvo = {str(c) for c in args.conta_omie} if args.conta_omie else None
        for lanc in lancs:
            if contas_alvo and str(lancamentos_cc.conta_corrente_id(lanc)) not in contas_alvo:
                fora_da_conta += 1
                continue

            # dDtLanc e o campo certo pra "quando o dinheiro se moveu" — nunca
            # dDtConc (os dois divergem; ver lancamentos_cc.data_lancamento).
            data_lanc = _data_iso(lancamentos_cc.data_lancamento(lanc))
            valor = lancamentos_cc.valor_lancamento(lanc)

            titulo_cr = lancamentos_cc.titulo_vinculado_receber(lanc)
            titulo_cp = lancamentos_cc.titulo_vinculado_pagar(lanc)
            titulo_id = titulo_cr or titulo_cp
            observacao = _campo(lanc, "cabecalho.cObs", padrao="")

            if titulo_id:
                tipo = "titulo"
            elif _parece_transferencia(observacao):
                # Heuristica textual (mesma do motor) — nao pega transferencia
                # sem indicio na observacao, mas ja evita contar toda
                # transferencia como lanc_direto (o que inflava falsamente o
                # acerto do modo sombra: ver achado do Codex de 2026-09-19).
                tipo = "transferencia"
                transferencias += 1
            else:
                tipo = "lanc_direto"  # tarifa, rendimento...
                sem_titulo += 1

            # A chave precisa casar com o id da linha do OFX (FITID). O Omie
            # nao guarda o FITID, entao casamos por (data, valor) — a chave
            # composta abaixo e resolvida pelo modo sombra na hora de comparar.
            chave = f"{data_lanc}|{float(valor):.2f}"
            gabarito.setdefault(chave, []).append({
                "titulo_id": str(titulo_id) if titulo_id else None,
                "tipo": tipo,
                "cod_lancamento": str(_campo(lanc, "cabecalho.nCodLanc", padrao="")),
                "data": data_lanc,
                "valor": _decimal_str(valor),
                "observacao": observacao,
            })

        total_entradas = sum(len(v) for v in gabarito.values())
        colisoes = sum(1 for v in gabarito.values() if len(v) > 1)
        print(f"      {total_entradas} lancamentos em {len(gabarito)} chaves "
              f"data+valor ({colisoes} chaves com 2+ lancamentos na mesma "
              f"data+valor — desambiguadas por texto no modo sombra) "
              f"({sem_titulo} sem titulo, {transferencias} transferencia por "
              f"indicio textual, {fora_da_conta} descartados por serem de "
              f"outra conta)")

    # -----------------------------------------------------------------
    # 3. Gravar
    # -----------------------------------------------------------------
    print("\n[3/3] Gravando...")
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)

    (saida / "titulos.json").write_text(
        json.dumps(titulos, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (saida / "gabarito.json").write_text(
        json.dumps(gabarito, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"      {saida / 'titulos.json'}")
    print(f"      {saida / 'gabarito.json'}")
    print("\nAgora rode o modo sombra:")
    if args.conta_omie and len(args.conta_omie) > 1:
        print(f"  python scripts/modo_sombra.py --ofx <extrato1.ofx> <extrato2.ofx> ... "
              f"--contas {' '.join(args.conta_omie)} --titulos {saida / 'titulos.json'} "
              f"--gabarito {saida / 'gabarito.json'} --gabarito-por-data-valor")
    else:
        conta_unica = args.conta_omie[0] if args.conta_omie else "<nCodCC>"
        print(f"  python scripts/modo_sombra.py --ofx <extrato.ofx> "
              f"--conta {conta_unica} --titulos {saida / 'titulos.json'} "
              f"--gabarito {saida / 'gabarito.json'} --gabarito-por-data-valor")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Exporta titulos.json e gabarito.json do Omie para o modo sombra"
    )
    ap.add_argument("--cliente", required=True, help="slug em clientes_omie.json")
    ap.add_argument("--conta-omie", default=None, nargs="+",
                    help="nCodCC da(s) conta(s) corrente(s) que filtram o gabarito — "
                         "mais de uma quando for testar transferencia entre contas "
                         "da mesma empresa no modo sombra multi-conta")
    ap.add_argument("--desde", required=True, help="dd/mm/aaaa")
    ap.add_argument("--ate", required=True, help="dd/mm/aaaa")
    ap.add_argument("--saida", default="sombra", help="pasta de saida")
    args = ap.parse_args()

    try:
        return asyncio.run(exportar(args))
    except (AttributeError, TypeError) as e:
        print(f"\nERRO: assinatura do omie_mcp diferente do esperado -> {e}")
        print("Procure os pontos marcados com CONFERIR neste arquivo e ajuste "
              "o nome da funcao/campo para o que existe hoje no projeto.")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
