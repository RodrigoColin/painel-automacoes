# Telas de referencia (design)

Artboards exportados do canvas Claude Design:
https://claude.ai/artifact/8Lht73Kkn6uRwMdFasynBz

| Arquivo | Tela | Tamanho |
|---|---|---|
| Main.dc.html | 1 · Carteira do operador | 1440x960 |
| Conta.dc.html | 2 · Conciliacao da conta (tela principal, 2 colunas) | 1440x1180 |
| Decisao.dc.html | 3 · Painel lateral de decisao de excecao | 1440x1040 |
| Fechamento.dc.html | 4 · Fechamento pelo saldo | 1440x900 |
| Mobile.dc.html | 5 · Revisao rapida (celular) | 390x844 |

Sao mockups estaticos (HTML com estilos inline). O markup dentro de `<x-dc>`
e o layout de referencia — copiar estrutura, espacamentos, cores e textos.
Ignorar `<helmet>`, `support.js` e o `<script type="text/x-dc">` (sao do editor).

Design system (mesmo dos dashboards Proos):
- fundo #eef1f8, superficie #ffffff, borda #e0e4ee
- brand #215ba8, brand suave #dde6f5
- texto #16223d / #57617a / #8891a6
- status: bom #0ca30c, atencao #c98200, serio #c1602e, critico #d03b3b
- Archivo (titulos), IBM Plex Sans (corpo), IBM Plex Mono (valores, tabular-nums)
- tema sempre claro
