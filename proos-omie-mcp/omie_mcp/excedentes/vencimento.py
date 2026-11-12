"""
Vencimento da OS de excedentes — regra 7 da skill, validada pelo gabarito
de novembro/2026:

  1. Base = vencimento do CONTRATO na competência (vencTextos): dia fixo do
     mês (nDiaFixo, fallback nDiaFat), no mês da competência ou no seguinte
     quando o contrato cobra no mês seguinte (cProxMes='S'). Contrato por
     "N dias após o faturamento" (nDias>0) usa hoje + nDias.
  2. Se a base já passou ou faltam até 2 dias corridos: hoje + 3 dias úteis.
  3. Base em dia não útil segue a regra do contrato: cPostergar='S' → dia
     útil seguinte; cAntecipar='S' → dia útil anterior; sem flag, posterga
     (comportamento observado no relatório nativo do Omie).
  4. OS sem contrato: hoje + 3 dias úteis.

Dia útil = seg-sex fora de feriado nacional (bancário): fixos + móveis
(Carnaval seg/ter, Sexta-feira Santa, Corpus Christi). Feriados municipais
ficam de fora de propósito (decisão Rodrigo 2026-11-12): a rede bancária
empurra o pagamento para o dia útil seguinte na prática.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache


def _pascoa(ano: int) -> date:
    """Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)."""
    a = ano % 19
    b, c = divmod(ano, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes, dia = divmod(h + l - 7 * m + 114, 31)
    return date(ano, mes, dia + 1)


@lru_cache(maxsize=32)
def feriados_nacionais(ano: int) -> frozenset[date]:
    pascoa = _pascoa(ano)
    fixos = [(1, 1), (4, 21), (5, 1), (9, 7), (10, 12), (11, 2), (11, 15),
             (11, 20), (12, 25)]
    moveis = [
        pascoa - timedelta(days=48),   # segunda de Carnaval
        pascoa - timedelta(days=47),   # terça de Carnaval
        pascoa - timedelta(days=2),    # Sexta-feira Santa
        pascoa + timedelta(days=60),   # Corpus Christi
    ]
    return frozenset([date(ano, m, d) for m, d in fixos] + moveis)


def eh_dia_util(d: date) -> bool:
    return d.weekday() < 5 and d not in feriados_nacionais(d.year)


def proximo_dia_util(d: date) -> date:
    while not eh_dia_util(d):
        d += timedelta(days=1)
    return d


def dia_util_anterior(d: date) -> date:
    while not eh_dia_util(d):
        d -= timedelta(days=1)
    return d


def somar_dias_uteis(d: date, n: int) -> date:
    while n > 0:
        d += timedelta(days=1)
        if eh_dia_util(d):
            n -= 1
    return d


def _ultimo_dia_do_mes(ano: int, mes: int) -> int:
    proximo = date(ano + (mes == 12), mes % 12 + 1, 1)
    return (proximo - timedelta(days=1)).day


@dataclass(frozen=True)
class RegraContrato:
    """Recorte de vencTextos/cabecalho do contrato que importa aqui."""
    dia_fixo: int = 0          # vencTextos.nDiaFixo
    dias_apos: int = 0         # vencTextos.nDias (vence N dias após faturar)
    dia_faturamento: int = 0   # cabecalho.nDiaFat (fallback do dia fixo)
    postergar: bool = True     # vencTextos.cPostergarVenc == 'S' (default observado)
    antecipar: bool = False    # vencTextos.cAntecipaVenc == 'S'
    proximo_mes: bool = False  # cobra no mês seguinte à competência


@dataclass(frozen=True)
class Vencimento:
    data: date
    regra: str | None          # texto explicativo quando saiu da data nominal
    base_contrato: date | None # vencimento nominal do contrato (se houve)


def _mais_tres_uteis(hoje: date, base: date | None, motivo: str) -> Vencimento:
    return Vencimento(somar_dias_uteis(hoje, 3), motivo, base)


def calcular(hoje: date, competencia: tuple[int, int],
             contrato: RegraContrato | None) -> Vencimento:
    """Vencimento da OS. `competencia` = (ano, mês) do lote."""
    if contrato is None:
        return _mais_tres_uteis(hoje, None, "sem contrato → hoje + 3 dias úteis")

    ano, mes = competencia
    if contrato.proximo_mes:
        ano, mes = (ano + 1, 1) if mes == 12 else (ano, mes + 1)

    if contrato.dias_apos > 0 and contrato.dia_fixo <= 0:
        base = hoje + timedelta(days=contrato.dias_apos)
    else:
        dia = contrato.dia_fixo if contrato.dia_fixo > 0 else contrato.dia_faturamento
        if dia <= 0:
            return _mais_tres_uteis(
                hoje, None, "contrato sem dia de vencimento → hoje + 3 dias úteis")
        base = date(ano, mes, min(dia, _ultimo_dia_do_mes(ano, mes)))

    if base <= hoje + timedelta(days=2):
        return _mais_tres_uteis(
            hoje, base,
            f"contrato vence em {base.strftime('%d/%m')} (passou/≤2 dias) → +3 dias úteis",
        )

    if eh_dia_util(base):
        return Vencimento(base, None, base)
    if contrato.antecipar and not contrato.postergar:
        ajustada = dia_util_anterior(base)
        regra = f"{base.strftime('%d/%m')} não útil → antecipado"
    else:
        ajustada = proximo_dia_util(base)
        regra = f"{base.strftime('%d/%m')} não útil → postergado"
    if ajustada <= hoje + timedelta(days=2):
        return _mais_tres_uteis(
            hoje, base,
            f"contrato vence em {ajustada.strftime('%d/%m')} (passou/≤2 dias) → +3 dias úteis",
        )
    return Vencimento(ajustada, regra, base)
