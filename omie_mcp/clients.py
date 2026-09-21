"""
Registro de clientes da Proos e suas credenciais Omie.

A Proos atende vários clientes de BPO financeiro, e cada um tem sua
própria conta/credenciais no Omie. Este módulo resolve "qual cliente eu
quero consultar" para "qual App Key/App Secret usar" — é o que permite
todas as tools do MCP terem um parâmetro `cliente` (slug) escolhendo a
empresa certa antes de chamar a API do Omie.

Fonte dos dados: arquivo `clientes_omie.json` na raiz do projeto — NUNCA
commitado (está no .gitignore, assim como .env). Veja
`clientes_omie.example.json` para o formato esperado.

Compatibilidade com uso de cliente único: se `clientes_omie.json` não
existir, mas OMIE_APP_KEY/OMIE_APP_SECRET estiverem no ambiente (.env), um
único cliente "default" é criado automaticamente a partir deles — quem já
estava usando o MCP para uma empresa só continua funcionando sem precisar
migrar para o JSON.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from .config import OmieConfigError, OmieSettings

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # python-dotenv é opcional
    pass


class ClientesConfigError(OmieConfigError):
    """Erro de configuração do registro de clientes (arquivo ausente/inválido, slug não encontrado etc.)."""


@dataclass(frozen=True)
class ClienteOmie:
    slug: str
    nome: str
    app_key: str
    app_secret: str
    ativo: bool = True


def _clients_file_path() -> Path:
    return Path(os.getenv("OMIE_CLIENTS_FILE", "clientes_omie.json"))


class ClientesRegistry:
    """Coleção de clientes Proos com suas credenciais Omie, indexada por slug."""

    def __init__(self, clientes: list[ClienteOmie]):
        self._por_slug: dict[str, ClienteOmie] = {c.slug: c for c in clientes}

    # -- construção -------------------------------------------------

    @classmethod
    def load(cls, path: Path | None = None) -> "ClientesRegistry":
        path = path or _clients_file_path()
        if path.exists():
            return cls._load_from_file(path)
        return cls._load_single_from_env()

    @classmethod
    def _load_from_file(cls, path: Path) -> "ClientesRegistry":
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ClientesConfigError(f"Não foi possível ler {path}: {exc}") from exc

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ClientesConfigError(f"{path} não é um JSON válido: {exc}") from exc

        itens = data.get("clientes")
        if not isinstance(itens, list) or not itens:
            raise ClientesConfigError(
                f"{path} precisa ter uma lista não-vazia em 'clientes' "
                "(veja clientes_omie.example.json)."
            )

        clientes: list[ClienteOmie] = []
        for i, item in enumerate(itens):
            try:
                clientes.append(
                    ClienteOmie(
                        slug=item["slug"],
                        nome=item.get("nome", item["slug"]),
                        app_key=str(item["omie_app_key"]).strip(),
                        app_secret=str(item["omie_app_secret"]).strip(),
                        ativo=item.get("ativo", True),
                    )
                )
            except KeyError as exc:
                raise ClientesConfigError(
                    f"{path}: item #{i} sem o campo obrigatório {exc} "
                    "(esperado: slug, omie_app_key, omie_app_secret)."
                ) from exc

        slugs = [c.slug for c in clientes]
        duplicados = {s for s in slugs if slugs.count(s) > 1}
        if duplicados:
            raise ClientesConfigError(f"{path}: slugs duplicados: {sorted(duplicados)}")

        vazios = [c.slug for c in clientes if not c.app_key or not c.app_secret]
        if vazios:
            raise ClientesConfigError(
                f"{path}: cliente(s) com app_key/app_secret vazio: {vazios}"
            )

        return cls(clientes)

    @classmethod
    def _load_single_from_env(cls) -> "ClientesRegistry":
        app_key = os.getenv("OMIE_APP_KEY", "").strip()
        app_secret = os.getenv("OMIE_APP_SECRET", "").strip()
        if not app_key or not app_secret:
            raise ClientesConfigError(
                f"Nenhum {_clients_file_path()} encontrado, e OMIE_APP_KEY/"
                "OMIE_APP_SECRET também não estão configurados no ambiente. "
                "Configure um dos dois: clientes_omie.json (múltiplos "
                "clientes — veja clientes_omie.example.json) ou .env "
                "(cliente único — veja .env.example)."
            )
        return cls(
            [
                ClienteOmie(
                    slug="default",
                    nome="Padrão (via .env, cliente único)",
                    app_key=app_key,
                    app_secret=app_secret,
                )
            ]
        )

    # -- consulta -----------------------------------------------------

    def get(self, slug: str) -> ClienteOmie:
        cliente = self._por_slug.get(slug)
        if cliente is None:
            raise ClientesConfigError(
                f"Cliente '{slug}' não encontrado. Clientes configurados: "
                f"{', '.join(sorted(self._por_slug)) or '(nenhum)'}. "
                "Use a tool listar_clientes_proos para ver a lista."
            )
        if not cliente.ativo:
            raise ClientesConfigError(
                f"Cliente '{slug}' está marcado como inativo em "
                f"{_clients_file_path()}."
            )
        return cliente

    def listar(self, apenas_ativos: bool = False) -> list[ClienteOmie]:
        clientes = list(self._por_slug.values())
        if apenas_ativos:
            clientes = [c for c in clientes if c.ativo]
        return sorted(clientes, key=lambda c: c.nome)

    def resolver_slug(self, cliente: str | None) -> str:
        """
        Resolve qual slug usar quando `cliente` não foi informado
        explicitamente: se só houver um cliente ativo configurado, usa
        ele; caso contrário, exige que o chamador especifique.
        """
        if cliente:
            return cliente

        ativos = self.listar(apenas_ativos=True)
        if len(ativos) == 1:
            return ativos[0].slug
        if not ativos:
            raise ClientesConfigError("Nenhum cliente ativo configurado.")

        raise ClientesConfigError(
            "Múltiplos clientes Proos configurados — informe qual usar no "
            "parâmetro 'cliente'. Disponíveis: "
            f"{', '.join(c.slug for c in ativos)} "
            "(use a tool listar_clientes_proos para ver nomes)."
        )

    def settings_for(self, slug: str) -> OmieSettings:
        cliente = self.get(slug)
        return OmieSettings.for_cliente(cliente.app_key, cliente.app_secret)
