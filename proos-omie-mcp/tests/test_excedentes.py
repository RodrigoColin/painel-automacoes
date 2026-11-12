"""Testes do modulo de excedentes — sem rede, sem API Omie.

Os casos de vencimento vem do gabarito real de novembro/2026
("Plano OS Excedentes novembro.26.xlsx", validado a mao pelo Rodrigo):
plano montado em 11/11/2026, competencia 2026-11.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omie_mcp.excedentes import criacao, plano as plano_mod, vencimento  # noqa: E402
from omie_mcp.excedentes.depara import MapeamentoExcedente  # noqa: E402
from omie_mcp.excedentes.planilha import LinhaPlanilha, PlanilhaLida, ler  # noqa: E402
from omie_mcp.excedentes.resolucao import (  # noqa: E402
    ContratoResumo, DetalheCliente, DetalheContrato, ItemContrato, OsExistente,
)
from omie_mcp.excedentes.vencimento import RegraContrato  # noqa: E402

HOJE = date(2026, 11, 11)
COMP = (2026, 11)


# ------------------------------- vencimento ------------------------------- #

def _calc(regra: RegraContrato):
    return vencimento.calcular(HOJE, COMP, regra)


def test_venc_dia_util_fica():
    v = _calc(RegraContrato(dia_fixo=25))
    assert v.data == date(2026, 11, 25) and v.regra is None


def test_venc_passou_vira_tres_uteis():
    # ARAUZ: contrato vence 05/11, ja passou -> 12, 13, 16/11.
    v = _calc(RegraContrato(dia_fixo=5))
    assert v.data == date(2026, 11, 16)
    assert "05/11" in v.regra and "3 dias úteis" in v.regra


def test_venc_ate_dois_dias_tambem_vira_tres_uteis():
    # 13/11 esta a 2 dias de 11/11 — tambem cai na regra.
    v = _calc(RegraContrato(dia_fixo=13))
    assert v.data == date(2026, 11, 16) and "13/11" in v.regra


def test_venc_domingo_posterga():
    v = _calc(RegraContrato(dia_fixo=15))  # 15/11: domingo E feriado
    assert v.data == date(2026, 11, 16) and "postergado" in v.regra


def test_venc_feriado_nacional_posterga():
    # 20/11 (Consciencia Negra) cai numa sexta em 2026.
    v = _calc(RegraContrato(dia_fixo=20))
    assert v.data == date(2026, 11, 23) and "20/11" in v.regra


def test_venc_sabado_antecipa_quando_contrato_manda():
    v = _calc(RegraContrato(dia_fixo=28, postergar=False, antecipar=True))
    assert v.data == date(2026, 11, 27) and "antecipado" in v.regra


def test_venc_sabado_posterga_por_padrao():
    v = _calc(RegraContrato(dia_fixo=28))
    assert v.data == date(2026, 11, 30)


def test_venc_proximo_mes():
    # Contrato cobra no mes seguinte: 05/12 (sabado) -> 07/12.
    v = _calc(RegraContrato(dia_fixo=5, proximo_mes=True))
    assert v.data == date(2026, 12, 7) and "05/12" in v.regra


def test_venc_sem_contrato():
    v = vencimento.calcular(HOJE, COMP, None)
    assert v.data == date(2026, 11, 16) and "sem contrato" in v.regra


def test_dias_uteis_pulam_feriado():
    # 18/11/2026 (qua) + 3 uteis = 19, 23 (20 e feriado, 21-22 fds), 24.
    assert vencimento.somar_dias_uteis(date(2026, 11, 18), 3) == date(2026, 11, 24)


# -------------------------------- planilha -------------------------------- #

_CABECALHO = [
    "Nome Cliente", "CNPJ/CPF", "Decrição do Serviço", "Cidade", "Estado",
    "Situação", "Categoria", "Líquido", "Vigencia Inicial", "Ano Faturamento",
    "Mes Faturamento", "Codigo do serviço", "Franquia", "Consumo",
    "Excedentes", "Valor item excedente", "Valor total excedentes", None,
]


def _xlsx(linhas: list[list]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(_CABECALHO)
    for linha in linhas:
        ws.append(linha)
    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def _linha_ok(marca=None, cnpj="05.417.802/0001-15", cod="5573", total=1503.15):
    return ["ARAUZ", cnpj, "Tribunais - Intimações", "Curitiba", "PR",
            "NFS-e Autorizada", "RPA Recorrente", 3359.49, "2015-10-22",
            2026, "Outubro", cod, 5500, 8233, 2733, 0.55, total, marca]


def test_planilha_le_e_separa_marcadas():
    lida = ler(_xlsx([_linha_ok(), _linha_ok(marca="ok", cod="9999")]))
    assert not lida.erros_estrutura
    assert len(lida.processaveis) == 1 and len(lida.ignoradas) == 1
    linha = lida.processaveis[0]
    assert linha.valor_total == Decimal("1503.15")
    assert linha.cnpj_digitos == "05417802000115"
    assert not linha.erros


def test_planilha_texto_em_celula_numerica():
    linha = _linha_ok(total="abc")
    lida = ler(_xlsx([linha]))
    assert any("não numérico" in e for e in lida.processaveis[0].erros)


def test_planilha_duplicada():
    lida = ler(_xlsx([_linha_ok(), _linha_ok()]))
    assert any("Duplicada" in e for e in lida.processaveis[1].erros)
    assert not lida.processaveis[0].erros


def test_planilha_cabecalho_errado():
    from openpyxl import Workbook

    wb = Workbook()
    wb.active.append(["Coluna errada"])
    buffer = BytesIO()
    wb.save(buffer)
    assert ler(buffer.getvalue()).erros_estrutura


# ------------------------------ plano (fake) ------------------------------ #

class FonteFake:
    """So os metodos que plano.montar usa; dados sinteticos."""

    def __init__(self, os_existentes: set[str] = frozenset()):
        self.os_existentes = set(os_existentes)
        self.contrato = ContratoResumo(
            n_cod_ctr=1860490808, numero="6", n_cod_cli=1835264895,
            situacao="10",
            itens=[ItemContrato(n_cod_servico=2174029316,
                                valor_total=Decimal("3359.49"))],
            regra_venc=RegraContrato(dia_fixo=5),
        )

    async def cliente_por_cnpj(self, cnpj):
        return 1835264895 if cnpj == "05417802000115" else None

    async def contratos_ativos_do_cliente(self, n_cod_cli):
        return [self.contrato] if n_cod_cli == 1835264895 else []

    async def consultar_contrato(self, n_cod_ctr):
        return DetalheContrato(
            email_envio="financeiro@arauz.com.br", categoria=None,
            n_cod_cc=123, cidade_prest="CURITIBA (PR)",
            regra_venc=RegraContrato(dia_fixo=5), numero="6")

    async def consultar_cliente(self, n_cod_cli):
        return DetalheCliente(email="adm@cliente.com", cidade="CURITIBA", estado="PR")

    async def os_existente(self, codigo):
        if codigo in self.os_existentes:
            return OsExistente(n_cod_os=111, numero="20019", etapa="50")
        return None


DE_PARA = {
    "5573": MapeamentoExcedente(
        cod_recorrente="5573", n_cod_serv_recorrente=2174029316,
        cod_excedente="4185", descricao_excedente="... - Excedentes",
        n_cod_serv_excedente=2174029906, categoria_excedente="1.01.02",
        status="automatico"),
}


def _planilha_sintetica(**kw) -> PlanilhaLida:
    linha = LinhaPlanilha(
        linha=2, cliente="ARAUZ", cnpj="05.417.802/0001-15",
        descricao="Tribunais - Intimações", categoria="RPA Recorrente",
        liquido=Decimal("3359.49"), cod_servico="5573",
        valor_total=Decimal("1503.15"), **kw)
    return PlanilhaLida([linha], [])


def _montar(planilha: PlanilhaLida, fonte=None):
    return asyncio.run(plano_mod.montar(
        fonte or FonteFake(), planilha, DE_PARA, "202611", hoje=HOJE))


def test_plano_linha_ok():
    plano = _montar(_planilha_sintetica())
    [linha] = plano.linhas
    assert linha.status == "ok"
    assert linha.codigo_int_os == "EXC-202611-6"
    assert linha.n_cod_ctr == 1860490808
    assert linha.email_envio == "financeiro@arauz.com.br"
    assert linha.venc_final == date(2026, 11, 16)  # 05/11 passou -> +3 uteis
    assert linha.avisos == []
    assert plano.resumo()["os_a_criar"] == 1


def test_plano_valor_divergente_e_aviso_nao_excecao():
    planilha = _planilha_sintetica()
    planilha.linhas[0].liquido = Decimal("9999.99")
    plano = _montar(planilha)
    [linha] = plano.linhas
    assert linha.status == "ok"
    assert plano_mod.AVISO_VALOR_DIVERGENTE in linha.avisos


def test_plano_execucao_unica_e_excecao():
    planilha = _planilha_sintetica()
    planilha.linhas[0].categoria = "Execução Unica"
    plano = _montar(planilha)
    [linha] = plano.linhas
    assert linha.status == "excecao"
    assert "Execução Única" in linha.excecao_motivo
    # resolucao assistida: cliente e e-mail ja vem resolvidos para a tela
    assert linha.n_cod_cli == 1835264895


def test_plano_sem_de_para_e_excecao():
    planilha = _planilha_sintetica()
    planilha.linhas[0].cod_servico = "0000"
    plano = _montar(planilha)
    assert plano.linhas[0].status == "excecao"
    assert "sem De/Para" in plano.linhas[0].excecao_motivo


def test_plano_os_ja_existe():
    plano = _montar(_planilha_sintetica(), FonteFake({"EXC-202611-6"}))
    [linha] = plano.linhas
    assert linha.status == "ja_existe"
    assert linha.os_existente_numero == "20019"


def test_plano_contrato_nao_identificado():
    fonte = FonteFake()
    fonte.contrato = ContratoResumo(
        n_cod_ctr=1, numero="294", n_cod_cli=1835264895, situacao="10",
        itens=[ItemContrato(n_cod_servico=999, valor_total=None)],
        regra_venc=RegraContrato())
    plano = _montar(_planilha_sintetica(), fonte)
    [linha] = plano.linhas
    assert linha.status == "excecao"
    assert "contrato não identificado (294)" in linha.excecao_motivo


# -------------------------------- criacao --------------------------------- #

def _os(com_contrato=True):
    return criacao.OsParaCriar(
        c_cod_int_os="EXC-202611-6" if com_contrato else "EXC-202611-05417802000115",
        n_cod_cli=1835264895,
        n_cod_ctr=1860490808 if com_contrato else None,
        numero_contrato="6" if com_contrato else None,
        categoria="1.01.02", n_cod_cc=123, cidade_prest="CURITIBA (PR)",
        vencimento=date(2026, 11, 16), previsao=date(2026, 11, 16),
        email_envio="financeiro@arauz.com.br",
        itens=[criacao.ItemOS(linha_id=1, n_cod_servico=2174029906,
                              valor_total=Decimal("1503.15"),
                              categoria="1.01.02")],
    )


def test_payload_incluir_os():
    payload = criacao.montar_payload(_os())
    cab = payload["Cabecalho"]
    assert cab["cEtapa"] == "50" and cab["cCodParc"] == "999"
    assert cab["cCodIntOS"] == "EXC-202611-6" and cab["nCodCtr"] == 1860490808
    info = payload["InformacoesAdicionais"]
    assert info["cNumContrato"] == "6" and info["cCodCateg"] == "1.01.02"
    assert "cDadosAdicNF" not in info          # regra dura da skill
    assert payload["Email"]["cEnvBoleto"] == "S" and payload["Email"]["cEnvPix"] == "N"
    [parc] = payload["Parcelas"]
    assert parc["dDtVenc"] == "16/11/2026"
    [serv] = payload["ServicosPrestados"]
    assert serv["nValUnit"] == 1503.15 and serv["nQtde"] == 1
    assert "cDadosAdicItem" not in serv


def test_payload_sem_contrato_omite_vinculo():
    payload = criacao.montar_payload(_os(com_contrato=False))
    assert "nCodCtr" not in payload["Cabecalho"]
    assert "cNumContrato" not in payload["InformacoesAdicionais"]


class ClienteFake:
    def __init__(self):
        self.chamadas = []

    async def call(self, modulo, chamada, params):
        self.chamadas.append((modulo, chamada, params))
        return {"nCodOS": 555, "cNumOS": "20100"}


def test_criar_pula_os_existente():
    cliente = ClienteFake()

    class FonteExistente(FonteFake):
        async def os_existente(self, codigo):
            return OsExistente(n_cod_os=111, numero="20019", etapa="50")

    [r] = asyncio.run(criacao.criar(cliente, FonteExistente(), [_os()], log=lambda t: None))
    assert r.status == "ja_existia" and r.n_cod_os == 111
    assert cliente.chamadas == []  # nenhum IncluirOS disparado


def test_criar_os_nova():
    cliente = ClienteFake()
    [r] = asyncio.run(criacao.criar(cliente, FonteFake(), [_os()], log=lambda t: None))
    assert r.status == "criada" and r.n_cod_os == 555 and r.numero_os == "20100"
    [(modulo, chamada, _)] = cliente.chamadas
    assert (modulo, chamada) == ("servicos/os", "IncluirOS")
