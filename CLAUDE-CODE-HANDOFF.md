# Handoff para Claude Code — Conciliacao bancaria no Portal Proos

Contexto completo do projeto: `claude/proos-omie-mcp.md` e
`claude/proos-handoff-dev-2026-09-09.md` (na raiz do Portal Proos).
Este pacote adiciona o modulo de conciliacao. Leia nesta ordem:

1. `LEIA-ME.md` — o que e cada peca, os 4 desfechos, a ordem de avaliacao
2. `VALIDACAO-2026-09-20.md` — falhas ja corrigidas, o que ficou aberto, riscos
3. `design/LEIA-ME.md` + os 5 artboards — as telas alvo
4. o codigo em `omie_mcp/conciliacao/` e os 3 CLIs em `scripts/`

## Onde isso vive

Copiar o conteudo desta pasta para dentro de `proos-omie-mcp/` (o repo real,
NAO a copia sincronizada no OneDrive — ver ways-of-working). Estrutura final:

    proos-omie-mcp/
    ├── omie_mcp/conciliacao/    (novo)
    ├── scripts/conciliar.py, modo_sombra.py, exportar_base_sombra.py  (novos)
    ├── tests/test_motor.py, test_aprendizado_escrita.py, test_regressao_validacao.py
    ├── db/schema_conciliacao.sql  (novo, complementa db/schema.sql)
    ├── design/                    (referencia visual)
    └── fila_conciliacao.html      (protótipo standalone, sera substituido pelo backend)

Rodar `python tests/test_*.py` — as 3 suites precisam passar antes de qualquer coisa.

## Restricoes que nao mudam

- Python puro no motor (`motor.py`, `aprendizado.py`, `ofx.py`): sem rede,
  sem dependencia do Omie. E o que permite testar em qualquer lugar.
- A API do Omie NAO e alcancavel a partir de sandboxes. Tudo que chama o Omie
  roda no terminal do Rodrigo ou no VPS. Nunca "consertar" isso.
- Escrita no ERP: dry-run e o padrao. `--gravar` exige `--confirmo-escrita <slug>`,
  respeita teto de gravacoes e trava de lote. Manter.
- Idempotencia por `conta + linha_id`. No backend, e o indice unico
  `ux_match_linha_gravada` do schema — nunca um arquivo JSON.
- Ordem de avaliacao do motor e deliberada (ver docstring de `motor.py`).
  Nao reordenar sem reler VALIDACAO F1/F2/F3.

## Tarefas, em ordem

### Fase 0 — validar contra dado real (Rodrigo roda, Claude Code prepara)
- [ ] Conferir os pontos marcados `CONFERIR` em `scripts/exportar_base_sombra.py`
      contra as assinaturas reais de `omie_mcp.tools.*` e `omie_mcp.clients`.
- [ ] Exportador: aplicar margem de 20 dias no vencimento (para tras e para frente).
- [ ] Modo sombra: tolerar ±1 dia no casamento gabarito por data|valor
      (DTPOSTED do OFX vs dDtLanc do Omie divergem por compensacao).
- [ ] Rodar o sombra na Oystr com um mes fechado. O acerto na faixa automatica
      e o numero que libera o resto.

### Fase 1 — escrita no Omie
- [ ] Conferir `escrita_omie.planejar()`: os payloads de `LancarPagamento`,
      `LancarRecebimento` e `IncluirLancCC` contra um lancamento real.
- [ ] Transferencia: o nome `TransferirEntreContas` e placeholder. Reusar o que
      o Banco MCP (`omie_transfer_between_accounts`) ja faz.
- [ ] Estorno em lote a partir da trilha de auditoria (`CancelarPagamento` /
      `CancelarRecebimento` / `ExcluirLancCC`), lendo `auditoria_*.json`.

### Fase 2 — motor: o que ficou aberto
- [ ] Composicao N:1 (uma linha = varios titulos) e 1:N (varias linhas = um
      titulo). Podar por parceiro + janela antes de combinar. Escolher qual
      atacar primeiro conforme o que o sombra mostrar.
- [ ] Retencao de imposto validada por aliquota (IR 1,5%, PCC 4,65%, ISS
      municipal) em vez de "qualquer diferenca ate 10% com IRRF na descricao".
- [ ] Dicionario de banco aprendendo com confirmacoes do operador (hoje so
      a regra de cliente aprende).

### Fase 3 — backend + telas (FastAPI + Postgres, design em `design/`)
- [ ] Aplicar `db/schema_conciliacao.sql`.
- [ ] Endpoints: lotes/linhas, resultados do motor, decisoes (que chamam
      `aprendizado.registrar_decisao`), fechamento por saldo, metricas
      (`vw_metricas_conciliacao`).
- [ ] Tela 1 Carteira, Tela 2 Conta, Tela 3 Decisao, Tela 4 Fechamento,
      Tela 5 Mobile — nessa ordem. Score so como cor; numero no hover/aria.
- [ ] Multi-cliente: isolamento por `cliente_slug` em toda consulta;
      operador ve so a carteira dele.

### Fase 4 — depois
- Captura: Open Finance (Pluggy, ja no Banco MCP), maquininha, fatura de cartao.
- Validacao de documento por IA.
- Nibo como segundo ERP (provar que o motor e agnostico).
- Pedidos ao cliente via WhatsApp MCP.

## Politica de operacao (nao e codigo, mas condiciona o codigo)
Quarentena de 30 dias por cliente apos ligar `--gravar`: relatorio diario de
tudo gravado automaticamente, lido por gente. So depois o corte comeca a descer.
