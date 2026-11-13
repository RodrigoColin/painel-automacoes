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
        return [c for c in await self.contratos_do_cliente(n_cod_cli) if c.ativo]

    async def contratos_do_cliente(self, n_cod_cli):
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


def test_plano_liquido_divergente_nao_gera_aviso():
    # Líquido da planilha ≠ valor do item no contrato não é relevante
    # (decisão Rodrigo 2026-11-13): a verificação foi removida, não há aviso.
    planilha = _planilha_sintetica()
    planilha.linhas[0].liquido = Decimal("9999.99")
    plano = _montar(planilha)
    [linha] = plano.linhas
    assert linha.status == "ok"
    assert linha.avisos == []


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


def test_plano_excecao_recupera_os_de_contrato_cancelado():
    # Caso real MONTRONI (nov/2026): contrato cancelado DEPOIS da OS criada.
    # O reenvio não pode duplicar: a exceção vira "ja_existe" pelo código do
    # contrato cancelado.
    fonte = FonteFake({"EXC-202611-6"})
    fonte.contrato = ContratoResumo(
        n_cod_ctr=1860490808, numero="6", n_cod_cli=1835264895,
        situacao="99",  # cancelado
        itens=[ItemContrato(n_cod_servico=2174029316, valor_total=None)],
        regra_venc=RegraContrato(dia_fixo=5))
    plano = _montar(_planilha_sintetica(), fonte)
    [linha] = plano.linhas
    assert linha.status == "ja_existe"
    assert linha.codigo_int_os == "EXC-202611-6"
    assert linha.numero_contrato == "6" and linha.os_existente_numero == "20019"


def test_plano_dia2_fatura_no_contrato_incluir():
    # Contrato dia de faturamento 2 → fatura no contrato; serviço de excedente
    # ainda NÃO está no contrato → ação "incluir".
    fonte = FonteFake()
    fonte.contrato = ContratoResumo(
        n_cod_ctr=1860490808, numero="6", n_cod_cli=1835264895, situacao="10",
        n_dia_fat=2,
        itens=[ItemContrato(n_cod_servico=2174029316, valor_total=Decimal("3359.49"))],
        regra_venc=RegraContrato(dia_fixo=5))
    plano = _montar(_planilha_sintetica(), fonte)
    [linha] = plano.linhas
    assert linha.status == "ok"
    assert linha.forma_faturamento == "contrato"
    assert linha.contrato_acao == "incluir"
    assert linha.codigo_int_os is None       # não vira OS
    assert plano.resumo()["os_a_criar"] == 0
    assert plano.resumo()["contrato_linhas"] == 1


def test_plano_dia2_atualiza_quando_servico_ja_no_contrato():
    # Excedente (nCodServ 2174029906) já é um item do contrato → "atualizar".
    fonte = FonteFake()
    fonte.contrato = ContratoResumo(
        n_cod_ctr=1860490808, numero="6", n_cod_cli=1835264895, situacao="10",
        n_dia_fat=2,
        itens=[ItemContrato(n_cod_servico=2174029316, valor_total=Decimal("3359.49")),
               ItemContrato(n_cod_servico=2174029906, valor_total=Decimal("900.00"))],
        regra_venc=RegraContrato(dia_fixo=5))
    plano = _montar(_planilha_sintetica(), fonte)
    [linha] = plano.linhas
    assert linha.forma_faturamento == "contrato"
    assert linha.contrato_acao == "atualizar"
    assert linha.contrato_valor_atual == Decimal("900.00")
    assert linha.n_cod_serv == 2174029906


def test_plano_dia1_continua_os():
    # Dia de faturamento != 2 segue o fluxo de OS.
    plano = _montar(_planilha_sintetica())  # FonteFake padrão: n_dia_fat=0
    [linha] = plano.linhas
    assert linha.forma_faturamento == "os"
    assert linha.codigo_int_os == "EXC-202611-6"


def test_contrato_reconciliar_inclui_atualiza_exclui():
    from omie_mcp.excedentes import contrato as ctr

    # Contrato já tem o excedente 2174030038 (900) e um "velho" 2174029999
    # (fora da base). Base traz 2174030038=123.45 (atualizar) e
    # 2174030044=50 (incluir). Esperado: atualiza um, inclui outro, exclui o
    # velho.
    SERVS = {2174030038, 2174029999, 2174030044}

    class ClienteContrato:
        def __init__(self):
            self.chamadas = []

        async def call(self, modulo, chamada, params):
            self.chamadas.append((chamada, params))
            if chamada == "ConsultarContrato":
                return {"contratoCadastro": {"itensContrato": [
                    {"itemCabecalho": {"codItem": 10, "seq": 1, "codServico": 5500, "valorUnit": 1}},
                    {"itemCabecalho": {"codItem": 11, "seq": 2, "codServico": 2174030038, "valorUnit": 900}},
                    {"itemCabecalho": {"codItem": 12, "seq": 3, "codServico": 2174029999, "valorUnit": 70}},
                ]}}
            return {"cDescStatus": "ok"}

    base = [
        ctr.ItemExcedenteBase(linha_id=1, n_cod_serv=2174030038,
                              valor=Decimal("123.45"), categoria="1.01.02",
                              cod_int_item="EXC-202611-2174030038"),
        ctr.ItemExcedenteBase(linha_id=2, n_cod_serv=2174030044,
                              valor=Decimal("50"), categoria="1.01.02",
                              cod_int_item="EXC-202611-2174030044"),
    ]
    cliente = ClienteContrato()
    r = asyncio.run(ctr.reconciliar(cliente, 999, "C-1", base, SERVS, log=lambda t: None))
    assert r.ok
    assert r.atualizados == [1] and r.incluidos == [2] and r.excluidos == 1

    alterar = [p for ch, p in cliente.chamadas if ch == "AlterarContrato"][0]
    itens = alterar["itensContrato"]
    # item atualizado referencia codItem 11; incluído usa codIntItem novo
    atualizado = next(i for i in itens if i["itemCabecalho"].get("codItem") == 11)
    incluido = next(i for i in itens if i["itemCabecalho"].get("codIntItem"))
    assert atualizado["itemCabecalho"]["valorUnit"] == 123.45
    assert incluido["itemCabecalho"]["codServico"] == 2174030044
    assert incluido["itemCabecalho"]["seq"] == 4   # max_seq(3)+1
    # o item "velho" 2174029999 (codItem 12) é excluído
    excluir = [p for ch, p in cliente.chamadas if ch == "ExcluirItem"][0]
    assert excluir["ItensExclusao"] == [{"codItem": 12}]


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


def test_criar_sequencial_nao_usa_concorrencia():
    # Inclusão no Omie é sequencial: criar() chama IncluirOS uma de cada vez,
    # nunca em paralelo (concorrência de inclusão gera bloqueio de 30 min).
    ordem = []

    class ClienteOrdem:
        def __init__(self):
            self.seq = 0

        async def call(self, modulo, chamada, params):
            self.seq += 1
            ordem.append(("inicio", self.seq))
            await asyncio.sleep(0)  # cede o loop: se houvesse paralelismo, intercalaria
            ordem.append(("fim", self.seq))
            return {"nCodOS": 100 + self.seq, "cNumOS": str(self.seq)}

    oss = [_os(), _os(), _os()]
    asyncio.run(criacao.criar(ClienteOrdem(), FonteFake(), oss, log=lambda t: None))
    # Cada criação fecha (inicio->fim) antes da próxima começar.
    assert ordem == [("inicio", 1), ("fim", 1), ("inicio", 2), ("fim", 2),
                     ("inicio", 3), ("fim", 3)]


def _linha_worker(**kw):
    # layout da query de processar_criacao (_montar_oss lê por índice)
    base = [10, 124, 1835266, None, None, 2174029908, "1.01.02", None,
            "CURITIBA (PR)", date(2026, 11, 18), "x@y.com",
            Decimal("504"), "resolvida", None, "EXC-202611-14803071000137"]
    for i, v in kw.items():
        base[int(i)] = v
    return base


def test_worker_os_sem_contrato_usa_nccc_padrao():
    from caixa.excedentes_worker import _montar_oss

    linha = _linha_worker()  # n_cod_ctr=None, n_cod_cc=None (sem contrato)
    [os_] = _montar_oss([linha], date(2026, 11, 18), n_cod_cc_padrao=1628924843)
    assert os_.n_cod_ctr is None
    assert os_.n_cod_cc == 1628924843  # herdou o padrão da empresa
    assert criacao.montar_payload(os_)["InformacoesAdicionais"]["nCodCC"] == 1628924843


def test_worker_sem_contrato_e_sem_padrao_falha_cedo():
    from caixa.excedentes_worker import _montar_oss
    import pytest

    linha = _linha_worker()
    with pytest.raises(ValueError, match="nCodCC"):
        _montar_oss([linha], date(2026, 11, 18), n_cod_cc_padrao=None)


def test_criar_bloqueio_para_a_rodada():
    # OmieBloqueioError (consumo indevido) NÃO vira "falha" da linha: propaga
    # para a rodada inteira parar — insistir reinicia o prazo de 30 min.
    from omie_mcp.client import OmieBloqueioError

    class ClienteBloqueia:
        async def call(self, modulo, chamada, params):
            raise OmieBloqueioError("API bloqueada por consumo indevido.")

    import pytest
    with pytest.raises(OmieBloqueioError):
        asyncio.run(criacao.criar(ClienteBloqueia(), FonteFake(), [_os()],
                                  log=lambda t: None))
