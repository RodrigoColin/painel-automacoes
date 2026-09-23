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
from .duplicidade import buscar_linhas_ja_existentes
from .omie_cash import verificar_contas_omie_cash

__all__ = [
    "AplicacaoTitulo", "Candidato", "Desfecho", "Faixa", "LinhaExtrato", "Natureza",
    "RegraCliente", "Resultado", "TipoExcecao", "Titulo",
    "Config", "Contexto", "conciliar", "resumir",
    "Calibracao", "Decisao", "calibrar", "extrair_padrao",
    "registrar_decisao", "regras_de_json", "regras_para_json",
    "ConfigEscrita", "Gravacao", "gravar", "planejar",
    "buscar_linhas_ja_existentes", "verificar_contas_omie_cash",
]
