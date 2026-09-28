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
from typing import Optional

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
    # uuid da empresa no painel-automacoes (Supabase) — o elo de confianca
    # entre "qual credencial Omie usar" (slug) e "sob qual tenant gravar
    # dado financeiro" (empresa_id/RLS). Fica AQUI, no mesmo arquivo
    # confidencial das credenciais, de proposito: nunca deve ser um
    # parametro de linha de comando digitavel a mao — achado real da
    # revisao adversarial do Codex, 2026-09-21, sobre
    # scripts/validar_saldo_diario.py: um --empresa-id livre permite
    # atribuir (por erro de digitacao/copy-paste) o saldo real de um
    # cliente ao tenant de OUTRO cliente no painel. Opcional aqui porque
    # nem todo cliente/uso precisa gravar no painel.
    empresa_id: Optional[str] = None


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
                        # Opcional a partir de 2026-09-28: cliente com
                        # empresa_id busca a credencial no Infisical em vez
                        # de guardar o segredo aqui (ver settings_for()) —
                        # so' fica obrigatorio pra quem NAO tem empresa_id.
                        app_key=str(item.get("omie_app_key", "")).strip(),
                        app_secret=str(item.get("omie_app_secret", "")).strip(),
                        ativo=item.get("ativo", True),
                        empresa_id=item.get("empresa_id") or None,
                    )
                )
            except KeyError as exc:
                raise ClientesConfigError(
                    f"{path}: item #{i} sem o campo obrigatório {exc} "
                    "(esperado: slug)."
                ) from exc

        slugs = [c.slug for c in clientes]
        duplicados = {s for s in slugs if slugs.count(s) > 1}
        if duplicados:
            raise ClientesConfigError(f"{path}: slugs duplicados: {sorted(duplicados)}")

        # Sem credencial NENHUMA das duas formas (arquivo ou Infisical via
        # empresa_id) — aí sim e' erro de configuracao, nao da pra seguir.
        sem_credencial = [
            c.slug for c in clientes
            if not (c.app_key and c.app_secret) and c.empresa_id is None
        ]
        if sem_credencial:
            raise ClientesConfigError(
                f"{path}: cliente(s) sem app_key/app_secret e sem empresa_id "
                f"(nenhuma forma de achar a credencial): {sem_credencial}"
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
        if cliente.app_key and cliente.app_secret:
            return OmieSettings.for_cliente(cliente.app_key, cliente.app_secret)

        # Sem app_key/app_secret em clientes_omie.json: busca no Infisical
        # (decisao 2026-09-28 — Oystr e Scopo ja estao la, novos clientes
        # entram so' pelo Infisical, sem duplicar segredo em arquivo). Exige
        # empresa_id porque e' a unica forma de achar a pasta certa.
        if cliente.empresa_id is None:
            raise ClientesConfigError(
                f"Cliente '{slug}' sem app_key/app_secret em "
                f"{_clients_file_path()} e sem empresa_id configurado pra "
                "buscar no Infisical — preencha um dos dois."
            )
        from . import infisical  # import tardio: so exige httpx/DATABASE_URL/Infisical quando usado

        app_key, app_secret = infisical.buscar_credenciais_omie(cliente.empresa_id)
        return OmieSettings.for_cliente(app_key, app_secret)

    def resolver_por_empresa_id(self, empresa_id: str) -> Optional[ClienteOmie]:
        """
        O elo inverso de `ClienteOmie.empresa_id`: dado o uuid da empresa no
        painel-automacoes, acha qual cliente/credencial Omie foi vinculado a
        ela. Devolve None (nao levanta) quando nenhum cliente tem esse
        empresa_id configurado ainda — a maioria das empresas do painel nao
        tem vinculo hoje, e isso e' estado normal, nao erro.
        Levanta so em caso de dado inconsistente (o mesmo empresa_id
        configurado em 2+ clientes — isso sim precisa ser corrigido no
        clientes_omie.json antes de confiar em qualquer um dos dois).
        """
        encontrados = [c for c in self._por_slug.values() if c.empresa_id == empresa_id]
        if len(encontrados) > 1:
            raise ClientesConfigError(
                f"empresa_id '{empresa_id}' esta configurado em mais de um "
                f"cliente ({', '.join(c.slug for c in encontrados)}) — corrija "
                f"{_clients_file_path()} antes de continuar."
            )
        return encontrados[0] if encontrados else None
