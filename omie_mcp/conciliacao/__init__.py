"""Conciliacao bancaria da Proos — motor, parser, aprendizado e escrita."""
from .modelos import (
    AplicacaoTitulo, Candidato, Desfecho, Faixa, LinhaExtrato, Natureza,
    RegraCliente, Resultado, TipoExcecao, Titulo,
)
from .motor import Config, Contexto, conciliar, resumir
from .aprendizado import (
    Calibracao, Decisao, calibrar, extrair_padrao, registrar_decisao,
    regras_de_json, regras_para_json,
)
from .escrita_omie import ConfigEscrita, Gravacao, gravar, planejar

__all__ = [
    "AplicacaoTitulo", "Candidato", "Desfecho", "Faixa", "LinhaExtrato", "Natureza",
    "RegraCliente", "Resultado", "TipoExcecao", "Titulo",
    "Config", "Contexto", "conciliar", "resumir",
    "Calibracao", "Decisao", "calibrar", "extrair_padrao",
    "registrar_decisao", "regras_de_json", "regras_para_json",
    "ConfigEscrita", "Gravacao", "gravar", "planejar",
]
