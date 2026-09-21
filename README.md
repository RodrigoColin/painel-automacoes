# proos-omie-mcp

Servidor MCP (Model Context Protocol) da Proos para consulta ao ERP **Omie**.
Primeira peça do "MCP da Proos" — pensado desde já para servir dois usos:

1. **Uso pessoal via Claude Desktop/Claude Code**: consultar Omie diretamente
   nas suas conversas com Claude (clientes, contas a pagar/receber,
   categorias, contratos de serviço etc.).
2. **Base para o backend da Plataforma Proos**: a lógica de acesso ao Omie
   (`omie_mcp/client.py` e `omie_mcp/tools/*.py`) é Python puro, sem
   dependência do protocolo MCP — o futuro backend FastAPI (ver roadmap da
   Plataforma Proos) pode importar essas mesmas funções diretamente, sem
   reescrever a integração.

## Escopo desta versão

**Somente leitura/consulta.** Nenhuma tool aqui cria, altera ou apaga dados
no Omie — decisão deliberada para começar com segurança antes de habilitar
escrita (próxima etapa natural, quando fizer sentido).

**Cobertura sistemática de todo o Omie.** O Portal do Desenvolvedor
(https://developer.omie.com.br/service-list/) lista ~156 endpoints. Este
projeto catalogou **134** deles em `omie_mcp/catalog.py` (a diferença para
156 é porque a página não é 100% estável para leitura automatizada — vale
reconferir contra a página ao vivo periodicamente) e gera **126 tools MCP**
de leitura a partir disso (125 de consulta ao Omie + 1 de descoberta de clientes, `listar_clientes_proos`): 12 endpoints ficaram de fora por serem
puramente de escrita/ação (Incluir, Importar, Cancelar, Faturar — sem
operação de consulta aplicável), e ficam documentados mas sem tool.

Duas camadas de implementação:

1. **Módulos "core"** (`tools/clientes.py`, `categorias.py`,
   `contas_correntes.py`, `contas_pagar.py`, `contas_receber.py`,
   `servicos.py`) — os 7 endpoints mais usados no dia a dia da Proos, com
   implementação própria, filtros e paginação ajustados à mão.
2. **Cauda longa gerada do catálogo** (`tools/generic.py` + registro
   dinâmico em `server.py`) — os outros 115 endpoints, cada um vira uma
   tool `listar_<slug>` própria, todas executadas pelo mesmo código
   genérico.

**Importante sobre confiabilidade dos nomes de `call`:** a API do Omie não
publica publicamente o nome exato de cada chamada (`ListarClientes` etc.)
de forma indexável — isso só aparece no testador interativo do portal,
atrás de login. Cada endpoint no catálogo tem um nível de confiança:

- ✅ **alta** (7): já usados/testados em produção pela Proos, ou
  confirmados durante esta implementação.
- 🟡 **média** (~40): seguem o padrão dominante do Omie
  (`Listar<Entidade>`), mas não foram confirmados contra a API real.
- 🔴 **baixa** (~75): nome pouco previsível (resumos, extratos, tabelas
  auxiliares mais obscuras) — **precisam de validação real antes de uso
  em produção**.

Isso não é um risco de segurança: como toda chamada gerada aqui usa
verbos de leitura (`Listar`/`Consultar`/`Obter`/`Pesquisar`), um nome
errado apenas resulta num erro de "chamada não encontrada" do Omie — nunca
em uma escrita acidental. Mas os *dados* só devem ser considerados
confiáveis depois de rodar `tests/full_coverage_check.py` (ver seção
abaixo) e confirmar o `records_key`/formato de resposta real.

Catálogo completo por categoria (endpoint · módulo · tool MCP · confiança):

### Geral

| Endpoint | Módulo | Tool MCP | Confiança |
|---|---|---|---|
| Clientes, Fornecedores, Transportadoras | `geral/clientes` | `listar_clientes` (feito à mão) | ✅ alta |
| Clientes - Características | `geral/clientescaract` | `listar_clientes_caracteristicas` | 🔴 baixa |
| Tags | `geral/clientetag` | `listar_clientes_tags` | 🔴 baixa |
| Projetos | `geral/projetos` | `listar_projetos` | 🟡 média |
| Empresas | `geral/empresas` | `listar_empresas` | 🟡 média |
| Departamentos | `geral/departamentos` | `listar_departamentos` | 🟡 média |
| Categorias | `geral/categorias` | `listar_categorias` (feito à mão) | ✅ alta |
| Parcelas | `geral/parcelas` | `listar_parcelas` | 🔴 baixa |
| Tipos de Atividade da Empresa | `geral/tpativ` | `listar_tipos_atividade_empresa` | 🔴 baixa |
| Cidades | `geral/cidades` | `listar_cidades` | 🟡 média |
| Países | `geral/paises` | `listar_paises` | 🟡 média |
| Tipos de Anexos | `geral/tiposanexo` | `listar_tipos_anexo` | 🔴 baixa |
| Documentos Anexos | `geral/anexo` | `listar_anexos` | 🔴 baixa |
| Tipo de Entrega | `geral/tiposentrega` | `listar_tipos_entrega` | 🔴 baixa |
| Tipo de Assinante | `geral/tipoassinante` | `listar_tipos_assinante` | 🔴 baixa |
| Tarefas | `geral/tarefas` | `listar_tarefas_geral` | 🟡 média |
| Contas Correntes | `geral/contacorrente` | `listar_contas_correntes` (feito à mão) | ✅ alta |
| Produtos | `geral/produtos` | `listar_produtos` | ✅ alta |
| Produtos - Características | `geral/prodcaract` | `listar_produtos_caracteristicas` | 🔴 baixa |
| Produtos - Estrutura | `geral/malha` | `listar_produtos_estrutura` | 🔴 baixa |
| Produtos - Kit | `geral/produtoskit` | `listar_produtos_kit` | 🔴 baixa |
| Famílias de Produto | `geral/familias` | `listar_familias_produto` | 🟡 média |
| Unidades | `geral/unidade` | `listar_unidades` | 🟡 média |
| Bancos | `geral/bancos` | `listar_bancos` | 🟡 média |
| Tipos de Documento | `geral/tiposdoc` | `listar_tipos_documento` | 🔴 baixa |
| Tipos de Contas Correntes | `geral/tipocc` | `listar_tipos_conta_corrente` | 🔴 baixa |
| Contas do DRE | `geral/dre` | `listar_contas_dre` | 🟡 média |
| Finalidade de Transferência | `geral/finaltransf` | `listar_finalidades_transferencia` | 🔴 baixa |
| Origem do Títulos | `geral/origemlancamento` | `listar_origens_lancamento` | 🔴 baixa |
| Bandeiras de Cartão | `geral/bandeiracartao` | `listar_bandeiras_cartao` | 🟡 média |
| Vendedores | `geral/vendedores` | `listar_vendedores` | ✅ alta |
| Características de Produtos | `geral/caracteristicas` | `listar_caracteristicas` | 🔴 baixa |
| Cenário de Impostos | `geral/cenarios` | `listar_cenarios_impostos` | 🟡 média |
| Meios de Pagamento | `geral/meiospagamento` | `listar_meios_pagamento` | 🟡 média |
| Origem do Pedido | `geral/origempedido` | `listar_origens_pedido` | 🔴 baixa |
| Motivos de Devolução | `geral/motivodevolucao` | `listar_motivos_devolucao` | 🔴 baixa |

### CRM

| Endpoint | Módulo | Tool MCP | Confiança |
|---|---|---|---|
| Contas | `crm/contas` | `listar_crm_contas` | 🟡 média |
| Contas - Características | `crm/contascaract` | `listar_crm_contas_caracteristicas` | 🔴 baixa |
| Contatos | `crm/contatos` | `listar_crm_contatos` | 🟡 média |
| Oportunidades | `crm/oportunidades` | `listar_crm_oportunidades` | 🟡 média |
| Oportunidades - Resumo | `crm/oportunidades-resumo` | `listar_crm_oportunidades_resumo` | 🔴 baixa |
| Tarefas | `crm/tarefas` | `listar_crm_tarefas` | 🟡 média |
| Tarefas - Resumo | `crm/tarefas-resumo` | `listar_crm_tarefas_resumo` | 🔴 baixa |
| Soluções | `crm/solucoes` | `listar_crm_solucoes` | 🔴 baixa |
| Fases | `crm/fases` | `listar_crm_fases` | 🔴 baixa |
| Usuários | `crm/usuarios` | `listar_crm_usuarios` | 🟡 média |
| Status | `crm/status` | `listar_crm_status` | 🔴 baixa |
| Motivos | `crm/motivos` | `listar_crm_motivos` | 🔴 baixa |
| Tipos | `crm/tipos` | `listar_crm_tipos` | 🔴 baixa |
| Parceiros | `crm/parceiros` | `listar_crm_parceiros` | 🔴 baixa |
| Finders | `crm/finders` | `listar_crm_finders` | 🔴 baixa |
| Origens | `crm/origens` | `listar_crm_origens` | 🔴 baixa |
| Concorrentes | `crm/concorrentes` | `listar_crm_concorrentes` | 🔴 baixa |
| Verticais | `crm/verticais` | `listar_crm_verticais` | 🔴 baixa |
| Tipos de Tarefas | `crm/tipostarefa` | `listar_crm_tipos_tarefa` | 🔴 baixa |

### Finanças

| Endpoint | Módulo | Tool MCP | Confiança |
|---|---|---|---|
| Contas Correntes - Lançamentos | `financas/contacorrentelancamentos` | `listar_contas_correntes_lancamentos` | 🟡 média |
| Contas a Pagar - Lançamentos | `financas/contapagar` | `listar_contas_pagar` (feito à mão) | ✅ alta |
| Contas a Receber - Lançamentos | `financas/contareceber` | `listar_contas_receber` (feito à mão) | ✅ alta |
| Contas a Receber - Boletos | `financas/contareceberboleto` | `listar_contas_receber_boletos` | 🟡 média |
| Contas a Receber - PIX | `financas/pix` | `listar_contas_receber_pix` | 🔴 baixa |
| Extrato de Conta Corrente | `financas/extrato` | `listar_extrato_conta_corrente` | 🟡 média |
| Orçamento de Caixa | `financas/caixa` | `listar_orcamento_caixa` | 🔴 baixa |
| Pesquisar Títulos | `financas/pesquisartitulos` | `listar_pesquisar_titulos` | 🟡 média |
| Movimentos Financeiros | `financas/mf` | `listar_movimentos_financeiros` | 🔴 baixa |
| Resumo | `financas/resumo` | `listar_resumo_financas` | 🔴 baixa |

### Compras/Estoque/Produção

| Endpoint | Módulo | Tool MCP | Confiança |
|---|---|---|---|
| Produtos - Variação | `produtos/variacao` | `listar_produtos_variacao` | 🔴 baixa |
| Produtos - Lote | `produtos/produtoslote` | `listar_produtos_lote` | 🔴 baixa |
| Requisições de Compra | `produtos/requisicaocompra` | `listar_requisicoes_compra` | 🟡 média |
| Pedidos de Compra | `produtos/pedidocompra` | `listar_pedidos_compra` | 🟡 média |
| Ordens de Produção | `produtos/op` | `listar_ordens_producao` | 🔴 baixa |
| Nota de Entrada | `produtos/notaentrada` | `listar_nota_entrada` | 🔴 baixa |
| Nota de Entrada - Faturamento | `produtos/notaentradafat` | _(fora de escopo — só escrita)_ | - |
| Recebimento de Nota Fiscal | `produtos/recebimentonfe` | `listar_recebimento_nfe` | 🔴 baixa |
| Resumo (Compras) | `produtos/compras-resumo` | `listar_resumo_compras` | 🔴 baixa |
| Compradores | `estoque/comprador` | `listar_compradores` | 🟡 média |
| Produto x Fornecedor | `estoque/produtofornecedor` | `listar_produto_fornecedor` | 🔴 baixa |
| Formas de Pagamento (Compras) | `produtos/formaspagcompras` | `listar_formas_pagamento_compras` | 🟡 média |
| NCM | `produtos/ncm` | `listar_ncm` | 🟡 média |
| CFOP | `produtos/cfop` | `listar_cfop` | 🟡 média |
| CNAE | `produtos/cnae` | `listar_cnae` | 🟡 média |
| ICMS - CST | `produtos/icmscst` | `listar_icms_cst` | 🔴 baixa |
| ICMS - CSOSN | `produtos/icmscsosn` | `listar_icms_csosn` | 🔴 baixa |
| ICMS - Origem da Mercadoria | `produtos/icmsorigem` | `listar_icms_origem` | 🔴 baixa |
| PIS - CST | `produtos/piscst` | `listar_pis_cst` | 🔴 baixa |
| COFINS - CST | `produtos/cofinscst` | `listar_cofins_cst` | 🔴 baixa |
| IPI - CST | `produtos/ipicst` | `listar_ipi_cst` | 🔴 baixa |
| IPI - Enquadramento | `produtos/ipienq` | `listar_ipi_enquadramento` | 🔴 baixa |
| Tipo de Cálculo | `produtos/tpcalc` | `listar_tipo_calculo` | 🔴 baixa |
| CEST | `produtos/cest` | `listar_cest` | 🔴 baixa |
| Ajustes de Estoque | `estoque/ajuste` | `listar_ajustes_estoque` | 🔴 baixa |
| Consulta Estoque | `estoque/consulta` | `listar_consulta_estoque` | 🟡 média |
| Movimento Estoque | `estoque/movestoque` | `listar_movimento_estoque` | 🔴 baixa |
| Locais de Estoque | `estoque/local` | `listar_locais_estoque` | 🟡 média |
| Resumo do Estoque | `estoque/resumo` | `listar_resumo_estoque` | 🔴 baixa |

### Vendas/NF-e

| Endpoint | Módulo | Tool MCP | Confiança |
|---|---|---|---|
| Pedidos de Venda - Resumido | `produtos/pedidovenda` | `listar_pedidos_venda_resumido` | 🟡 média |
| Pedidos de Venda | `produtos/pedido` | `listar_pedidos_venda` | 🟡 média |
| Pedidos de Venda - Faturamento | `produtos/pedidovendafat` | _(fora de escopo — só escrita)_ | - |
| Pedidos de Venda - Etapas | `produtos/pedidoetapas` | `listar_pedidos_venda_etapas` | 🔴 baixa |
| CT-e / CT-e OS | `produtos/cte` | `listar_cte` | 🔴 baixa |
| Remessa de Produtos | `produtos/remessa` | `listar_remessa_produtos` | 🔴 baixa |
| Remessa de Produtos - Faturamento | `produtos/remessafat` | _(fora de escopo — só escrita)_ | - |
| Resumo (Vendas) | `produtos/vendas-resumo` | `listar_resumo_vendas` | 🔴 baixa |
| Obter Documentos | `produtos/dfedocs` | `listar_documentos_fiscais_vendas` | 🔴 baixa |
| Adicionar Cupom Fiscal | `produtos/cupomfiscalincluir` | _(fora de escopo — só escrita)_ | - |
| Cancelar ou Excluir Cupom Fiscal | `produtos/cupomfiscal` | _(fora de escopo — só escrita)_ | - |
| Consultar Cupom Fiscal | `produtos/cupomfiscalconsultar` | `listar_cupom_fiscal_consultar` | 🟡 média |
| Importar NFC-e | `produtos/nfce` | _(fora de escopo — só escrita)_ | - |
| Importar CFe-Sat | `produtos/sat` | _(fora de escopo — só escrita)_ | - |
| Formas de Pagamento (Vendas) | `produtos/formaspagvendas` | `listar_formas_pagamento_vendas` | 🟡 média |
| Tabela de Preços | `produtos/tabelaprecos` | `listar_tabela_precos` | 🟡 média |
| Etapas de Faturamento | `produtos/etapafat` | `listar_etapas_faturamento` | 🔴 baixa |
| NF-e Consultas | `produtos/nfconsultar` | `listar_nfe_consultas` | 🟡 média |
| NF-e Utilitários | `produtos/notafiscalutil` | `listar_nfe_utilitarios` | 🔴 baixa |
| Importar NF-e | `produtos/nfe` | _(fora de escopo — só escrita)_ | - |

### Serviços/NFS-e

| Endpoint | Módulo | Tool MCP | Confiança |
|---|---|---|---|
| Serviços | `servicos/servico` | `listar_servicos_cadastrados` (feito à mão) | ✅ alta |
| Ordens de Serviço | `servicos/os` | `listar_ordens_servico` | 🟡 média |
| Ordens de Serviço - Faturamento | `servicos/osp` | _(fora de escopo — só escrita)_ | - |
| Ordens de Serviço - Fat. em Lote | `servicos/oslote` | _(fora de escopo — só escrita)_ | - |
| Contratos de Serviço | `servicos/contrato` | `listar_contratos_servico` (feito à mão) | ✅ alta |
| Contratos de Serviço - Faturamento | `servicos/contratofat` | _(fora de escopo — só escrita)_ | - |
| Contratos de Serviço - Fat. em Lote | `servicos/contratolote` | _(fora de escopo — só escrita)_ | - |
| Resumo (Serviços) | `servicos/resumo` | `listar_resumo_servicos` | 🔴 baixa |
| Obter Documentos (Serviços) | `servicos/osdocs` | `listar_documentos_servicos` | 🔴 baixa |
| NFS-e Consultas | `servicos/nfse` | `listar_nfse_consultas` | 🟡 média |
| Serviços no Município | `servicos/listaservico` | `listar_servicos_municipio` | 🔴 baixa |
| Tipos de Tributação | `servicos/tipotrib` | `listar_tipos_tributacao` | 🔴 baixa |
| LC 116 | `servicos/lc116` | `listar_lc116` | 🔴 baixa |
| NBS | `servicos/nbs` | `listar_nbs` | 🔴 baixa |
| IBPT | `servicos/ibpt` | `listar_ibpt` | 🔴 baixa |
| Tipo de Faturamento de Contrato | `servicos/contratotpfat` | `listar_tipos_faturamento_contrato` | 🔴 baixa |
| Tipo de Utilização | `servicos/tipoutilizacao` | `listar_tipos_utilizacao` | 🔴 baixa |
| Classificação do Serviço | `servicos/classificacaoservico` | `listar_classificacao_servico` | 🔴 baixa |

### Painel do Contador

| Endpoint | Módulo | Tool MCP | Confiança |
|---|---|---|---|
| Documentos Fiscais | `contador/xml` | `listar_contador_documentos_fiscais` | 🔴 baixa |
| Resumo (Contador) | `contador/resumo` | `listar_contador_resumo` | 🔴 baixa |





## 1. Credenciais

Você vai precisar de **App Key** e **App Secret** do aplicativo Omie de
cada cliente da Proos que quiser consultar. Só usuários
**administradores** da conta Omie conseguem gerar/ver essas chaves.

Como obter (para cada cliente):
- Portal do desenvolvedor: [developer.omie.com.br](https://developer.omie.com.br/) → "Aplicativos" → selecione o app.
- Ou dentro do Omie: no card do aplicativo → engrenagem → "Resumo do App" → seção "Chave de Integração (API)".
- Guia oficial: [Obtendo a Chave de Acesso para integrações de API](https://ajuda.omie.com.br/pt-BR/articles/499061-obtendo-a-chave-de-acesso-para-integracoes-de-api)

Existem dois jeitos de configurar, dependendo de quantos clientes você vai consultar:

**Opção A — um cliente só** (uso pessoal rápido, ou enquanto só tem uma empresa):

```bash
cp .env.example .env
# edite .env com OMIE_APP_KEY e OMIE_APP_SECRET
```

**Opção B — múltiplos clientes da Proos** (o caso normal):

```bash
cp clientes_omie.example.json clientes_omie.json
# edite clientes_omie.json com um bloco por cliente: slug, nome, app_key, app_secret, ativo
```

Cada tool do MCP passa a aceitar um parâmetro `cliente` (o `slug`) para
escolher qual empresa consultar. Use a tool `listar_clientes_proos` (ou
`python tests/smoke_test.py --listar-clientes`) para ver os slugs
configurados. Se só houver um cliente **ativo**, `cliente` é opcional —
o MCP usa esse automaticamente.

**Nunca** faça commit do `.env` nem do `clientes_omie.json` com
credenciais reais — os dois já estão no `.gitignore`.

## 2. Instalação

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 3. Testar a conexão (antes de tudo)

```bash
python tests/smoke_test.py                    # cliente único (.env)
python tests/smoke_test.py --cliente oystr     # múltiplos clientes
python tests/smoke_test.py --listar-clientes   # só mostra os slugs configurados
```

Isso faz uma chamada real `ListarClientes` (1 página) só para confirmar que
as credenciais funcionam. Não escreve nada no Omie.

## 4. Rodar o servidor MCP

```bash
python -m omie_mcp.server
```

Isso sobe o servidor via stdio, pronto para ser conectado por um cliente
MCP (Claude Desktop, Claude Code, etc). As credenciais vêm de
`clientes_omie.json` (ou de `.env`, se for cliente único) — não precisam
ir no config do Claude Desktop.

### Conectando no Claude Desktop

Adicione ao `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "proos-omie": {
      "command": "python",
      "args": ["-m", "omie_mcp.server"]
    }
  }
}
```

(Ajuste `command` se estiver usando um venv — normalmente aponta para o
`python` de dentro do `.venv`. O servidor lê `clientes_omie.json`/`.env`
relativos ao diretório de onde é iniciado — se o Claude Desktop rodar de
outro diretório, ajuste `cwd` na config ou use caminho absoluto no
`command`.)

Depois de conectado, numa conversa: primeiro pergunte algo como "quais
clientes estão configurados no Omie da Proos?" (aciona
`listar_clientes_proos`), e depois peça o que precisar especificando a
empresa — "lista as contas a pagar em aberto da Oystr", por exemplo. O
Claude identifica o slug certo e passa no parâmetro `cliente`
automaticamente.

## 5. Validar a cobertura completa (recomendado antes de usar em produção)

```bash
python tests/full_coverage_check.py                  # cliente único
python tests/full_coverage_check.py --cliente oystr   # múltiplos clientes
```

Percorre **todos os 134 endpoints catalogados**, para o cliente escolhido,
com o mínimo de dados possível (`registros_por_pagina=1`) e gera
`tests/full_coverage_report_<cliente>.csv` com o status de cada um: `OK`,
`OK (sem registros)`, `FAULT` (Omie respondeu com erro — geralmente nome
de call errado, fácil de corrigir no catálogo) ou `EXCEPTION`. Não escreve
nada no Omie. Como respeita o rate limit configurado, roda mais devagar
que o `smoke_test.py` — para 134 endpoints a ~3 req/s, espere alguns
minutos. Se for validar vários clientes, rode um de cada vez (o relatório
sai num arquivo por cliente).

Depois de rodar, os `call_listar` que derem `FAULT` devem ser corrigidos
em `omie_mcp/catalog.py` (o `faultstring` do Omie geralmente indica se é
"método não encontrado" — nome errado — ou outro tipo de erro). Como o
catálogo é compartilhado entre todos os clientes, uma correção vale para
todo mundo.

## Arquitetura

```
omie_mcp/
  config.py     -> OmieSettings (app_key/app_secret + parâmetros de
                    conexão); from_env() para cliente único, for_cliente()
                    para quando as credenciais vêm do registro multi-cliente
  clients.py    -> ClientesRegistry: carrega clientes_omie.json (ou cai
                    para .env se só houver um cliente), resolve slug -> settings
  client.py     -> OmieClient: chamadas HTTP genéricas, paginação,
                    rate limiting simples, tratamento de erros do Omie
  catalog.py    -> catálogo estruturado dos 134 endpoints do Omie
                    (categoria, módulo, call sugerida, confiança)
  tools/
    clientes.py, categorias.py, contas_correntes.py,
    contas_pagar.py, contas_receber.py, servicos.py
                -> os 7 endpoints "core", com implementação própria
                   (importáveis diretamente pelo backend FastAPI futuro;
                   recebem um OmieClient já resolvido — não sabem nada
                   sobre qual cliente Proos está sendo consultado)
    generic.py  -> executor genérico usado pelos outros 115 endpoints
                   do catálogo
  server.py     -> expõe as tools "core" + registra dinamicamente uma
                   tool MCP por endpoint do catálogo (FastMCP); é aqui que
                   o parâmetro `cliente` de cada tool vira um OmieClient
                   via ClientesRegistry
clientes_omie.example.json -> modelo do arquivo de múltiplos clientes
tests/
  smoke_test.py           -> teste manual de conexão real (1 endpoint)
  full_coverage_check.py  -> valida os 134 endpoints catalogados de uma vez
```

## Notas técnicas importantes

- **Rate limiting**: implementado um limitador simples e retries com
  backoff exponencial. O limite exato de requisições/segundo do seu plano
  Omie deve ser confirmado em
  [Características e Recomendações das APIs do Omie](https://ajuda.omie.com.br/pt-BR/articles/5412721-caracteristicas-e-recomendacoes-das-apis-do-omie) —
  o valor padrão aqui (`OMIE_MAX_REQUESTS_PER_SECOND=3`) é conservador e
  pode ser ajustado via `.env`. Com 126 tools ativas, cuidado especial ao
  rodar `full_coverage_check.py` ou consultas em lote para não estourar o
  limite do seu plano.
- **Nomes de campos de resposta (`records_key`)**: alguns endpoints do Omie
  não têm o nome exato do campo de lista 100% documentado publicamente. O
  cliente tenta candidatos conhecidos e, se nenhum bater, faz
  auto-detecção do primeiro campo de lista na resposta e loga um aviso —
  rode `full_coverage_check.py` e confira os logs/CSV antes de confiar
  cegamente nos dados em produção.
- **Filtros de contas a pagar/receber e demais endpoints**: os parâmetros
  de filtro (`filtros`) são passados como estão para a API — confirme os
  nomes exatos dos campos (período de vencimento, status etc.) na
  documentação oficial antes de usar em automações.
- **156 vs. 134**: o Portal do Desenvolvedor menciona 156 endpoints; este
  catálogo capturou 134 na extração feita durante esta implementação. Vale
  reconferir contra a página ao vivo (idealmente logado, para ver o
  testador interativo com os nomes de `call` confirmados) para fechar essa
  diferença e subir a confiança dos endpoints 🟡/🔴.

## Próximos passos sugeridos

1. Rodar `full_coverage_check.py` com credenciais reais, revisar o CSV e
   corrigir os `call_listar` que derem `FAULT` em `omie_mcp/catalog.py`.
2. Se possível, conferir os nomes de `call` restantes no testador
   interativo do Portal do Desenvolvedor (logado) para os endpoints que
   ficarem 🔴 mesmo após o passo 1.
3. Decidir e priorizar as primeiras tools de **escrita** (ex.: incluir
   contas a pagar a partir da skill de fatura de cartão já existente).
4. Extrair `omie_mcp/client.py`, `omie_mcp/catalog.py` e
   `omie_mcp/tools/` como pacote reutilizável quando o backend FastAPI da
   Plataforma Proos começar (Fase 2 do roadmap).
5. Repetir esta mesma estrutura (catálogo + executor genérico) para o
   **Nibo** quando for a vez dele (Fase 2 do roadmap da Plataforma Proos).
