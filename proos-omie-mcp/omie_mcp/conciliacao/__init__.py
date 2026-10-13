"""Conciliacao bancaria da Proos — motor, parser, aprendizado e escrita."""
from .modelos import (
    AplicacaoTitulo, Candidato, Desfecho, Faixa, LinhaExtrato, Natureza,
    RecebimentoOmie, RegraCliente, Resultado, TipoExcecao, Titulo,
)
from .motor import Config, Contexto, conciliar, resumir
from .aprendizado import (
    Calibracao, Decisao, calibrar, extrair_padrao, registrar_decisao,
    regras_de_json, regras_para_json,
)
from .escrita_omie import (
    AtualizacaoValorTitulo, ConfigEscrita, Gravacao, executar_atualizacao_valor,
    gravar, planejar, planejar_atualizacao_valor_titulo,
)
from .recorrencia import AmbiguidadeRecorrencia, localizar_titulo_recorrente_seguinte
from .duplicidade import buscar_linhas_ja_existentes, coletar_linhas_ja_existentes
from .recebimentos import buscar_recebimentos, coletar_recebimentos
from .bases_omie import coletar_titulos_abertos
from .omie_cash import verificar_contas_omie_cash

__all__ = [
    "AplicacaoTitulo", "Candidato", "Desfecho", "Faixa", "LinhaExtrato", "Natureza",
    "RecebimentoOmie", "RegraCliente", "Resultado", "TipoExcecao", "Titulo",
    "Config", "Contexto", "conciliar", "resumir",
    "Calibracao", "Decisao", "calibrar", "extrair_padrao",
    "registrar_decisao", "regras_de_json", "regras_para_json",
    "ConfigEscrita", "Gravacao", "gravar", "planejar",
    "AtualizacaoValorTitulo", "executar_atualizacao_valor", "planejar_atualizacao_valor_titulo",
    "AmbiguidadeRecorrencia", "localizar_titulo_recorrente_seguinte",
    "buscar_linhas_ja_existentes", "coletar_linhas_ja_existentes",
    "buscar_recebimentos", "coletar_recebimentos",
    "coletar_titulos_abertos", "verificar_contas_omie_cash",
]
