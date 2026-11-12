"""
Parser e validação da planilha mensal de excedentes da OYSTR.

Formato (aba única, cabeçalho na linha 1):
  A Nome Cliente · B CNPJ/CPF · C Decrição do Serviço (typo é do arquivo
  real) · D Cidade · E Estado · F Situação · G Categoria · H Líquido ·
  I Vigencia Inicial · J Ano Faturamento · K Mes Faturamento · L Codigo do
  servico · M Franquia · N Consumo · O Excedentes · P Valor item excedente ·
  Q Valor total excedentes · R marca (ok/v = já processada à mão, ignorar)

Regras:
  - Só linhas com a coluna R VAZIA são processáveis.
  - Valor da OS = coluna Q ("Valor total excedentes"); nunca recalcular
    pelo unitário (que vem arredondado).
  - Texto em célula numérica e duplicado (CNPJ+código do serviço entre as
    processáveis) viram erro de validação da linha, não do lote inteiro.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Any

# Cabeçalhos esperados (normalizados sem acento/caixa). A coluna R não tem
# cabeçalho — é identificada por posição (18ª), logo após a última esperada.
_CABECALHOS = [
    "nome cliente", "cnpj/cpf", "decricao do servico", "cidade", "estado",
    "situacao", "categoria", "liquido", "vigencia inicial", "ano faturamento",
    "mes faturamento", "codigo do servico", "franquia", "consumo",
    "excedentes", "valor item excedente", "valor total excedentes",
]
_COLUNAS_NUMERICAS = {
    "liquido": 7, "franquia": 12, "consumo": 13, "excedentes": 14,
    "valor_unit": 15, "valor_total": 16,
}


def _norm(texto: Any) -> str:
    s = str(texto or "").strip().lower()
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


@dataclass
class LinhaPlanilha:
    linha: int                      # nº da linha no xlsx (1-based, como no Excel)
    cliente: str = ""
    cnpj: str = ""                  # como veio (com máscara)
    descricao: str = ""
    cidade: str = ""
    estado: str = ""
    situacao: str = ""
    categoria: str = ""             # "RPA Recorrente" / "Presto Recorrente" / "Execução Unica"
    liquido: Decimal | None = None
    cod_servico: str = ""           # código humano do serviço recorrente (ex. "5573")
    franquia: Decimal | None = None
    consumo: Decimal | None = None
    excedentes: Decimal | None = None
    valor_unit: Decimal | None = None
    valor_total: Decimal | None = None
    marca: str = ""                 # coluna R
    erros: list[str] = field(default_factory=list)

    @property
    def processavel(self) -> bool:
        return not self.marca

    @property
    def cnpj_digitos(self) -> str:
        return "".join(c for c in self.cnpj if c.isdigit())

    @property
    def execucao_unica(self) -> bool:
        return "unica" in _norm(self.categoria)


@dataclass
class PlanilhaLida:
    linhas: list[LinhaPlanilha]
    erros_estrutura: list[str]      # problema no arquivo inteiro (cabeçalho etc.)

    @property
    def processaveis(self) -> list[LinhaPlanilha]:
        return [l for l in self.linhas if l.processavel]

    @property
    def ignoradas(self) -> list[LinhaPlanilha]:
        return [l for l in self.linhas if not l.processavel]


def _decimal(valor: Any, rotulo: str, erros: list[str]) -> Decimal | None:
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        return None
    if isinstance(valor, bool):
        erros.append(f"{rotulo}: valor não numérico ({valor!r})")
        return None
    try:
        if isinstance(valor, str):
            texto = valor.strip().replace(".", "").replace(",", ".") \
                if "," in valor else valor.strip()
            return Decimal(texto)
        return Decimal(str(valor))
    except (InvalidOperation, ValueError):
        erros.append(f"{rotulo}: valor não numérico ({valor!r})")
        return None


def ler(conteudo: bytes) -> PlanilhaLida:
    """Lê o xlsx (bytes) e devolve as linhas com validação por linha."""
    from openpyxl import load_workbook

    wb = load_workbook(BytesIO(conteudo), data_only=True, read_only=True)
    ws = wb.worksheets[0]
    iterador = ws.iter_rows(values_only=True)

    try:
        cabecalho = next(iterador)
    except StopIteration:
        return PlanilhaLida([], ["Planilha vazia."])

    erros_estrutura: list[str] = []
    lidos = [_norm(c) for c in cabecalho[: len(_CABECALHOS)]]
    for i, esperado in enumerate(_CABECALHOS):
        lido = lidos[i] if i < len(lidos) else ""
        if lido != esperado:
            erros_estrutura.append(
                f"Coluna {chr(ord('A') + i)}: esperado \"{esperado}\", veio \"{lido}\"."
            )
    if erros_estrutura:
        return PlanilhaLida([], erros_estrutura)

    linhas: list[LinhaPlanilha] = []
    for num, valores in enumerate(iterador, start=2):
        v = list(valores) + [None] * (18 - len(valores))
        if all(c is None or str(c).strip() == "" for c in v[:17]):
            continue  # linha totalmente vazia
        erros: list[str] = []
        linha = LinhaPlanilha(
            linha=num,
            cliente=str(v[0] or "").strip(),
            cnpj=str(v[1] or "").strip(),
            descricao=str(v[2] or "").strip(),
            cidade=str(v[3] or "").strip(),
            estado=str(v[4] or "").strip(),
            situacao=str(v[5] or "").strip(),
            categoria=str(v[6] or "").strip(),
            liquido=_decimal(v[7], "Líquido", erros),
            cod_servico=str(v[11] or "").strip().removesuffix(".0"),
            franquia=_decimal(v[12], "Franquia", erros),
            consumo=_decimal(v[13], "Consumo", erros),
            excedentes=_decimal(v[14], "Excedentes", erros),
            valor_unit=_decimal(v[15], "Valor item excedente", erros),
            valor_total=_decimal(v[16], "Valor total excedentes", erros),
            marca=str(v[17] or "").strip(),
            erros=erros,
        )
        if linha.processavel:
            if not linha.cnpj_digitos:
                erros.append("CNPJ/CPF vazio ou inválido.")
            if not linha.cod_servico:
                erros.append("Código do serviço vazio.")
            if linha.valor_total is None:
                erros.append("Valor total excedentes vazio.")
            elif linha.valor_total <= 0:
                erros.append(f"Valor total excedentes não positivo ({linha.valor_total}).")
        linhas.append(linha)

    # Duplicado = mesmo CNPJ + código de serviço entre as processáveis.
    vistos: dict[tuple[str, str], int] = {}
    for linha in linhas:
        if not linha.processavel:
            continue
        chave = (linha.cnpj_digitos, linha.cod_servico)
        if chave in vistos:
            linha.erros.append(
                f"Duplicada: mesmo CNPJ e serviço da linha {vistos[chave]}."
            )
        else:
            vistos[chave] = linha.linha

    return PlanilhaLida(linhas, [])
