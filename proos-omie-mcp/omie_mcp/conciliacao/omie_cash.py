"""Guard contra processar a conta Omie.CASH — ela ja e conciliada
automaticamente pelo proprio Omie (decisao explicita do usuario,
2026-09-21); rodar o motor nela e trabalho desnecessario na melhor das
hipoteses e um risco de gravacao duplicada/conflitante na pior.

Promovido de scripts/conciliar.py pra ca (2026-09-22) pelo mesmo motivo de
omie_mcp/conciliacao/duplicidade.py: uma segunda chamada (scripts/
conciliar_extrato_painel.py) passou a precisar da mesma logica.
"""

from __future__ import annotations


async def verificar_contas_omie_cash(
    cliente_slug: str, contas: set[str], exigir: bool
) -> bool:
    """True se pode seguir; False se deve abortar.

    `exigir` distingue dois usos (achado real da revisao adversarial do
    Codex, 2026-09-21: o `except` generico liberava a execucao mesmo com
    --gravar ativo, numa falha transitoria da API — fail-OPEN num guard
    que devia ser fail-CLOSED):
      - `exigir=False` (checagem cedo, so informativa, antes de ler o
        OFX): se a API falhar, avisa e segue — nesse ponto ainda nem se
        sabe se e dry-run ou --gravar, e travar por uma instabilidade
        momentanea do Omie custa caro sem necessidade.
      - `exigir=True` (checagem final, logo antes de `--gravar` de
        verdade, cobrindo TODAS as contas que podem entrar num payload —
        lote, investimento, cartao, garantida e pendentes de rodadas
        anteriores): se a API falhar, ABORTA. Nao da pra arriscar
        escrever numa conta Omie.CASH so porque nao foi possivel
        confirmar que ela nao esta no lote.
    """
    from ..client import OmieClient
    from ..clients import ClientesRegistry
    from ..tools.contas_correntes import contas_omie_cash

    try:
        registry = ClientesRegistry.load()
        settings = registry.settings_for(cliente_slug)
        async with OmieClient(settings) as client:
            cash = {str(c) for c in await contas_omie_cash(client)}
    except Exception as exc:  # noqa: BLE001 — best-effort so quando exigir=False
        if exigir:
            print(f"\nABORTADO: nao deu pra confirmar que nenhuma conta do lote e "
                  f"Omie.CASH ({exc}) — com --gravar ativo isso bloqueia por "
                  "seguranca (fail-closed). Rode de novo quando a API do Omie "
                  "estiver respondendo.")
            return False
        print(f"\nAVISO: nao deu pra checar se alguma conta e Omie.CASH ({exc}). "
              "Seguindo sem essa checagem (dry-run, sem risco de escrita).")
        return True

    achadas = cash & contas
    if achadas:
        print(f"\nERRO: {', '.join(sorted(achadas))} e conta Omie.CASH — "
              "conciliada automaticamente pelo proprio Omie, nunca deve entrar "
              "no lote (--contas/--conta-omie/--conta-investimento/--conta-cartao/"
              "--conta-garantida, nem aparecer numa linha pendente de rodada "
              "anterior). Remova essa conta.")
        return False
    return True
