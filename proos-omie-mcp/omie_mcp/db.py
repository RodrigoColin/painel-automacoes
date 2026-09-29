"""
Camada de escrita em banco de dados (PostgreSQL) — alternativa/complemento
ao Excel para os dados que hoje só existem no Oystr_Diagnostico_Consolidado.xlsx.

Princípio de desenho (deliberado): este módulo NUNCA recalcula nada. Ele só
recebe as MESMAS estruturas de dados que `omie_mcp/reports/oystr_diagnostico.
py::montar_relatorio()` e `scripts/analise_faturamento_mrr.py` já produzem em
memória (as mesmas que hoje viram linhas de planilha) e grava elas como estão
— toda a lógica de negócio (qual data usar, como filtrar conta de perda/
prejuízo, como cruzar título com contrato, como validar status pra churn,
etc., ver os docstrings de oystr_diagnostico.py e analise_faturamento_mrr.py)
continua vivendo só naqueles dois módulos. Isso é intencional: essa lógica
já levou dezenas de bugs reais corrigidos um a um contra dados de produção
(ver claude/proos-omie-mcp.md) — reimplementar/duplicar qualquer parte dela
aqui seria reintroduzir risco de regressão sem necessidade nenhuma.

Cada execução grava um lote carimbado com um `rodada_id` novo — nunca
sobrescreve nem apaga uma rodada anterior (mesmo princípio que Rodrigo já
escolheu pro nome de arquivo do Excel: timestamp, não sobrescrita). "Os
dados de agora" é sempre a rodada CONCLUÍDA mais recente por empresa/tipo —
ver as views v_* no schema (db/schema.sql).

Uso típico (ver o hook `--banco` em scripts/refresh_oystr_diagnostico.py e
scripts/analise_faturamento_mrr.py para o fluxo completo):

    import db

    conn = db.conectar()  # lê DATABASE_URL do ambiente
    db.garantir_schema(conn)  # idempotente — aplica db/schema.sql se preciso

    rodada_id = db.nova_rodada(conn, empresa="oystr", tipo="diagnostico",
                                data_de="01/08/2026", data_ate="04/09/2026",
                                parametros={"desde": "...", "ate": "..."})
    try:
        db.gravar_titulos_movimento(conn, rodada_id, "oystr", dados)  # dados = montar_relatorio(...)
        db.concluir_rodada(conn, rodada_id, status="concluida")
    except Exception as exc:
        db.concluir_rodada(conn, rodada_id, status="falhou", erro=str(exc))
        raise

Configuração
------------
A connection string vem SEMPRE da variável de ambiente `DATABASE_URL`
(formato padrão do Postgres: postgresql://usuario:senha@host:porta/banco) —
nunca hardcoded, mesmo padrão de cautela já usado pra `clientes_omie.json`
(nunca commitado, fica de fora do git). Se `DATABASE_URL` não estiver
definida, `conectar()` levanta `RuntimeError` com uma mensagem explicando o
que fazer — nunca falha silenciosamente nem tenta adivinhar um valor padrão
(um banco de dados financeiro errado por padrão silencioso é pior que um
erro alto e claro).

Dependência nova: `psycopg[binary]>=3.1` (adicionar ao requirements/
pyproject do projeto). Só usado quando `--banco` é passado — os scripts
continuam funcionando sem banco nenhum instalado, exatamente como hoje.
"""

from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

try:
    import psycopg
    from psycopg.types.json import Json
except ImportError as _exc:  # pragma: no cover — mensagem melhor que o ImportError cru
    raise ImportError(
        "O módulo 'psycopg' não está instalado. Rode "
        "`pip install \"psycopg[binary]\"` (ou adicione ao requirements do "
        "projeto) antes de usar --banco. O restante do pipeline (Excel) "
        "continua funcionando sem essa dependência."
    ) from _exc


_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "db" / "schema.sql"


def conectar(database_url: str | None = None) -> "psycopg.Connection":
    """Abre uma conexão com o banco. `database_url` normalmente vem de
    `DATABASE_URL` no ambiente (nunca hardcoded) — ver docstring do módulo.
    autocommit=True porque cada função de escrita abaixo já é uma unidade
    lógica pequena (uma rodada, um lote de linhas); não há necessidade de
    uma transação longa cobrindo o pipeline inteiro (que já pode rodar por
    mais de uma hora, ver histórico de resiliência em oystr_diagnostico.py —
    uma transação aberta por tanto tempo só criaria um risco novo)."""
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL não definida. Configure a variável de ambiente "
            "(ex.: postgresql://usuario:senha@host:5432/proos_omie) antes de "
            "rodar com --banco. Nunca coloque a connection string direto no "
            "código nem no clientes_omie.json — trate como outra credencial "
            "sensível (mesmo cuidado já usado pra app_key/app_secret do Omie)."
        )
    conn = psycopg.connect(url, autocommit=True)
    return conn


def garantir_schema(conn: "psycopg.Connection") -> None:
    """Aplica db/schema.sql — idempotente (todo CREATE é IF NOT EXISTS /
    OR REPLACE), seguro de chamar em toda execução antes de gravar."""
    sql = _SCHEMA_PATH.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)


# --- Datas: os scripts usam dd/mm/aaaa (string) e/ou date(); aceita os dois --

def _para_date(valor: Any) -> date | None:
    if valor is None or valor == "":
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, str):
        try:
            return datetime.strptime(valor, "%d/%m/%Y").date()
        except ValueError:
            return None
    return None


# --- 1. Rodadas -------------------------------------------------------------

def nova_rodada(
    conn: "psycopg.Connection",
    empresa: str,
    tipo: str,
    data_de: Any = None,
    data_ate: Any = None,
    parametros: dict | None = None,
    origem: str | None = None,
) -> int:
    """Abre uma rodada nova (status='em_andamento') e devolve o `rodada_id`
    — chame ANTES de começar a buscar dados no Omie, assim uma rodada que
    cai no meio (rede, rate limit, etc. — ver o histórico extenso de
    resiliência de rede em oystr_diagnostico.py) fica registrada como
    'falhou' (ver `concluir_rodada`) em vez de simplesmente não aparecer em
    lugar nenhum."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO rodadas_extracao
                (empresa, tipo, data_de, data_ate, parametros, origem)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (empresa, tipo, _para_date(data_de), _para_date(data_ate),
             Json(parametros) if parametros is not None else None, origem),
        )
        return cur.fetchone()[0]


def concluir_rodada(
    conn: "psycopg.Connection", rodada_id: int, status: str, erro: str | None = None
) -> None:
    """status: 'concluida' ou 'falhou'. Chame em um `finally`/`except` —
    ver o exemplo no docstring do módulo — pra nunca deixar uma rodada
    travada em 'em_andamento' pra sempre depois de uma queda."""
    if status not in ("concluida", "falhou"):
        raise ValueError(f"status inválido: {status!r} (use 'concluida' ou 'falhou')")
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE rodadas_extracao
            SET status = %s, erro = %s, concluido_em = now()
            WHERE id = %s
            """,
            (status, erro, rodada_id),
        )


# --- 2. titulos_movimento (de relatorio.montar_relatorio()) -----------------

# Mapa: tipo -> (nome da lista dentro do dict `dados`, nome da coluna de
# "valor realizado" dentro de cada linha, nome da coluna de data "previsão").
_TIPOS_TITULOS_MOVIMENTO = {
    "receber_aberto": ("base_receber_aberto", "Recebido", "Previsão"),
    "pagar_aberto": ("base_pagar_aberto", "Valor Pago", "Previsão"),
    "recebimento": ("base_recebimentos", "Recebido", None),
    "pagamento": ("base_pagamentos", "Valor Pago", None),
    "contrato_nao_faturado": ("base_contratos_nao_faturados", "Valor Mensal", "Data Prevista"),
    "os_nao_faturada": ("base_os_nao_faturadas", "Valor", "Data Prevista"),
}


def _linha_titulo_movimento(tipo: str, linha: dict[str, Any], col_valor_realizado: str,
                             col_previsao: str | None) -> tuple:
    # Campos que só existem em algumas das 6 origens — .get() com default
    # None cobre isso sem precisar de 6 funções de linha separadas.
    return (
        tipo,
        linha.get("Cliente/Fornecedor") or linha.get("Razão Social"),
        linha.get("CNPJ/CPF"),
        linha.get("Categoria"),
        _para_date(linha.get("Emissão")),
        _para_date(linha.get("Vencimento")),
        _para_date(linha.get(col_previsao)) if col_previsao else None,
        _para_date(linha.get("Data de Crédito ou Débito (No Extrato)")),
        linha.get("Documento"),
        linha.get("Conta Corrente"),
        linha.get("Valor da Conta"),
        linha.get(col_valor_realizado),
        linha.get("conciliado"),
        linha.get("status_titulo"),
        linha.get("codigo_lancamento_omie"),
        linha.get("codigo_cliente_fornecedor"),
        linha.get("cNumeroContrato") or linha.get("Contrato") or linha.get("OS"),
    )


def gravar_titulos_movimento(
    conn: "psycopg.Connection", rodada_id: int, empresa: str, dados: dict[str, Any]
) -> int:
    """Grava as 6 listas do dict devolvido por
    `omie_mcp.reports.oystr_diagnostico.montar_relatorio()` (base_receber_
    aberto, base_pagar_aberto, base_recebimentos, base_pagamentos,
    base_contratos_nao_faturados, base_os_nao_faturadas) na tabela
    `titulos_movimento`, todas carimbadas com o mesmo `rodada_id`. Devolve
    o total de linhas gravadas."""
    linhas_para_gravar: list[tuple] = []
    for tipo, (chave_lista, col_valor, col_previsao) in _TIPOS_TITULOS_MOVIMENTO.items():
        for linha in dados.get(chave_lista, []):
            linhas_para_gravar.append(
                _linha_titulo_movimento(tipo, linha, col_valor, col_previsao)
            )

    if not linhas_para_gravar:
        return 0

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO titulos_movimento (
                rodada_id, empresa, tipo, cliente, cnpj_cpf, categoria,
                emissao, vencimento, previsao, data_credito_debito,
                documento, conta_corrente, valor_conta, valor_realizado,
                conciliado, status_titulo, codigo_lancamento_omie,
                codigo_cliente_fornecedor, numero_contrato
            ) VALUES (
                %(rodada_id)s, %(empresa)s, %(tipo)s, %(cliente)s, %(cnpj_cpf)s,
                %(categoria)s, %(emissao)s, %(vencimento)s, %(previsao)s,
                %(data_credito_debito)s, %(documento)s, %(conta_corrente)s,
                %(valor_conta)s, %(valor_realizado)s, %(conciliado)s,
                %(status_titulo)s, %(codigo_lancamento_omie)s,
                %(codigo_cliente_fornecedor)s, %(numero_contrato)s
            )
            """,
            [
                dict(zip(
                    ["tipo", "cliente", "cnpj_cpf", "categoria", "emissao", "vencimento",
                     "previsao", "data_credito_debito", "documento", "conta_corrente",
                     "valor_conta", "valor_realizado", "conciliado", "status_titulo",
                     "codigo_lancamento_omie", "codigo_cliente_fornecedor", "numero_contrato"],
                    linha,
                ), rodada_id=rodada_id, empresa=empresa)
                for linha in linhas_para_gravar
            ],
        )
    return len(linhas_para_gravar)


# --- 3. faturamento_linhas (de analise_faturamento_mrr.py: linhas) ---------

def gravar_faturamento_linhas(
    conn: "psycopg.Connection", rodada_id: int, empresa: str, linhas: Iterable[dict[str, Any]]
) -> int:
    """Grava `linhas` (a lista combinada linhas_historicas + linhas_
    projetadas de scripts/analise_faturamento_mrr.py::main(), cada item no
    formato produzido por montar_linhas_faturamento()/
    montar_linhas_projetadas()) na tabela `faturamento_linhas`. Devolve o
    total de linhas gravadas.

    `cliente_chave` grava `cod_cli` como veio (pode ser int OU a string
    sintética "nome:<cliente>" do fallback sem código reconhecido — ver
    montar_linhas_projetadas) — a coluna é TEXT de propósito, pra nunca
    perder essa distinção; `codigo_cliente_omie` fica NULL nesse caso."""
    linhas = list(linhas)
    if not linhas:
        return 0

    registros = []
    for linha in linhas:
        cod_cli = linha.get("cod_cli")
        codigo_cliente_omie = cod_cli if isinstance(cod_cli, int) else None
        cliente_chave = str(cod_cli) if cod_cli is not None else f"cliente:{linha.get('cliente', '')}"
        emissao = _para_date(linha["emissao"])
        registros.append({
            "rodada_id": rodada_id,
            "empresa": empresa,
            "codigo_cliente_omie": codigo_cliente_omie,
            "cliente_chave": cliente_chave,
            "cliente": linha.get("cliente", ""),
            "categoria": linha["categoria"],
            "contrato": linha.get("contrato") or None,
            "emissao": emissao,
            "periodo": linha["periodo"],
            "periodo_data": emissao.replace(day=1) if emissao else None,
            "valor": linha["valor"],
            "realizado": linha["realizado"],
        })

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO faturamento_linhas (
                rodada_id, empresa, codigo_cliente_omie, cliente_chave, cliente,
                categoria, contrato, emissao, periodo, periodo_data, valor, realizado
            ) VALUES (
                %(rodada_id)s, %(empresa)s, %(codigo_cliente_omie)s, %(cliente_chave)s,
                %(cliente)s, %(categoria)s, %(contrato)s, %(emissao)s, %(periodo)s,
                %(periodo_data)s, %(valor)s, %(realizado)s
            )
            """,
            registros,
        )
    return len(registros)


# --- 3b. validacao_saldo_diario (banco x Omie, dia a dia) -------------------

def gravar_saldo_diario(
    conn: "psycopg.Connection",
    empresa_id: str,
    conta_id: str,
    conta_descricao: str | None,
    saldos_banco: dict[Any, Any],
    saldos_omie: dict[Any, Any],
    fonte_extrato: str,
    movimentos_banco: dict[Any, Any] | None = None,
    movimentos_omie: dict[Any, Any] | None = None,
) -> int:
    """Grava/atualiza a validacao de saldo diario (banco x Omie) na tabela
    `public.validacao_saldo_diario` — mesma tabela que o painel-automacoes
    le (migration 0037+0039, mesmo Supabase/DATABASE_URL do painel, NAO um
    banco separado). Uma linha por conta+dia; upsert por proposito (ON
    CONFLICT), nao um lote tipo `rodada_id` — reprocessar um periodo so
    atualiza o valor daquele dia, nunca duplica.

    `saldos_banco`/`saldos_omie`: dict {date: Decimal}, tipicamente
    `ofx.saldo_por_dia()` e `extrato.saldo_por_dia()` — saldo ACUMULADO. A
    UNIAO das datas dos dois vira uma linha (dia so de um dos lados fica
    com o outro campo NULL, ainda assim visivel no painel como "sem dado
    desse lado").

    `movimentos_banco`/`movimentos_omie`: dict {date: Decimal}, tipicamente
    `ofx.movimento_por_dia()` e `extrato.movimento_por_dia()` — a variacao
    do PROPRIO dia, sem acumular (pedido do usuario, 2026-09-21, pra achar
    EM QUE DIA um problema comecou, nao so que existe). Opcionais porque
    linhas gravadas antes da migration 0039 nao tinham isso.
    """
    movimentos_banco = movimentos_banco or {}
    movimentos_omie = movimentos_omie or {}
    dias = sorted(set(saldos_banco) | set(saldos_omie))
    if not dias:
        return 0

    registros = [
        {
            "empresa_id": empresa_id,
            "conta_id": conta_id,
            "conta_descricao": conta_descricao,
            "data": d,
            "saldo_banco": saldos_banco.get(d),
            "saldo_omie": saldos_omie.get(d),
            "movimento_banco": movimentos_banco.get(d),
            "movimento_omie": movimentos_omie.get(d),
            "fonte_extrato": fonte_extrato,
        }
        for d in dias
    ]

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO public.validacao_saldo_diario (
                empresa_id, conta_id, conta_descricao, data,
                saldo_banco, saldo_omie, movimento_banco, movimento_omie,
                fonte_extrato
            ) VALUES (
                %(empresa_id)s, %(conta_id)s, %(conta_descricao)s, %(data)s,
                %(saldo_banco)s, %(saldo_omie)s, %(movimento_banco)s,
                %(movimento_omie)s, %(fonte_extrato)s
            )
            ON CONFLICT (empresa_id, conta_id, data) DO UPDATE SET
                conta_descricao = EXCLUDED.conta_descricao,
                saldo_banco     = EXCLUDED.saldo_banco,
                saldo_omie      = EXCLUDED.saldo_omie,
                movimento_banco = EXCLUDED.movimento_banco,
                movimento_omie  = EXCLUDED.movimento_omie,
                fonte_extrato   = EXCLUDED.fonte_extrato,
                atualizado_em   = now()
            """,
            registros,
        )
    return len(registros)


# --- 4. contratos_status (de analise_faturamento_mrr.py:
#        montar_status_por_cliente()) -----------------------------------

def gravar_contratos_status(
    conn: "psycopg.Connection", rodada_id: int, empresa: str,
    status_por_cliente: dict[int, dict[str, Any]],
) -> int:
    """Grava `status_por_cliente` (dict cod_cli -> {"contratos": [...],
    "status_set": {...}} de montar_status_por_cliente()) na tabela
    `contratos_status`, uma linha por CONTRATO (não por cliente — um
    cliente pode ter mais de um contrato com status diferentes, ver
    validacao_churn() em analise_faturamento_mrr.py). Devolve o total de
    linhas gravadas."""
    registros = []
    for cod_cli, info in status_por_cliente.items():
        for contrato in info.get("contratos", []):
            registros.append({
                "rodada_id": rodada_id,
                "empresa": empresa,
                "codigo_cliente_omie": cod_cli,
                "numero_contrato": contrato.get("nCodCtr"),
                "cod_sit_bruto": contrato.get("cCodSit"),
                "status": contrato.get("status", ""),
                "valor_mensal": contrato.get("valor_mensal"),
                "vigencia_inicial": _para_date(contrato.get("vigencia_inicial")),
                "vigencia_final": _para_date(contrato.get("vigencia_final")),
            })

    if not registros:
        return 0

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO contratos_status (
                rodada_id, empresa, codigo_cliente_omie, numero_contrato,
                cod_sit_bruto, status, valor_mensal, vigencia_inicial, vigencia_final
            ) VALUES (
                %(rodada_id)s, %(empresa)s, %(codigo_cliente_omie)s, %(numero_contrato)s,
                %(cod_sit_bruto)s, %(status)s, %(valor_mensal)s, %(vigencia_inicial)s,
                %(vigencia_final)s
            )
            """,
            registros,
        )
    return len(registros)


# --- 5. caixa_pacote_diario (painel-automacoes, migration 0004) -------------
# O pacote do fluxo de caixa que a tela "Fluxo de caixa" le. Quem grava e' a
# rodada do container `caixa` (caixa/rodada.py), as 10h e as 16h.

def gravar_pacote_caixa_diario(
    conn: "psycopg.Connection",
    empresa_id: str,
    data_ref: date,
    manifesto: dict,
    recebimentos: list,
    pagamentos: list,
    receber_aberto: list,
    pagar_aberto: list,
    contratos_nao_faturados: list,
    os_nao_faturadas: list,
    status_contratos: list,
    extrato: dict | None = None,
    extra: dict | None = None,
    checagem: dict | None = None,
) -> None:
    """Grava/atualiza o pacote diario do painel de fluxo de caixa em
    `public.caixa_pacote_diario` (mesmo DATABASE_URL do painel-automacoes,
    NAO um banco separado). Uma linha por empresa+dia; upsert (ON CONFLICT)
    — reprocessar um dia sobrescreve, nunca duplica, mesmo padrao de
    `gravar_saldo_diario` acima.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.caixa_pacote_diario (
                empresa_id, data, manifesto, recebimentos, pagamentos,
                receber_aberto, pagar_aberto, contratos_nao_faturados,
                os_nao_faturadas, status_contratos, extrato, extra, checagem
            ) VALUES (
                %(empresa_id)s, %(data)s, %(manifesto)s, %(recebimentos)s,
                %(pagamentos)s, %(receber_aberto)s, %(pagar_aberto)s,
                %(contratos_nao_faturados)s, %(os_nao_faturadas)s,
                %(status_contratos)s, %(extrato)s, %(extra)s, %(checagem)s
            )
            ON CONFLICT (empresa_id, data) DO UPDATE SET
                manifesto               = EXCLUDED.manifesto,
                recebimentos            = EXCLUDED.recebimentos,
                pagamentos              = EXCLUDED.pagamentos,
                receber_aberto          = EXCLUDED.receber_aberto,
                pagar_aberto            = EXCLUDED.pagar_aberto,
                contratos_nao_faturados = EXCLUDED.contratos_nao_faturados,
                os_nao_faturadas        = EXCLUDED.os_nao_faturadas,
                status_contratos        = EXCLUDED.status_contratos,
                extrato                 = EXCLUDED.extrato,
                extra                   = EXCLUDED.extra,
                checagem                = EXCLUDED.checagem,
                atualizado_em           = now()
            """,
            {
                "empresa_id": empresa_id,
                "data": data_ref,
                "manifesto": Json(manifesto),
                "recebimentos": Json(recebimentos),
                "pagamentos": Json(pagamentos),
                "receber_aberto": Json(receber_aberto),
                "pagar_aberto": Json(pagar_aberto),
                "contratos_nao_faturados": Json(contratos_nao_faturados),
                "os_nao_faturadas": Json(os_nao_faturadas),
                "status_contratos": Json(status_contratos),
                "extrato": Json(extrato) if extrato is not None else None,
                "extra": Json(extra) if extra is not None else None,
                "checagem": Json(checagem) if checagem is not None else None,
            },
        )


# --- 6. Infisical: caminho da pasta de credenciais por empresa -------------
# So o CAMINHO ate as credenciais (config publica, sem segredo nenhum) —
# omie_mcp/infisical.py e quem efetivamente busca OMIE_APP_KEY/APP_SECRET
# no Infisical, usando esse caminho. Mesmas tabelas que src/lib/infisical/
# clientes.ts (Next.js) ja le/escreve.

def buscar_config_infisical(conn: "psycopg.Connection", empresa_id: str) -> tuple[str, str, str] | None:
    """(projeto_id, ambiente, caminho) da pasta Infisical de uma empresa, ou
    None se a integracao nao estiver configurada ou a empresa ainda nao
    tiver pasta criada (ver tela Configuracoes/Resumo Omie do painel)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT projeto_id, ambiente FROM public.integracao_infisical_plataforma WHERE id = true"
        )
        linha_config = cur.fetchone()
        if linha_config is None:
            return None
        projeto_id, ambiente = linha_config

        cur.execute(
            "SELECT caminho FROM public.infisical_caminhos_clientes WHERE empresa_id = %s",
            (empresa_id,),
        )
        linha_caminho = cur.fetchone()
        if linha_caminho is None:
            return None
        (caminho,) = linha_caminho

    return projeto_id, ambiente, caminho
