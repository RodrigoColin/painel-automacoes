"""
Pipeline do fluxo de caixa que alimenta a tela "Fluxo de caixa" do painel.

Uma rodada por empresa: busca as bases e o extrato no Omie, monta os
agregados (extra) e grava tudo em `caixa_pacote_diario`. O container
`caixa` (ver worker.py) processa a fila `caixa_execucao`, que o cron do
painel alimenta às 10h e às 16h e o botão "Atualizar agora" alimenta sob
demanda.
"""
