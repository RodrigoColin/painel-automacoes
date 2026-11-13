"""
Montagem do PLANO de excedentes — prévia completa, zero escrita no Omie.

Cada linha processável da planilha sai daqui com um destes status:
  ok        — pronta para virar OS (ou item de OS) na aprovação
  ja_existe — já há OS no Omie com o mesmo cCodIntOS (idempotência)
  excecao   — precisa de decisão do analista (sem De/Para, Execução Única,
              contrato não identificado/ambíguo, erro de validação)

Linhas OK do MESMO contrato viram itens da MESMA OS. O vencimento, o
e-mail e os dados adicionais vêm do ConsultarContrato individual (o
ListarContratos devolve o e-mail em branco — regra 9 da skill).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from . import vencimento as venc_mod
from .depara import MapeamentoExcedente
from .planilha import LinhaPlanilha, PlanilhaLida
from .resolucao import ContratoResumo, FonteOmie, nome_limpo

AVISO_MAPEAMENTO = "mapeamento a confirmar"
AVISO_SEM_EMAIL = "contrato sem e-mail de envio"


def c_cod_int_os(competencia: str, numero_contrato: str | None,
                 cnpj_digitos: str) -> str:
    """EXC-AAAAMM-<contrato>; sem contrato, EXC-AAAAMM-<cnpj só dígitos>."""
    sufixo = numero_contrato if numero_contrato else cnpj_digitos
    return f"EXC-{competencia}-{sufixo}"


@dataclass
class LinhaPlano:
    origem: LinhaPlanilha
    status: str = "ok"                      # ok | ja_existe | excecao
    avisos: list[str] = field(default_factory=list)
    motivos_excecao: list[str] = field(default_factory=list)

    n_cod_cli: int | None = None
    numero_contrato: str | None = None
    n_cod_ctr: int | None = None
    contratos_candidatos: list[str] = field(default_factory=list)

    cod_excedente: str | None = None
    n_cod_serv: int | None = None
    desc_excedente: str | None = None
    categoria: str | None = None

    n_cod_cc: int | None = None
    cidade_prest: str | None = None
    venc_contrato: date | None = None
    venc_final: date | None = None
    regra_venc: str | None = None
    email_envio: str | None = None

    # Roteamento OS × Contrato (clientes dia de faturamento 2 → contrato).
    forma_faturamento: str = "os"           # os | contrato
    n_dia_fat: int | None = None
    contrato_acao: str | None = None        # atualizar | incluir
    contrato_valor_atual: Decimal | None = None  # valor do item no contrato hoje

    codigo_int_os: str | None = None
    os_existente_n_cod: int | None = None
    os_existente_numero: str | None = None

    def excecao(self, motivo: str) -> None:
        self.status = "excecao"
        if motivo not in self.motivos_excecao:
            self.motivos_excecao.append(motivo)

    @property
    def excecao_motivo(self) -> str | None:
        return "; ".join(self.motivos_excecao) or None


@dataclass
class Plano:
    competencia: str                        # AAAAMM
    hoje: date
    linhas: list[LinhaPlano]
    erros_estrutura: list[str]
    ignoradas: int                          # linhas com a coluna R marcada

    @property
    def oks(self) -> list[LinhaPlano]:
        # OK que vão virar OS (forma os). Contrato tem fluxo próprio.
        return [l for l in self.linhas
                if l.status == "ok" and l.forma_faturamento == "os"]

    @property
    def contrato(self) -> list[LinhaPlano]:
        return [l for l in self.linhas
                if l.status in ("ok", "ja_existe") and l.forma_faturamento == "contrato"]

    @property
    def excecoes(self) -> list[LinhaPlano]:
        return [l for l in self.linhas if l.status == "excecao"]

    @property
    def ja_existem(self) -> list[LinhaPlano]:
        return [l for l in self.linhas
                if l.status == "ja_existe" and l.forma_faturamento == "os"]

    def resumo(self) -> dict:
        def total(linhas: list[LinhaPlano]) -> str:
            return str(sum(l.origem.valor_total or Decimal(0) for l in linhas))

        os_novas = {chave_os(l) for l in self.oks}
        return {
            "linhas_processaveis": len(self.linhas),
            "linhas_ignoradas": self.ignoradas,
            "os_a_criar": len(os_novas),
            "valor_os_a_criar": total(self.oks),
            "contrato_linhas": len(self.contrato),
            "valor_contrato": total(self.contrato),
            "excecoes": len(self.excecoes),
            "valor_excecoes": total(self.excecoes),
            "ja_existem": len(self.ja_existem),
            "valor_ja_existem": total(self.ja_existem),
        }


def chave_os(linha: LinhaPlano) -> str:
    """Linhas com a mesma chave viram itens da mesma OS."""
    return linha.codigo_int_os or f"linha-{linha.origem.linha}"


def _contrato_da_linha(
    candidatos: list[ContratoResumo], n_cod_serv_recorrente: int | None,
) -> tuple[ContratoResumo | None, list[ContratoResumo]]:
    """Contrato ativo que CONTÉM o serviço recorrente da linha (regra 3)."""
    if n_cod_serv_recorrente:
        com_servico = [
            c for c in candidatos
            if any(i.n_cod_servico == n_cod_serv_recorrente for i in c.itens)
        ]
        if len(com_servico) == 1:
            return com_servico[0], candidatos
        if len(com_servico) > 1:
            return None, com_servico
    if len(candidatos) == 1 and n_cod_serv_recorrente is None:
        return None, candidatos
    return None, candidatos


async def montar(
    fonte: FonteOmie,
    planilha: PlanilhaLida,
    de_para: dict[str, MapeamentoExcedente],
    competencia: str,
    hoje: date | None = None,
    etapa=lambda nome: None,
) -> Plano:
    hoje = hoje or date.today()
    comp = (int(competencia[:4]), int(competencia[4:6]))
    linhas = [LinhaPlano(origem=o) for o in planilha.processaveis]
    # Conjunto de serviços de excedente (p/ identificar itens de excedente
    # já existentes dentro de um contrato dia-2).
    servs_excedente = {m.n_cod_serv_excedente for m in de_para.values()
                       if m.n_cod_serv_excedente}

    # 1. validação local: erros da planilha e Execução Única são exceção.
    for l in linhas:
        for erro in l.origem.erros:
            l.excecao(erro)
        if l.origem.execucao_unica:
            l.excecao("Execução Única")

    # 2. De/Para do serviço excedente.
    etapa("de_para")
    for l in linhas:
        m = de_para.get(l.origem.cod_servico)
        if m is None or not m.utilizavel:
            l.excecao(f"sem De/Para do serviço {l.origem.cod_servico}")
            continue
        l.cod_excedente = m.cod_excedente
        l.n_cod_serv = m.n_cod_serv_excedente
        l.desc_excedente = m.descricao_excedente
        l.categoria = m.categoria_excedente
        if m.a_confirmar:
            l.avisos.append(AVISO_MAPEAMENTO)

    # 3. cliente por CNPJ e contrato que contém o serviço recorrente.
    etapa("clientes_contratos")
    for l in linhas:
        if not l.origem.cnpj_digitos:
            continue
        l.n_cod_cli = await fonte.cliente_por_cnpj(l.origem.cnpj_digitos)
        if l.n_cod_cli is None:
            l.excecao("cliente não encontrado pelo CNPJ")
            continue
        candidatos = await fonte.contratos_ativos_do_cliente(l.n_cod_cli)
        m = de_para.get(l.origem.cod_servico)
        escolhido, restantes = _contrato_da_linha(
            candidatos, m.n_cod_serv_recorrente if m else None)
        l.contratos_candidatos = sorted({c.numero for c in restantes if c.numero})
        if escolhido is None:
            numeros = ",".join(l.contratos_candidatos) or "nenhum ativo"
            l.excecao(f"contrato não identificado ({numeros})")
            continue
        l.numero_contrato = escolhido.numero
        l.n_cod_ctr = escolhido.n_cod_ctr
        l.n_dia_fat = escolhido.n_dia_fat

        # Roteamento: contrato com dia de faturamento 2 → fatura o excedente
        # DENTRO do contrato (não cria OS). Reconciliação: se o serviço de
        # excedente já está no contrato, atualiza o valor; senão, inclui.
        if escolhido.fatura_no_contrato:
            l.forma_faturamento = "contrato"
            if l.n_cod_serv:
                item = escolhido.item_de_servico(l.n_cod_serv)
                if item is not None:
                    l.contrato_acao = "atualizar"
                    l.contrato_valor_atual = item.valor_total
                else:
                    l.contrato_acao = "incluir"

    # 4. detalhe do contrato (e-mail/venc/categoria) — consulta individual,
    #    uma por contrato distinto; e detalhe do cliente para as exceções
    #    (resolver "criar sem contrato" na tela não exige nova consulta).
    etapa("detalhes_contratos")
    detalhes = {}
    for l in linhas:
        if l.status == "excecao" or l.n_cod_ctr is None:
            continue
        if l.forma_faturamento == "contrato":
            continue  # faturado no contrato: não precisa e-mail/venc de OS
        if l.n_cod_ctr not in detalhes:
            detalhes[l.n_cod_ctr] = await fonte.consultar_contrato(l.n_cod_ctr)
        det = detalhes[l.n_cod_ctr]
        v = venc_mod.calcular(hoje, comp, det.regra_venc)
        l.venc_contrato = v.base_contrato
        l.venc_final = v.data
        l.regra_venc = v.regra
        l.email_envio = det.email_envio
        l.n_cod_cc = det.n_cod_cc
        l.cidade_prest = det.cidade_prest
        if not det.email_envio:
            l.avisos.append(AVISO_SEM_EMAIL)

    etapa("detalhes_clientes")
    clientes = {}
    for l in linhas:
        if l.status == "excecao" and l.n_cod_cli and l.email_envio is None:
            if l.n_cod_cli not in clientes:
                clientes[l.n_cod_cli] = await fonte.consultar_cliente(l.n_cod_cli)
            det = clientes[l.n_cod_cli]
            l.email_envio = det.email
            if det.cidade and not l.cidade_prest:
                l.cidade_prest = det.cidade

    # 5. idempotência: cCodIntOS e checagem de OS já existente no Omie.
    etapa("idempotencia")
    existentes: dict[str, object] = {}

    async def _achar(codigo: str):
        if codigo not in existentes:
            existentes[codigo] = await fonte.os_existente(codigo)
        return existentes[codigo]

    for l in linhas:
        if l.forma_faturamento == "contrato":
            continue  # fatura no contrato: não gera OS, não checa cCodIntOS
        if l.status != "excecao":
            l.codigo_int_os = c_cod_int_os(
                competencia, l.numero_contrato, l.origem.cnpj_digitos)
            achada = await _achar(l.codigo_int_os)
            if achada is not None and l.status == "ok":
                l.status = "ja_existe"
                l.os_existente_n_cod = achada.n_cod_os
                l.os_existente_numero = achada.numero
            continue
        # Exceção pode já ter OS criada numa rodada anterior — ex.: contrato
        # que era ativo quando a OS foi criada e foi cancelado depois (caso
        # real MONTRONI, contrato 861, nov/2026). Testa o código de cada
        # contrato do cliente (qualquer situação) e o código sem contrato,
        # para o reenvio nunca duplicar.
        if l.n_cod_cli is None:
            continue
        tentativas: list[tuple[str, object]] = [
            (c_cod_int_os(competencia, c.numero, l.origem.cnpj_digitos), c)
            for c in await fonte.contratos_do_cliente(l.n_cod_cli) if c.numero
        ]
        tentativas.append(
            (c_cod_int_os(competencia, None, l.origem.cnpj_digitos), None))
        for codigo, contrato in tentativas:
            achada = await _achar(codigo)
            if achada is None:
                continue
            l.status = "ja_existe"
            l.codigo_int_os = codigo
            l.os_existente_n_cod = achada.n_cod_os
            l.os_existente_numero = achada.numero
            if contrato is not None:
                l.numero_contrato = contrato.numero
                l.n_cod_ctr = contrato.n_cod_ctr
            break

    for l in linhas:
        l.origem.cliente = nome_limpo(l.origem.cliente)

    return Plano(
        competencia=competencia,
        hoje=hoje,
        linhas=linhas,
        erros_estrutura=planilha.erros_estrutura,
        ignoradas=len(planilha.ignoradas),
    )
