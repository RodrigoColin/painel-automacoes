"""
Cliente HTTP genérico para a API do Omie.

A API do Omie funciona toda no mesmo padrão, independente do módulo:

    POST https://app.omie.com.br/api/v1/<modulo>/<recurso>/
    Content-Type: application/json
    {
        "call": "<NomeDaChamada>",
        "app_key": "...",
        "app_secret": "...",
        "param": [ { ...parâmetros da chamada... } ]
    }

Este módulo é intencionalmente independente de MCP: ele é a camada que,
no futuro, o backend FastAPI da Plataforma Proos pode importar diretamente
(omie_mcp.client / omie_mcp.tools), sem depender do protocolo MCP. O
servidor MCP (server.py) é só mais um consumidor desta camada.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

import httpx

from .config import OmieSettings

logger = logging.getLogger("proos.omie_mcp")


class OmieAPIError(RuntimeError):
    """Erro de negócio retornado pela API do Omie (faultstring/faultcode)."""

    def __init__(self, message: str, fault_code: str | None = None, payload: Any = None):
        super().__init__(message)
        self.fault_code = fault_code
        self.payload = payload


class OmieNotFoundError(OmieAPIError):
    """Consulta sem registros encontrados (não é um erro real, é 'lista vazia')."""


# Faultcodes conhecidos que indicam "nenhum registro encontrado" — o Omie
# trata isso como erro de negócio em vez de retornar uma lista vazia.
_NOT_FOUND_FAULTCODES = {
    "SOAP-ENV:Client-114",
}
_NOT_FOUND_MESSAGE_HINTS = (
    "não foram encontrados registros",
    "nenhum registro encontrado",
)

# Faultcodes/mensagens que indicam limite de requisições excedido — vale a
# pena tentar novamente com backoff.
_RATE_LIMIT_MESSAGE_HINTS = (
    "limite de excesso de requisi",
    "consumo indevido",
    "muitas requisi",
    "consumo redundante",
    # "Já existe uma requisição desse método sendo executada e você pode
    # tentar novamente em alguns instantes." — travado em 2026-08-07 rodando
    # o refresh do Oystr: é um lock de concorrência do Omie (duas chamadas
    # pro MESMO método ao mesmo tempo), não throttle de volume, mas o
    # tratamento é igual (erro transitório, esperar e tentar de novo) — não
    # vem "aguarde N segundos" nessa mensagem, então cai no backoff padrão.
    "já existe uma requisi",
)

# Mensagens que indicam falha transitória do LADO DO SERVIDOR do Omie (não
# é erro de negócio nem rate limit) — encontrado em 2026-08-11 (Rodrigo):
# "SOAP-ERROR: Empty response from server" no meio de uma busca de Contas a
# Pagar, matando o script inteiro sem tentar de novo. Isso é o Omie
# devolvendo uma resposta vazia/incompleta pontualmente (não reproduziu de
# novo no mesmo ponto), então vale a pena tratar como transitório e tentar
# de novo, igual a um HTTP 5xx.
# "SOAP-ERROR: Failed to talk with application server (cError: 28)" —
# achado em 2026-08-13 (Rodrigo): matou o script logo na PRIMEIRA chamada
# de "Buscando títulos em aberto (Contas a Receber)" de uma rodada nova
# (nem chegou a tentar de novo, porque antes desse fix qualquer faultstring
# sem bater nos hints de rate-limit/transitório ia direto pro
# `raise OmieAPIError` final, sem retry nenhum). É outra falha pontual de
# backend do Omie (erro genérico de comunicação interna do servidor deles,
# "cError" é código interno da aplicação Omie) — mesmo tratamento dos
# outros dois hints acima: tentar de novo com backoff em vez de derrubar o
# relatório inteiro na primeira ocorrência.
# "SOAP-ERROR: Internal Error [PBB]" — achado em 2026-09-23 (Rodrigo): matou
# o script na etapa "Buscando títulos em aberto (Contas a Pagar)", logo após
# a etapa de Contas a Receber ter funcionado normalmente. Mesma família dos
# hints acima (erro genérico de backend do Omie, "[PBB]" é um código interno
# deles, igual em espírito ao "cError: 28") — só que o hint "internal server
# error" não batia porque essa mensagem não tem a palavra "server". Hint
# genérico "internal error" cobre esse caso e qualquer variação parecida.
_TRANSIENT_SERVER_MESSAGE_HINTS = (
    "empty response from server",
    "erro interno",
    "internal server error",
    "internal error",
    "failed to talk with application server",
)

# Trecho específico da mensagem de lock de concorrência acima — precisa de
# um backoff PRÓPRIO (ver _CONCORRENCIA_ESPERA_S abaixo), não o exponencial
# padrão. Confirmado em 2026-08-08: reagir rápido demais a esse erro (2s,
# depois 4s) não dava tempo do lock do Omie liberar E ainda disparava um
# bloqueio bem mais duro por cima ("Consumo redundante detectado", 55s+) —
# ou seja, o backoff curto demais estava causando o próprio agravamento.
# Pode acontecer mesmo numa PRIMEIRA tentativa "nova" (não repetição do
# nosso próprio código) se outro processo/integração estiver usando a
# MESMA chave de API do Omie ao mesmo tempo (ex.: outro conector Omie
# conectado à mesma conta) — nesse caso o único jeito de eliminar de vez é
# não rodar duas coisas contra a mesma conta ao mesmo tempo; o backoff aqui
# só reduz a chance de escalar pro bloqueio duro, não elimina o erro em si.
_CONCORRENCIA_MESMO_METODO_HINT = "já existe uma requisi"


_PADRAO_SEGUNDOS_ESPERA = re.compile(r"aguarde\s+(\d+)\s+segundos?", re.IGNORECASE)


def _extrair_segundos_de_espera(mensagem: str) -> float | None:
    """Extrai '57' de mensagens do tipo 'Aguarde 57 segundos para tentar
    novamente', se presente. Limita a 90s por segurança (evita travar uma
    tentativa por tempo indefinido caso a mensagem mude de formato)."""
    m = _PADRAO_SEGUNDOS_ESPERA.search(mensagem)
    if not m:
        return None
    return min(float(m.group(1)) + 1, 90.0)


class _RateLimiter:
    """Limitador simples de requisições/segundo (token bucket de 1 slot)."""

    def __init__(self, max_per_second: float):
        self._min_interval = 1.0 / max_per_second if max_per_second > 0 else 0.0
        self._lock = asyncio.Lock()
        self._last_call = 0.0

    async def wait(self) -> None:
        if self._min_interval <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_call
            wait_time = self._min_interval - elapsed
            if wait_time > 0:
                await asyncio.sleep(wait_time)
            self._last_call = time.monotonic()


class OmieClient:
    """Cliente assíncrono para chamadas à API do Omie."""

    def __init__(self, settings: OmieSettings | None = None):
        self.settings = settings or OmieSettings.from_env()
        self._rate_limiter = _RateLimiter(self.settings.max_requests_per_second)
        self._http: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "OmieClient":
        self._http = httpx.AsyncClient(timeout=self.settings.timeout_seconds)
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def _get_http(self) -> httpx.AsyncClient:
        if self._http is None:
            # Permite uso sem context manager (cria client on-demand),
            # útil quando chamado a partir de código síncrono/um-off.
            self._http = httpx.AsyncClient(timeout=self.settings.timeout_seconds)
        return self._http

    async def call(
        self,
        module_path: str,
        call: str,
        params: dict[str, Any] | list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Executa uma chamada genérica à API do Omie.

        module_path: caminho do módulo, ex. "geral/clientes",
                     "financas/contapagar", "servicos/contrato".
        call: nome da chamada, ex. "ListarClientes".
        params: dict único (mais comum) ou lista de dicts — sempre enviado
                como lista para a API, conforme padrão do Omie.
        """
        if params is None:
            param_list: list[dict[str, Any]] = [{}]
        elif isinstance(params, dict):
            param_list = [params]
        else:
            param_list = params

        url = f"{self.settings.base_url}/{module_path.strip('/')}/"
        body = {
            "call": call,
            "app_key": self.settings.app_key,
            "app_secret": self.settings.app_secret,
            "param": param_list,
        }

        http = await self._get_http()

        last_error: Exception | None = None
        for attempt in range(1, self.settings.max_retries + 1):
            await self._rate_limiter.wait()
            try:
                # Trava de segurança PRÓPRIA, além do timeout já configurado
                # no httpx.AsyncClient (self.settings.timeout_seconds) —
                # achado em 2026-08-10 (Rodrigo, Windows/Python 3.14): uma
                # conexão pode travar esperando resposta da rede
                # indefinidamente SEM o timeout do httpx/anyio disparar
                # (reproduzido 2x seguidas, mesmo ponto exato do código,
                # com --desde bem curto na segunda vez — descartando "só
                # lento por causa de volume"). asyncio.wait_for() força a
                # desistência no tempo certo mesmo se a camada de baixo
                # nível não disparar seu próprio timeout.
                response = await asyncio.wait_for(
                    http.post(url, json=body), timeout=self.settings.timeout_seconds
                )
            except (httpx.RequestError, TimeoutError) as exc:
                last_error = exc
                logger.warning("Omie call %s falhou (tentativa %d): %s", call, attempt, exc)
                # Falha de rede (não é o Omie: DNS, Wi-Fi, VPN, laptop que
                # hibernou/travou a tela) — achado em 2026-08-11 (Rodrigo):
                # "[Errno 11001] getaddrinfo failed" (DNS falhou) 4x
                # seguidas, esgotou as tentativas e derrubou um relatório
                # que já levava mais de 1h rodando. Teto de espera mais
                # alto (30s em vez de 10s) dá mais chance de sobreviver a
                # uma queda breve de rede sem perder o progresso todo.
                await asyncio.sleep(min(2 ** attempt, 30))
                continue

            data: Any
            try:
                data = response.json()
            except ValueError:
                response.raise_for_status()
                raise OmieAPIError(
                    f"Resposta não-JSON da API Omie para {call} (HTTP {response.status_code})",
                    payload=response.text,
                )

            if isinstance(data, dict) and "faultstring" in data:
                fault_code = data.get("faultcode")
                message = data.get("faultstring", "")
                lowered = message.lower()

                if fault_code in _NOT_FOUND_FAULTCODES or any(
                    hint in lowered for hint in _NOT_FOUND_MESSAGE_HINTS
                ):
                    raise OmieNotFoundError(message, fault_code=fault_code, payload=data)

                if any(hint in lowered for hint in _RATE_LIMIT_MESSAGE_HINTS):
                    last_error = OmieAPIError(message, fault_code=fault_code, payload=data)
                    # O Omie às vezes informa exatamente quantos segundos esperar
                    # (ex.: "Consumo redundante detectado. Aguarde 57 segundos
                    # para tentar novamente") — se vier, usa esse tempo em vez de
                    # qualquer backoff calculado.
                    espera_sugerida = _extrair_segundos_de_espera(message)
                    if espera_sugerida:
                        espera = espera_sugerida
                    elif _CONCORRENCIA_MESMO_METODO_HINT in lowered:
                        # Backoff mais generoso e quase fixo (não exponencial a
                        # partir de um valor baixo) — ver comentário em
                        # _CONCORRENCIA_MESMO_METODO_HINT acima.
                        espera = min(5 + 3 * (attempt - 1), 20)
                    else:
                        espera = min(2 ** attempt, 15)
                    logger.warning(
                        "Omie rate limit em %s (tentativa %d): %s — aguardando %ss",
                        call, attempt, message, espera,
                    )
                    await asyncio.sleep(espera)
                    continue

                if any(hint in lowered for hint in _TRANSIENT_SERVER_MESSAGE_HINTS):
                    last_error = OmieAPIError(message, fault_code=fault_code, payload=data)
                    espera = min(2 ** attempt, 10)
                    logger.warning(
                        "Omie erro transitório de servidor em %s (tentativa %d): %s — "
                        "aguardando %ss",
                        call, attempt, message, espera,
                    )
                    await asyncio.sleep(espera)
                    continue

                raise OmieAPIError(message, fault_code=fault_code, payload=data)

            if response.status_code >= 500 or response.status_code == 429:
                # 429 encontrado em 2026-08-11 (Rodrigo): chegou até aqui com
                # JSON válido e SEM "faultstring" (por isso não caiu no bloco
                # de rate limit acima, que só olha faultstring), e o
                # response.raise_for_status() logo abaixo derrubava o script
                # inteiro em vez de tentar de novo. HTTP 429 é, por
                # definição, "muitas requisições" — sempre vale tentar de
                # novo com backoff, igual a um 5xx. Respeita o header
                # Retry-After se o servidor mandar.
                retry_after = response.headers.get("Retry-After")
                if response.status_code == 429 and retry_after:
                    try:
                        espera = min(float(retry_after), 90.0)
                    except ValueError:
                        espera = min(2 ** attempt, 10)
                else:
                    espera = min(2 ** attempt, 10)
                last_error = OmieAPIError(
                    f"HTTP {response.status_code} da API Omie para {call}", payload=data
                )
                logger.warning(
                    "Omie HTTP %s em %s (tentativa %d) — aguardando %ss",
                    response.status_code, call, attempt, espera,
                )
                await asyncio.sleep(espera)
                continue

            response.raise_for_status()
            return data

        assert last_error is not None
        raise last_error

    async def call_paginated(
        self,
        module_path: str,
        call: str,
        params: dict[str, Any] | None = None,
        registros_por_pagina: int = 50,
        max_paginas: int | None = None,
        records_key: str | list[str] = (),
    ) -> list[dict[str, Any]]:
        """
        Percorre todas as páginas de uma chamada "Listar*" e retorna a lista
        completa de registros.

        `records_key` é o nome (ou lista de nomes candidatos) do campo que
        contém a lista dentro da resposta — isso varia por endpoint (ex.
        "clientes_cadastro", "conta_pagar_cadastro", "categoria_cadastro") e
        nem sempre está 100% documentado publicamente. Se nenhum dos
        candidatos for encontrado, o cliente tenta detectar automaticamente
        qual campo da resposta é uma lista de registros (excluindo campos de
        metadados de paginação) e loga um aviso — vale conferir/ajustar o
        records_key correto em omie_mcp/tools/*.py depois do primeiro teste
        real (task de "Testar conexão com Omie").
        """
        params = dict(params or {})
        candidates = [records_key] if isinstance(records_key, str) else list(records_key)
        pagina = 1
        all_records: list[dict[str, Any]] = []

        while True:
            params["pagina"] = pagina
            params["registros_por_pagina"] = registros_por_pagina

            try:
                data = await self.call(module_path, call, params)
            except OmieNotFoundError:
                break

            records = self._extract_records(data, candidates, call)
            all_records.extend(records)

            total_paginas = data.get("total_de_paginas", pagina)
            if pagina >= total_paginas:
                break
            if max_paginas is not None and pagina >= max_paginas:
                break
            pagina += 1

        return all_records

    _METADATA_KEYS = {
        "pagina",
        "total_de_paginas",
        "total_de_registros",
        "registros_por_pagina",
        "faultstring",
        "faultcode",
    }

    def _extract_records(
        self, data: dict[str, Any], candidates: list[str], call: str
    ) -> list[dict[str, Any]]:
        for key in candidates:
            if key and key in data and isinstance(data[key], list):
                return data[key]

        # Fallback: primeira lista não-metadado encontrada na resposta.
        for key, value in data.items():
            if key in self._METADATA_KEYS:
                continue
            if isinstance(value, list):
                logger.warning(
                    "Omie call %s: records_key não confirmado, usando campo "
                    "'%s' detectado automaticamente. Confirme e fixe o "
                    "records_key correto em omie_mcp/tools/.",
                    call,
                    key,
                )
                return value

        logger.warning(
            "Omie call %s: nenhum campo de lista encontrado na resposta (chaves: %s)",
            call,
            list(data.keys()),
        )
        return []
