# Conciliacao bancaria — Proos

Motor de conciliacao, leitor de OFX, aprendizado de regras, escrita no Omie e
fila do operador. Python puro (so stdlib): roda e testa em qualquer lugar,
sem rede e sem a API do Omie — exceto na hora de gravar de verdade.

## Instalar

Copiar para dentro do `proos-omie-mcp`, preservando a estrutura:

    proos-omie-mcp/
    ├── omie_mcp/conciliacao/       <- o core
    ├── scripts/                    <- os 3 CLIs
    ├── tests/                      <- 2 suites
    ├── db/schema_conciliacao.sql   <- tabelas (complementa o schema existente)
    └── fila_conciliacao.html       <- tela do operador

    python tests/test_motor.py
    python tests/test_aprendizado_escrita.py

## Os tres comandos

**1. Exportar as bases do Omie** (uma vez por periodo)

    python scripts/exportar_base_sombra.py --cliente oystr \
        --conta-omie 1628924843 --desde 01/08/2026 --ate 31/08/2026

Gera `sombra/titulos.json` (o universo candidato) e `sombra/gabarito.json`
(o que o humano conciliou, lido de `ListarLancCC` via `diversos.nCodLancCR` /
`nCodLancCP`). O gabarito e chaveado por `data|valor` porque o Omie nao conhece
o FITID do OFX.

**2. Modo sombra** — o numero que valida a tese, sem gravar nada

    python scripts/modo_sombra.py --ofx extrato_ago.ofx --conta 1628924843 \
        --titulos sombra/titulos.json --gabarito sombra/gabarito.json \
        --gabarito-por-data-valor

Sai a distribuicao por desfecho/faixa e, o que importa, o **acerto dentro da
faixa automatica** — o corte que libera a escrita no ERP.

**3. Conciliar** — o pipeline do dia a dia

    python scripts/conciliar.py --cliente oystr --conta-omie 1628924843 \
        --ofx extrato.ofx --titulos titulos.json

Dry-run por padrao. Com `--gravar`, grava no Omie **apenas a faixa
automatica**. Gera `fila.json` para a tela do operador.

## Os quatro desfechos

| Desfecho | O que e | Como grava no Omie |
|---|---|---|
| `titulo` | casou com CP/CR em aberto | `LancarPagamento` / `LancarRecebimento` (juros e desconto viram campo proprio) |
| `lanc_direto` | tarifa, rendimento, IOF, juros de conta | `IncluirLancCC` na categoria certa |
| `transferencia` | entre contas da propria empresa, inclui aplicacao/resgate | transferencia entre contas correntes (um registro, nao dois) |
| `fila` | exige decisao humana, ja tipificada | nada ate o operador decidir |

## Ordem de avaliacao (deliberada)

1. Duplicidade — linha ja conciliada nao reprocessa
2. Regra aprendida do cliente
3. **Transferencia** — antes de titulo, senao o fuzzy acha um fornecedor de
   valor parecido e erra com confianca alta
4. Titulo — deterministico, depois fuzzy com regras financeiras
   (juros, desconto, retencao de imposto)
5. Lancamento direto — so se nenhum titulo plausivel. Juros de boleto
   pertencem ao titulo; tarifa e IOF de conta sao diretos
6. Fila, tipificada por tipo de excecao

## Aprendizado e calibracao

`aprendizado.py` transforma cada decisao do operador em regra: extrai o trecho
estavel da descricao (tira data, valor, NF, CNPJ) e cria/reforca o padrao. Com
3 confirmacoes a regra decide sozinha; uma decisao que a contraria zera a
confianca.

`calibrar()` compara sugerido x decidido e recomenda subir ou baixar o corte.
A metrica que governa: **retrabalho** — conciliacao automatica que o operador
desfez. Enquanto ficar abaixo de 2%, da pra automatizar mais.

## Seguranca da escrita

- dry-run e o padrao; nada grava sem `--gravar`
- idempotencia por `conta + linha_id`, persistida em `gravadas.json`
  (no backend, o indice unico `ux_match_linha_gravada`)
- so a faixa automatica grava sozinha
- toda gravacao registra score, evidencias e o id devolvido pelo Omie
- falha numa linha nao derruba o lote

## Banco

`db/schema_conciliacao.sql`: contas, lotes, linhas (com dedup por `id_origem`),
matches com trilha de auditoria, fila de excecoes, regras aprendidas, cortes
por cliente, fechamento por conta (saldo banco x saldo ERP) e a view
`vw_metricas_conciliacao` — % automatico, retrabalho, excecoes abertas,
buracos no ERP e tempo medio de resolucao. Sao as metricas do SLA.

## O que ainda nao existe

Captura automatica (Open Finance, maquininha, cartao), validacao de documento
por IA, Nibo, e o envio das pendencias ao cliente por WhatsApp. O motor so
conhece "linha normalizada" — a captura pluga sem tocar nele.

## Pontos a conferir na primeira rodada

Os nomes de funcao/campo do `omie_mcp` usados pelo exportador e pelo
`--gravar` estao marcados com **CONFERIR** no codigo. Os scripts avisam em vez
de quebrar em silencio. Os payloads de `LancarPagamento`/`IncluirLancCC` foram
montados pela documentacao — conferir contra um lancamento real antes de ligar
a gravacao.
