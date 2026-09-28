"""Testes de `ClientesRegistry.resolver_por_empresa_id` — o elo inverso que
liga uma empresa do painel-automacoes (uuid) ao cliente/credencial Omie
certo. Achado real (Proos, 2026-09-22): a tela de Conciliacao Bancaria do
painel precisa saber "essa empresa que enviou o extrato e' qual cliente Omie
pra mim" antes de poder rodar o motor completo — sem isso, so da pra
confirmar que o extrato foi lido, nunca casar titulo.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omie_mcp.clients import ClientesRegistry, ClienteOmie, ClientesConfigError  # noqa: E402

falhas = []


def checar(n: str, c: bool, d: str = "") -> None:
    print(("  ok   " if c else "  FALHA ") + n + ("" if c else f" — {d}"))
    if not c:
        falhas.append(n)


print("\nResolver por empresa_id — caso simples")
registro = ClientesRegistry(
    [
        ClienteOmie(slug="fulano", nome="Fulano LTDA", app_key="k1", app_secret="s1",
                    empresa_id="aaaa-1111"),
        ClienteOmie(slug="ciclano", nome="Ciclano SA", app_key="k2", app_secret="s2",
                    empresa_id="bbbb-2222"),
        ClienteOmie(slug="sem-vinculo", nome="Sem Vinculo LTDA", app_key="k3", app_secret="s3"),
    ]
)

achado = registro.resolver_por_empresa_id("aaaa-1111")
checar("acha o cliente certo pelo empresa_id", achado is not None and achado.slug == "fulano", achado)

achado2 = registro.resolver_por_empresa_id("bbbb-2222")
checar("acha o segundo cliente, nao confunde com o primeiro",
       achado2 is not None and achado2.slug == "ciclano", achado2)

nao_achado = registro.resolver_por_empresa_id("cccc-9999")
checar("empresa_id desconhecido -> None, nao levanta (a maioria das empresas nao tem vinculo ainda)",
       nao_achado is None, nao_achado)

nao_achado2 = registro.resolver_por_empresa_id("")
checar("empresa_id vazio -> None (cliente sem vinculo tem empresa_id=None, nunca bate com string vazia)",
       nao_achado2 is None, nao_achado2)

print("\nResolver por empresa_id — ambiguidade (dado inconsistente)")
registro_ambiguo = ClientesRegistry(
    [
        ClienteOmie(slug="fulano", nome="Fulano LTDA", app_key="k1", app_secret="s1",
                    empresa_id="aaaa-1111"),
        ClienteOmie(slug="fulano-duplicado", nome="Fulano Duplicado", app_key="k4", app_secret="s4",
                    empresa_id="aaaa-1111"),
    ]
)
try:
    registro_ambiguo.resolver_por_empresa_id("aaaa-1111")
    checar("2 clientes com o mesmo empresa_id deveria levantar", False)
except ClientesConfigError:
    checar("2 clientes com o mesmo empresa_id -> levanta (dado inconsistente, nunca escolhe um)", True)

print("\nsettings_for — credencial no arquivo tem prioridade, Infisical e' so' fallback")
# Achado 2026-09-28: Oystr/Scopo ja tem app_key/app_secret no Infisical;
# clientes_omie.json passa a guardar so' o indice (slug/empresa_id), sem
# segredo nenhum. settings_for() decide qual fonte usar por linha.
import omie_mcp.infisical as infisical_mod  # noqa: E402

registro_misto = ClientesRegistry(
    [
        ClienteOmie(slug="com-arquivo", nome="Com Arquivo", app_key="kx", app_secret="sx"),
        ClienteOmie(slug="so-infisical", nome="So Infisical", app_key="", app_secret="",
                    empresa_id="cccc-3333"),
    ]
)

settings_arquivo = registro_misto.settings_for("com-arquivo")
checar("cliente com app_key/app_secret no arquivo usa direto (nao chama Infisical)",
       settings_arquivo.app_key == "kx" and settings_arquivo.app_secret == "sx")

chamadas = []
infisical_mod.buscar_credenciais_omie = lambda empresa_id: (chamadas.append(empresa_id) or ("ki", "si"))
settings_infisical = registro_misto.settings_for("so-infisical")
checar("cliente sem credencial no arquivo busca no Infisical pelo empresa_id certo",
       chamadas == ["cccc-3333"], chamadas)
checar("usa a credencial devolvida pelo Infisical",
       settings_infisical.app_key == "ki" and settings_infisical.app_secret == "si")

print("\nCarregar do arquivo — sem app_key/secret E sem empresa_id e' erro de configuracao")
import json
import tempfile
from pathlib import Path as _Path

with tempfile.TemporaryDirectory() as tmp:
    caminho = _Path(tmp) / "clientes_omie.json"
    caminho.write_text(json.dumps({"clientes": [
        {"slug": "orfao", "nome": "Orfao"},  # sem omie_app_key/secret, sem empresa_id
    ]}), encoding="utf-8")
    try:
        ClientesRegistry.load(caminho)
        checar("cliente sem nenhuma forma de credencial deveria levantar ao carregar", False)
    except ClientesConfigError:
        checar("sem app_key/secret e sem empresa_id -> levanta no load(), nao silencioso", True)

with tempfile.TemporaryDirectory() as tmp:
    caminho = _Path(tmp) / "clientes_omie.json"
    caminho.write_text(json.dumps({"clientes": [
        {"slug": "so-empresa-id", "nome": "So Empresa Id", "empresa_id": "dddd-4444"},
    ]}), encoding="utf-8")
    registro_carregado = ClientesRegistry.load(caminho)
    checar("cliente so' com empresa_id (sem app_key/secret) carrega sem erro",
           registro_carregado.get("so-empresa-id").empresa_id == "dddd-4444")

print("\n" + "=" * 50)
if falhas:
    print(f"{len(falhas)} FALHA(S): {falhas}")
    sys.exit(1)
print("Todos os testes passaram.")
