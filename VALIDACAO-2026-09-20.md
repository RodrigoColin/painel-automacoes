# Validação da conciliação — 20/09/2026

Validação adversarial do que foi construído nesta sessão. Método: escrever
cenários que eu suspeitava que quebrassem e rodar contra o código, em vez de
só reler. Dez cenários, dez falhas confirmadas. Sete corrigidas e viraram
suíte de regressão (`tests/test_regressao_validacao.py`); as outras ficam
documentadas abaixo como decisão pendente.

---

## 1. Falhas de código (encontradas e corrigidas)

| # | Falha | Gravidade | Correção |
|---|---|---|---|
| F1 | Pagamento de R$ 1.000 na conta A + recebimento de R$ 1.010 na conta B no mesmo dia virava "transferência com tarifa" automática | **crítica** — dois títulos ficavam em aberto e nascia uma transferência falsa | Tarifa embutida só com indício textual de transferência e quando o débito é maior que o crédito |
| F2 | Dois valores exatos iguais em contas diferentes (aluguel pago + cliente recebido) viravam transferência automática | **crítica** | Transferência sem indício passa a ser avaliada depois de título e vai para revisão, nunca automática. Indício = vocabulário de transferência na descrição ou contraparte com o CNPJ da própria empresa |
| F3 | Regra aprendida ("COPEL → lançamento direto") ignorava um CP da Copel já lançado: a despesa entrava duas vezes | **crítica** | Regra de classificação só decide quando não há título plausível |
| F4 | Regra "DELL" casava com "MODELLO MÓVEIS" | média | Casamento por palavra inteira |
| F5 | Regra com desfecho título curto-circuitava o matching e devolvia "título" sem candidato | alta | Regras de título não decidem; viram bônus de +15 no candidato cujo parceiro bate |
| F6 | Pagamento parcial (R$ 500 de um título de R$ 1.000) caía em "sem título" | alta — parcial é rotina | Novo caminho: linha menor que o título (≥ 20%) vira revisão como parcial; nunca automático |
| F8 | Título pré-selecionado em revisão podia ser oferecido a duas linhas | média | Título fica reservado também na faixa de revisão |
| F9 | FITID repetido em transações distintas (Bradesco faz isso) descartava linha legítima | **alta** — dinheiro sumindo silenciosamente | Dedup por FITID + data + valor; FITID repetido ganha sufixo |
| F10 | Fila renderizava descrição do extrato sem escape (XSS se o JSON for de terceiro) | baixa hoje, alta quando o cliente subir arquivo | Escape em todos os campos de dado |
| F11 | `--gravar` sem segunda confirmação nem trava de concorrência | **alta** | `--confirmo-escrita <slug>`, teto de gravações por rodada, lock de lote, trilha de auditoria por rodada |

## 2. Falhas conhecidas, ainda abertas (precisam de decisão sua)

- **F7 Composição N:1 e 1:N.** Uma linha = vários títulos (fornecedor
  consolidado, folha) e várias linhas = um título (parcelas) não estão
  implementadas. Hoje caem em "sem título". É o próximo bloco de motor. Quero
  saber, na Oystr, qual dos dois é mais frequente antes de escolher a
  estratégia de busca — combinações explodem rápido.
- **Gabarito por data + valor.** Duas linhas iguais no mesmo dia se cruzam. E
  a data do OFX (`DTPOSTED`) pode diferir da `dDtLanc` do Omie por um dia de
  compensação — o modo sombra vai reportar erro onde não há. Mitigação
  simples: tolerar ±1 dia no casamento do gabarito. Ainda não fiz.
- **Retenção de imposto por percentual.** Hoje aceito qualquer diferença
  dentro de 10% se a descrição citar IRRF/ISS/PCC. O certo é validar contra as
  alíquotas reais (1,5% IR, 4,65% PCC, ISS municipal) — um número que não
  bate com alíquota nenhuma é sinal, não retenção.
- **Payloads do Omie.** `LancarPagamento`, `IncluirLancCC` e principalmente a
  transferência (o nome `TransferirEntreContas` é chute meu) vieram da
  documentação, não de uma chamada real. O Banco MCP já tem
  `omie_transfer_between_accounts` funcionando — o adaptador deveria reusar o
  que ele faz, não reinventar.
- **Exportador sem margem de vencimento.** Busca títulos exatamente no período
  do extrato. Título vencido em julho e pago em agosto fica fora. A margem de
  20 dias já é decisão registrada em produção (`oystr_diagnostico`) e precisa
  entrar aqui.

## 3. Riscos de segurança e operação

1. **Estado de idempotência em arquivo.** `gravadas.json` num OneDrive é
   exatamente o cenário que já corrompeu o `proos-omie-mcp`. Duas rodadas
   concorrentes ou um sync atrasado = gravação duplicada no ERP. A trava de
   lote ajuda; a solução real é o índice único do Postgres
   (`ux_match_linha_gravada`). Até o banco existir, rodar `--gravar` só de uma
   máquina e nunca da pasta sincronizada.
2. **Credenciais.** `clientes_omie.json` continua fora do git — certo. Mas o
   `--gravar` usa a mesma credencial de leitura. Vale ter app_key separada só
   para escrita, com escopo mínimo, que possa ser revogada sem derrubar os
   robôs de leitura.
3. **Fila publicada.** O artifact é privado a você até compartilhar. Ele não
   carrega dado: tudo fica no navegador de quem sobe o JSON. Se um dia virar
   página do cliente, o JSON não pode ir hardcoded como no dashboard atual.
4. **Reversão.** Não existe "desfazer" automático de uma gravação errada. O
   Banco MCP tem `CancelarPagamento`/`CancelarRecebimento`; o adaptador deveria
   guardar o `id_omie` (já guarda) e oferecer estorno em lote a partir da
   trilha de auditoria. Sem isso, o "período de quarentena" abaixo é
   obrigatório.
5. **Confiança silenciosa.** O maior risco não é gravar errado — é gravar
   errado e ninguém ver. Retrabalho só aparece se o operador abrir o Omie e
   desfazer. Precisa de um relatório diário de tudo que foi gravado
   automaticamente, por 30 dias, lido por gente.

## 4. Oportunidades de processo

- **Quarentena de 30 dias por cliente.** Ligar `--gravar` só com relatório
  diário de gravações automáticas revisado. Só depois o corte começa a
  descer. Isso é política, não código — e é o que torna o modelo defensável
  para o cliente.
- **Buracos no ERP como produto.** "Sem título" não é erro do motor, é
  diagnóstico do cliente. A view `vw_metricas_conciliacao` já conta
  `buracos_no_erp`. Isso vira o relatório mensal de qualidade do processo do
  cliente — e pauta comercial para consultoria.
- **Dicionário de banco como ativo compartilhado.** Cada banco novo custa uma
  vez e serve para toda a carteira. Vale manter versionado no repositório,
  separado das regras de cliente, e alimentar a partir das confirmações do
  operador (hoje só a regra de cliente aprende; o dicionário é estático).
- **Fechamento pelo saldo, não pela fila vazia.** A conta está fechada quando
  saldo do OFX (`LEDGERBAL`, já lido) = saldo do Omie. O `fechamento_conta`
  do schema existe; falta o comando que compara. É o único critério que o
  cliente entende.

## 5. Negócio

- O que foi construído sustenta a tese do serviço-como-serviço: o
  operador decide, não pesquisa; o motor aprende por cliente; a métrica que
  governa é retrabalho. Mas o argumento comercial ainda é promessa. Ele vira
  número só depois do modo sombra na Oystr — e, se o acerto automático vier
  abaixo de ~85%, a fila será grande demais para o piloto valer.
- O ganho real de margem está em composição (F7) e em captura automática, não
  no matching 1:1. Matching 1:1 o Omie já faz razoavelmente; o que ele não
  faz é descobrir o buraco, aprender, e fechar pelo saldo.
- Nibo é 100% ausente. Alperman está no Nibo. Se o piloto for Oystr/Omie, o
  segundo cliente do modelo deveria ser Nibo de propósito, para provar que o
  motor é agnóstico de ERP — que é o que justifica a arquitetura.

## 6. Velocidade

- Volume mensal de uma conta (centenas a poucos milhares de linhas) roda em
  milissegundos. Sem problema real.
- Transferência é O(n²) sobre o lote; composição N:1 será combinatória e vai
  precisar de poda (por fornecedor, por janela). Esse é o único ponto onde
  desempenho vai importar.
- O gargalo de velocidade do projeto não é o código: é a API do Omie estar
  bloqueada nos sandboxes. Cada validação real passa pelo seu terminal.
  Vale um sandbox/VPS com acesso ao Omie para o dev — está no roadmap como
  VPS, mas vira pré-requisito aqui.

## 7. O que eu faria na sequência, em ordem

1. Rodar o modo sombra na Oystr com um mês fechado (é o que destrava tudo).
2. Tolerância ±1 dia no gabarito e margem de 20 dias no exportador.
3. Composição N:1 conforme o padrão que aparecer no sombra.
4. Adaptador de transferência reusando o Banco MCP; conferir os dois payloads
   contra um lançamento real.
5. Estorno em lote a partir da auditoria.
6. Comando de fechamento por saldo.
