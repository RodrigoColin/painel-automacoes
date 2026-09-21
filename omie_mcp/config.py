"""
Configuração do cliente Omie.

As credenciais (App Key / App Secret) NUNCA devem ser hardcoded no código.
Elas são lidas de variáveis de ambiente (ou de um arquivo .env local via
python-dotenv, se presente).

Como obter App Key e App Secret:
  1. Acesse https://developer.omie.com.br/
  2. Clique em "Aplicativos"
  3. Selecione o aplicativo (ou crie um novo) e copie App Key / App Secret
  Alternativa: dentro do Omie, no card do seu aplicativo > engrenagem >
  "Resumo do App" > seção "Chave de Integração (API)".

Apenas usuários "administradores" da conta Omie conseguem gerar/ver essas
chaves.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # python-dotenv é opcional
    pass


class OmieConfigError(RuntimeError):
    """Erro de configuração: credenciais ausentes ou inválidas."""


@dataclass(frozen=True)
class OmieSettings:
    app_key: str
    app_secret: str
    base_url: str = "https://app.omie.com.br/api/v1"

    # Limite de segurança de requisições simultâneas/por segundo para não
    # estourar o limite de consumo da API do Omie. O valor exato do limite
    # contratual deve ser confirmado em:
    # https://ajuda.omie.com.br (artigo "Limites de Consumo da API do Omie"),
    # pois varia por plano. Este valor é uma configuração conservadora.
    max_requests_per_second: float = 3.0
    # Subido de 4 para 6 em 2026-08-11 (Rodrigo): relatórios longos (1h+)
    # esgotavam as 4 tentativas diante de uma queda breve de rede local
    # (Wi-Fi/VPN reconectando, laptop saindo de hibernação) e perdiam todo
    # o progresso já feito. Combinado com o teto de espera maior no erro
    # de rede (ver client.py), dá bem mais tolerância a esse tipo de blip.
    max_retries: int = 6
    timeout_seconds: float = 30.0

    @classmethod
    def from_env(cls) -> "OmieSettings":
        """
        Cria settings para um único cliente a partir de OMIE_APP_KEY/
        OMIE_APP_SECRET no ambiente. Mantido para compatibilidade e para
        uso simples de um cliente só — quando há múltiplos clientes Proos
        configurados, prefira `ClientesRegistry` (omie_mcp/clients.py), que
        chama `for_cliente()` internamente.
        """
        app_key = os.getenv("OMIE_APP_KEY", "").strip()
        app_secret = os.getenv("OMIE_APP_SECRET", "").strip()

        if not app_key or not app_secret:
            raise OmieConfigError(
                "OMIE_APP_KEY e/ou OMIE_APP_SECRET não configurados. "
                "Defina-os como variáveis de ambiente ou em um arquivo .env "
                "na raiz do projeto (veja .env.example), ou configure "
                "clientes_omie.json para múltiplos clientes (veja "
                "clientes_omie.example.json)."
            )

        return cls.for_cliente(app_key, app_secret)

    @classmethod
    def for_cliente(cls, app_key: str, app_secret: str) -> "OmieSettings":
        """
        Cria settings para um cliente específico (credenciais já resolvidas
        pelo chamador — normalmente via `ClientesRegistry`). Os parâmetros
        "operacionais" (base_url, rate limit, retries, timeout) continuam
        vindo do ambiente/.env, e são os mesmos para todos os clientes.
        """
        app_key = app_key.strip()
        app_secret = app_secret.strip()
        if not app_key or not app_secret:
            raise OmieConfigError("app_key/app_secret vazios para este cliente.")

        return cls(
            app_key=app_key,
            app_secret=app_secret,
            base_url=os.getenv("OMIE_BASE_URL", cls.base_url).rstrip("/"),
            max_requests_per_second=float(
                os.getenv("OMIE_MAX_REQUESTS_PER_SECOND", cls.max_requests_per_second)
            ),
            max_retries=int(os.getenv("OMIE_MAX_RETRIES", cls.max_retries)),
            timeout_seconds=float(
                os.getenv("OMIE_TIMEOUT_SECONDS", cls.timeout_seconds)
            ),
        )
