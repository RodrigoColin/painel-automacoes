# Playbook — Migração / Implantação Conta Azul → Omie

Metodologia e aprendizados técnicos para **implantar Omie e/ou migrar do Conta Azul**, destilados do projeto [[desimec-migracao-contaazul-omie]]. Use como base de um projeto mais robusto.

## ORDEM RECOMENDADA DO PROJETO
1. **Auditoria da empresa no Omie** (via MCP oficial): contas correntes, categorias, clientes, CP/CR já existentes (ruído, NFs emitidas). O "plano padrão Omie" já existe — geralmente só falta mapear/recabear.
2. **Pedir CEDO o EXTRATO EXPORTADO do Conta Azul** (tela → xlsx). É o ativo mais valioso: tem saldo corrente, **Saldo Inicial por conta**, flags de recorrência, parcela x/y, categoria e centro de custo. Resolve saldos de abertura, recorrentes e compromissos — coisas que a API do CA NÃO dá.
3. **Plano de categorias + DRE**: mapear despesas/receitas CA→padrão Omie, recabear o DRE (margem produto×serviço), decidir MOD (custo vs despesa).
4. **Clientes/Fornecedores**: dedupe por **CNPJ** (não por integ); criar via IncluirCliente (chave `CA-<cnpj>`); enriquecer fornecedor do histórico pela descrição livre.
5. **Contas correntes + saldos de abertura** (do extrato).
6. **CP/CR históricos** (lote, idempotente).
7. **Investimentos/transferências/saques** (LancCC).
8. **Conferência CA×Omie ao centavo** (por ano; diferenças = transferências/centavos, nunca títulos perdidos).
9. **Fase 2**: Centros de Custo (margem por área) + categorias produto×serviço. Projetos só se o cliente quiser margem por pedido.
10. **Operação viva**: recorrentes + compromissos projetados (fluxo de caixa) na conta operacional.
11. **Conciliação OFX** go-forward na operacional.

**Técnica de 2 contas:** "Conta-Histórico" = memória de DRE (NÃO reconciliar com banco) para todo o passado; "Conta-Operacional" = go-forward, concilia com OFX. Saldo de 30/09 (ou corte) vira abertura da operacional.

## CONTA AZUL — API v2 (gotchas)
- OAuth2 Authorization Code; access token 1h, refresh_token (Basic base64(client_id:secret)); handshake manual.
- Endpoints: `/v1/pessoas?tipo_perfil=Cliente|Fornecedor|Transportadora`, `/v1/categorias`, `/v1/conta-financeira`, `/v1/financeiro/eventos-financeiros/contas-a-pagar|receber/buscar`.
- **NÃO expõe:** saldo bancário, data de baixa/recebimento, extrato/razão, parcelas (endpoint /parcelas volta vazio). Só os títulos. Saldo/extrato SÓ pela exportação da tela (xlsx).
- Fornecedor ~98% nulo; nome vem na **descrição livre** → minerar (token match, trata siglas).
- Extrato exportado ".xls" é na verdade **.xlsx (zip/PK)**; abrir via Excel COM. Colunas úteis: Valor, **Saldo conta** (corrente), Recorrência, Qtd recorrência (parcela), Categoria, Centro de Custo, Situação.
- Conciliação do CA costuma ser **duvidosa**: extrato tem lançamentos agendados pro futuro (anos à frente) e saldo final inconsistente → usar só saldos de abertura e movimentos efetivos (≤ hoje).
- Decimais pt-BR; UTF-8 via RawContentStream.

## OMIE — API (gotchas críticos)
**Canais e rate limit:**
- **REST (app_key/app_secret)** vs **MCP oficial (OAuth)** = **buckets de limite SEPARADOS**.
- REST sofre **MISUSE_API_PROCESS** (bloqueio ~30min) em rajada de **writes individuais**; cada tentativa durante o bloqueio RENOVA o timer. **Lotes (Upsert...PorLote) são seguros** (poucas chamadas).
- **MCP (omie_executar) NÃO sofre o bloqueio do REST** — usar p/ writes individuais (baixas, ajustes, exclusões). Aguenta ~22 chamadas paralelas/rodada.
- "Consumo redundante": 2 chamadas idênticas seguidas = bloqueio curto (variar/aguardar).
- Background com sleep longo (>~10min idle) é MORTO pelo ambiente → não dá pra "esperar cooldown" em background.

**Datas:**
- `data_vencimento` ≥ **01/01/2021** é piso FIXO do servidor (REST e MCP), **não configurável** (suporte confirmou). Config "Sobre os Lançamentos → Período Limite" controla só **emissão/registro** (Data Inicial=01/01/2020 libera emissão 2020). `data_previsao` ≥ 01/01/2020.
- **Workaround título pré-2021:** `data_vencimento=01/01/2021` + `data_emissao`=data real + baixa na data real → competência (DRE) e caixa corretos; só venc cosmético. (Títulos quitados: venc é irrelevante.)
- **IncluirLancCC aceita datas 2020+** (sem piso) — mas vira movimento de caixa, não título AP/AR.
- **AlterarContaCorrente saldo_inicial/saldo_data aceita datas pré-2021** (saldo de conta não tem piso).

**Títulos (CP/CR):**
- `UpsertContaPagar/ReceberPorLote` (máx 50/lote, idempotente por `codigo_lancamento_integracao` ≤60 char). Baixa embutida: `baixar_documento='S'` + `recebimento`/`pagamento`.
- **CP NÃO tem bloco `repeticao`** (só CR tem) → p/ recorrência, gerar N títulos mensais.
- **Trocar cliente/fornecedor/venc de título BAIXADO: IGNORADO** via Alterar E Upsert (responde "sucesso"/"Ok!" mas mantém o antigo). Em título **A VENCER: atualiza normal**. Vencimento de NF-origin (VENR) é travado sempre.
- **Corrigir título baixado:** CancelarPagamento/CancelarRecebimento (precisa `codigo_baixa` ou `codigo_baixa_integracao`; o `nCodLanc` do LancCC NÃO é o codigo_baixa) → depois Excluir → recriar. OU excluir na UI (estorna baixa junto) + recriar via lote.
- **Baixar título existente** (ex.: NF já emitida no Omie): `LancarRecebimento`/`LancarPagamento` (MCP, pelo rate). Overlap de NF emitida no Omio: NÃO reimportar; casar por **série+nº NF** e baixar na data real (AR de NF = Omie é a fonte da verdade).
- Normalizar texto para **NFC** antes do POST (NFD quebra: erro "Parâmetro não é um hash válido => null").
- Export-Csv do PowerShell grava decimal com **vírgula** (pt-BR) → parsear com cultura pt-BR (não InvariantCulture, que lê vírgula como milhar).

**Cadastros:**
- `IncluirCliente` sem lote JSON; match por **CNPJ**. Cadastro pode ser usado como favorecido em CP sem flag especial. Pode criar sem CNPJ (pessoa_fisica S/N).
- **Categorias:** menu DRE fixo (28 contas); `AlterarCategoria` IGNORA `conta_inativa` (ativar/inativar só UI); sem Excluir. CPV de produto = conta oculta 1.21.01 (custo médio do estoque).
- **CR não aceita categoria de DESPESA** (exige receita); reembolsos/estornos → receita (1.02.97 Descontos Obtidos, 1.04.98 Empréstimos Sócios).
- **Departamentos = Centros de Custo** (hierárquico sob "Sua Empresa", código do pai na inclusão); sem `inativo` na API (só Excluir). Rateio em CP/CR via `distribuicao`.
- **Projetos:** tag opcional por título/NF/pedido (margem por pedido); só se o cliente quiser esse nível.

**LancCC (conta corrente):**
- Transferência: `detalhes.cCodCateg="0.01.02"` (Saída de Transferência) + `cTipo="TRA"` + `transferencia.nCodCCDestino`.
- Receita/despesa manual: natureza R/D derivada da categoria; origem APER/APEP. `cCodIntLanc` ≤20 char.
- Lançamentos LancCC NÃO aparecem no `ListarExtrato` (visão de conciliados) mas afetam DRE/caixa; conferir via `ListarLancCC` (diversos.cNatureza, nCodLancCR/CP).

## ARMADILHAS DE EXECUÇÃO (PowerShell/dados)
- Slug de N letras p/ chave de integração COLIDE (ex.: "Seguro de Vida"/"Imóveis" → mesmo prefixo) → usar índice/chave única.
- `$cr.data` num array devolve lista de nulos → checar `$x -is [array]`.
- Interpolação `"$var:"` vira drive no PowerShell → usar `${var}`.
- cp_enriquecido do CA tem NOME de categoria, não código Omie → mapear via de-para.

