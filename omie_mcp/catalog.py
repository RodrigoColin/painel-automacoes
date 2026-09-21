"""
Catálogo completo das APIs do Omie (Portal do Desenvolvedor:
https://developer.omie.com.br/service-list/), organizado por categoria.

Por que este arquivo existe
----------------------------
O Omie expõe ~156 endpoints. A documentação pública lista o nome e o
caminho de cada um, mas NÃO publica de forma indexável o nome exato de
cada `call` (isso só aparece no testador interativo do Portal do
Desenvolvedor, atrás de login). Em vez de escrever ~150 funções Python
quase idênticas na mão (repetição = risco de erro e manutenção ruim),
este catálogo guarda os metadados de cada endpoint em formato de dados,
e `tools/generic.py` + `server.py` geram as tools automaticamente a
partir dele.

Cada entrada tem um nível de `confianca` no nome do `call` sugerido:
  - "alta": endpoints já testados/usados em produção pela Proos, ou com
    padrão de nome idêntico ao de endpoints já confirmados.
  - "media": segue o padrão dominante do Omie ("Listar<Entidade>"), mas
    sem confirmação real.
  - "baixa": nome pouco previsível (resumos, extratos, tabelas
    auxiliares) — precisa de validação real antes de uso em produção.

Endpoints cujo nome já deixa claro que são só ações de escrita
(Incluir/Alterar/Excluir/Importar/Cancelar/Faturar, sem uma operação de
consulta óbvia) são marcados com `somente_escrita=True` e NÃO geram tool
— ficam catalogados só para documentação/rastreabilidade, e ficam fora do
escopo desta fase (somente leitura).

Como isso é validado
---------------------
`tests/full_coverage_check.py` percorre este catálogo inteiro contra a
API real do Omie (quando há credenciais) e gera um relatório OK / FAULT /
EXCEPTION por endpoint — é assim que os `call`s "media"/"baixa" viram
"alta" (ou são corrigidos) na prática.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class EndpointSpec:
    categoria: str
    nome: str
    modulo: str  # ex.: "geral/clientes"
    slug: str  # identificador único, snake_case, vira sufixo do nome da tool
    call_listar: str | None  # nome da call de leitura sugerida (None = não se aplica)
    confianca: str = "media"  # "alta" | "media" | "baixa"
    somente_escrita: bool = False
    ja_implementado_manualmente: bool = False  # True = já existe tool feita à mão, não gerar duplicata
    observacao: str = ""
    records_key_candidates: tuple[str, ...] = field(default_factory=tuple)


CATALOG: list[EndpointSpec] = [
    # ------------------------------------------------------------------
    # GERAL
    # ------------------------------------------------------------------
    EndpointSpec("Geral", "Clientes, Fornecedores, Transportadoras", "geral/clientes",
                 "clientes", "ListarClientes", "alta", ja_implementado_manualmente=True,
                 observacao="Já implementado em tools/clientes.py"),
    EndpointSpec("Geral", "Clientes - Características", "geral/clientescaract",
                 "clientes_caracteristicas", "ListarClientesCaract", "baixa"),
    EndpointSpec("Geral", "Tags", "geral/clientetag",
                 "clientes_tags", "ListarClienteTags", "baixa"),
    EndpointSpec("Geral", "Projetos", "geral/projetos",
                 "projetos", "ListarProjetos", "media"),
    EndpointSpec("Geral", "Empresas", "geral/empresas",
                 "empresas", "ListarEmpresas", "media",
                 observacao="Pode se referir às empresas do grupo/multi-empresa da conta Omie"),
    EndpointSpec("Geral", "Departamentos", "geral/departamentos",
                 "departamentos", "ListarDepartamentos", "media"),
    EndpointSpec("Geral", "Categorias", "geral/categorias",
                 "categorias", "ListarCategorias", "alta", ja_implementado_manualmente=True,
                 observacao="Já implementado em tools/categorias.py"),
    EndpointSpec("Geral", "Parcelas", "geral/parcelas",
                 "parcelas", "ListarParcelas", "baixa",
                 observacao="Pode ser sobre condições de parcelamento"),
    EndpointSpec("Geral", "Tipos de Atividade da Empresa", "geral/tpativ",
                 "tipos_atividade_empresa", "ListarTiposAtividades", "baixa"),
    EndpointSpec("Geral", "Cidades", "geral/cidades",
                 "cidades", "PesquisarCidades", "media"),
    EndpointSpec("Geral", "Países", "geral/paises",
                 "paises", "ListarPaises", "media"),
    EndpointSpec("Geral", "Tipos de Anexos", "geral/tiposanexo",
                 "tipos_anexo", "ListarTiposAnexo", "baixa"),
    EndpointSpec("Geral", "Documentos Anexos", "geral/anexo",
                 "anexos", "ListarAnexos", "baixa",
                 observacao="Provavelmente precisa de código do registro (cliente, título etc.) como filtro"),
    EndpointSpec("Geral", "Tipo de Entrega", "geral/tiposentrega",
                 "tipos_entrega", "ListarTiposEntrega", "baixa"),
    EndpointSpec("Geral", "Tipo de Assinante", "geral/tipoassinante",
                 "tipos_assinante", "ListarTiposAssinante", "baixa"),
    EndpointSpec("Geral", "Tarefas", "geral/tarefas",
                 "tarefas_geral", "ListarTarefas", "media"),
    EndpointSpec("Geral", "Contas Correntes", "geral/contacorrente",
                 "contas_correntes", "ListarContasCorrentes", "alta", ja_implementado_manualmente=True,
                 observacao="Já implementado em tools/contas_correntes.py"),
    EndpointSpec("Geral", "Produtos", "geral/produtos",
                 "produtos", "ListarProdutos", "alta"),
    EndpointSpec("Geral", "Produtos - Características", "geral/prodcaract",
                 "produtos_caracteristicas", "ListarProdutosCaract", "baixa"),
    EndpointSpec("Geral", "Produtos - Estrutura", "geral/malha",
                 "produtos_estrutura", "ListarMalha", "baixa"),
    EndpointSpec("Geral", "Produtos - Kit", "geral/produtoskit",
                 "produtos_kit", "ListarProdutosKit", "baixa"),
    EndpointSpec("Geral", "Famílias de Produto", "geral/familias",
                 "familias_produto", "ListarFamilias", "media"),
    EndpointSpec("Geral", "Unidades", "geral/unidade",
                 "unidades", "ListarUnidades", "media"),
    EndpointSpec("Geral", "Bancos", "geral/bancos",
                 "bancos", "ListarBancos", "media"),
    EndpointSpec("Geral", "Tipos de Documento", "geral/tiposdoc",
                 "tipos_documento", "ListarTiposDocumento", "baixa"),
    EndpointSpec("Geral", "Tipos de Contas Correntes", "geral/tipocc",
                 "tipos_conta_corrente", "ListarTiposContaCorrente", "baixa"),
    EndpointSpec("Geral", "Contas do DRE", "geral/dre",
                 "contas_dre", "ListarContasDRE", "media",
                 observacao="Relevante para relatórios financeiros (DRE)"),
    EndpointSpec("Geral", "Finalidade de Transferência", "geral/finaltransf",
                 "finalidades_transferencia", "ListarFinalidadesTransferencia", "baixa"),
    EndpointSpec("Geral", "Origem do Títulos", "geral/origemlancamento",
                 "origens_lancamento", "ListarOrigensLancamento", "baixa"),
    EndpointSpec("Geral", "Bandeiras de Cartão", "geral/bandeiracartao",
                 "bandeiras_cartao", "ListarBandeirasCartao", "media"),
    EndpointSpec("Geral", "Vendedores", "geral/vendedores",
                 "vendedores", "ListarVendedores", "alta"),
    EndpointSpec("Geral", "Características de Produtos", "geral/caracteristicas",
                 "caracteristicas", "ListarCaracteristicas", "baixa"),
    EndpointSpec("Geral", "Cenário de Impostos", "geral/cenarios",
                 "cenarios_impostos", "ListarCenarios", "media"),
    EndpointSpec("Geral", "Meios de Pagamento", "geral/meiospagamento",
                 "meios_pagamento", "ListarMeiosPagamento", "media"),
    EndpointSpec("Geral", "Origem do Pedido", "geral/origempedido",
                 "origens_pedido", "ListarOrigensPedido", "baixa"),
    EndpointSpec("Geral", "Motivos de Devolução", "geral/motivodevolucao",
                 "motivos_devolucao", "ListarMotivosDevolucao", "baixa"),

    # ------------------------------------------------------------------
    # CRM  (baixa prioridade para BPO financeiro, mas catalogado por completo)
    # ------------------------------------------------------------------
    EndpointSpec("CRM", "Contas", "crm/contas", "crm_contas", "ListarContas", "media"),
    EndpointSpec("CRM", "Contas - Características", "crm/contascaract",
                 "crm_contas_caracteristicas", "ListarContasCaract", "baixa"),
    EndpointSpec("CRM", "Contatos", "crm/contatos", "crm_contatos", "ListarContatos", "media"),
    EndpointSpec("CRM", "Oportunidades", "crm/oportunidades",
                 "crm_oportunidades", "ListarOportunidades", "media"),
    EndpointSpec("CRM", "Oportunidades - Resumo", "crm/oportunidades-resumo",
                 "crm_oportunidades_resumo", "ListarResumoOportunidades", "baixa"),
    EndpointSpec("CRM", "Tarefas", "crm/tarefas", "crm_tarefas", "ListarTarefas", "media"),
    EndpointSpec("CRM", "Tarefas - Resumo", "crm/tarefas-resumo",
                 "crm_tarefas_resumo", "ListarResumoTarefas", "baixa"),
    EndpointSpec("CRM", "Soluções", "crm/solucoes", "crm_solucoes", "ListarSolucoes", "baixa"),
    EndpointSpec("CRM", "Fases", "crm/fases", "crm_fases", "ListarFases", "baixa"),
    EndpointSpec("CRM", "Usuários", "crm/usuarios", "crm_usuarios", "ListarUsuarios", "media"),
    EndpointSpec("CRM", "Status", "crm/status", "crm_status", "ListarStatus", "baixa"),
    EndpointSpec("CRM", "Motivos", "crm/motivos", "crm_motivos", "ListarMotivos", "baixa"),
    EndpointSpec("CRM", "Tipos", "crm/tipos", "crm_tipos", "ListarTipos", "baixa"),
    EndpointSpec("CRM", "Parceiros", "crm/parceiros", "crm_parceiros", "ListarParceiros", "baixa"),
    EndpointSpec("CRM", "Finders", "crm/finders", "crm_finders", "ListarFinders", "baixa"),
    EndpointSpec("CRM", "Origens", "crm/origens", "crm_origens", "ListarOrigens", "baixa"),
    EndpointSpec("CRM", "Concorrentes", "crm/concorrentes", "crm_concorrentes", "ListarConcorrentes", "baixa"),
    EndpointSpec("CRM", "Verticais", "crm/verticais", "crm_verticais", "ListarVerticais", "baixa"),
    EndpointSpec("CRM", "Tipos de Tarefas", "crm/tipostarefa",
                 "crm_tipos_tarefa", "ListarTiposTarefa", "baixa"),

    # ------------------------------------------------------------------
    # FINANÇAS  (alta prioridade para BPO financeiro)
    # ------------------------------------------------------------------
    EndpointSpec("Finanças", "Contas Correntes - Lançamentos", "financas/contacorrentelancamentos",
                 "contas_correntes_lancamentos", "ListarLancCC", "alta",
                 ja_implementado_manualmente=True,
                 records_key_candidates=("listaLancamentos",),
                 observacao="Já implementado em tools/lancamentos_cc.py. Call confirmada em "
                            "2026-08-06 (era 'ListarLancamentos', chute errado — o nome real "
                            "veio de pesquisa em MCPs de terceiros e foi validado contra dados "
                            "reais). Cada lançamento traz, em diversos.dDtConc/nCodLancCR/"
                            "nCodLancCP, o elo direto pro título de contas a receber/pagar e a "
                            "data de conciliação bancária — é o cruzamento título<->baixa mais "
                            "confiável que temos (substitui o cruzamento via extrato + chave "
                            "composta usado antes em reports/oystr_diagnostico.py)."),
    EndpointSpec("Finanças", "Contas a Pagar - Lançamentos", "financas/contapagar",
                 "contas_pagar", "ListarContasPagar", "alta", ja_implementado_manualmente=True,
                 observacao="Já implementado em tools/contas_pagar.py"),
    EndpointSpec("Finanças", "Contas a Receber - Lançamentos", "financas/contareceber",
                 "contas_receber", "ListarContasReceber", "alta", ja_implementado_manualmente=True,
                 observacao="Já implementado em tools/contas_receber.py"),
    EndpointSpec("Finanças", "Contas a Receber - Boletos", "financas/contareceberboleto",
                 "contas_receber_boletos", "ListarBoletos", "media"),
    EndpointSpec("Finanças", "Contas a Receber - PIX", "financas/pix",
                 "contas_receber_pix", "ListarPix", "baixa"),
    EndpointSpec("Finanças", "Extrato de Conta Corrente", "financas/extrato",
                 "extrato_conta_corrente", "ListarExtrato", "alta",
                 ja_implementado_manualmente=True,
                 records_key_candidates=("listaMovimentos",),
                 observacao="Já implementado em tools/extrato.py — confirmado contra "
                 "proos-automacoes/oystr/fluxo_caixa.py (chamada real é ListarExtrato, "
                 "não ObterExtrato; requer cCodIntCC mesmo que vazio; não pagina, "
                 "devolve tudo do período em listaMovimentos)."),
    EndpointSpec("Finanças", "Orçamento de Caixa", "financas/caixa",
                 "orcamento_caixa", "ListarOrcamentoCaixa", "baixa"),
    EndpointSpec("Finanças", "Pesquisar Títulos", "financas/pesquisartitulos",
                 "pesquisar_titulos", "PesquisarLancamentos", "media",
                 observacao="Busca combinada de contas a pagar/receber — validar com prioridade"),
    EndpointSpec("Finanças", "Movimentos Financeiros", "financas/mf",
                 "movimentos_financeiros", "ListarMovimentos", "baixa"),
    EndpointSpec("Finanças", "Resumo", "financas/resumo",
                 "resumo_financas", "ObterResumo", "baixa"),

    # ------------------------------------------------------------------
    # COMPRAS, ESTOQUE E PRODUÇÃO
    # ------------------------------------------------------------------
    EndpointSpec("Compras/Estoque/Produção", "Produtos - Variação", "produtos/variacao",
                 "produtos_variacao", "ListarVariacoes", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Produtos - Lote", "produtos/produtoslote",
                 "produtos_lote", "ListarProdutosLote", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Requisições de Compra", "produtos/requisicaocompra",
                 "requisicoes_compra", "ListarRequisicoesCompra", "media"),
    EndpointSpec("Compras/Estoque/Produção", "Pedidos de Compra", "produtos/pedidocompra",
                 "pedidos_compra", "ListarPedidosCompra", "media"),
    EndpointSpec("Compras/Estoque/Produção", "Ordens de Produção", "produtos/op",
                 "ordens_producao", "ListarOP", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Nota de Entrada", "produtos/notaentrada",
                 "nota_entrada", "ListarNotaEntrada", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Nota de Entrada - Faturamento", "produtos/notaentradafat",
                 "nota_entrada_faturamento", None, "baixa", somente_escrita=True,
                 observacao="Operação de faturamento — fora do escopo somente-leitura"),
    EndpointSpec("Compras/Estoque/Produção", "Recebimento de Nota Fiscal", "produtos/recebimentonfe",
                 "recebimento_nfe", "ListarRecebimentoNFe", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Resumo (Compras)", "produtos/compras-resumo",
                 "resumo_compras", "ObterResumo", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Compradores", "estoque/comprador",
                 "compradores", "ListarCompradores", "media"),
    EndpointSpec("Compras/Estoque/Produção", "Produto x Fornecedor", "estoque/produtofornecedor",
                 "produto_fornecedor", "ListarProdutoFornecedor", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Formas de Pagamento (Compras)", "produtos/formaspagcompras",
                 "formas_pagamento_compras", "ListarFormasPagamento", "media"),
    EndpointSpec("Compras/Estoque/Produção", "NCM", "produtos/ncm", "ncm", "PesquisarNCM", "media"),
    EndpointSpec("Compras/Estoque/Produção", "CFOP", "produtos/cfop", "cfop", "PesquisarCFOP", "media"),
    EndpointSpec("Compras/Estoque/Produção", "CNAE", "produtos/cnae", "cnae", "PesquisarCNAE", "media"),
    EndpointSpec("Compras/Estoque/Produção", "ICMS - CST", "produtos/icmscst",
                 "icms_cst", "ListarICMSCST", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "ICMS - CSOSN", "produtos/icmscsosn",
                 "icms_csosn", "ListarICMSCSOSN", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "ICMS - Origem da Mercadoria", "produtos/icmsorigem",
                 "icms_origem", "ListarICMSOrigem", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "PIS - CST", "produtos/piscst", "pis_cst", "ListarPISCST", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "COFINS - CST", "produtos/cofinscst",
                 "cofins_cst", "ListarCOFINSCST", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "IPI - CST", "produtos/ipicst", "ipi_cst", "ListarIPICST", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "IPI - Enquadramento", "produtos/ipienq",
                 "ipi_enquadramento", "ListarIPIEnquadramento", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Tipo de Cálculo", "produtos/tpcalc",
                 "tipo_calculo", "ListarTiposCalculo", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "CEST", "produtos/cest", "cest", "PesquisarCEST", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Ajustes de Estoque", "estoque/ajuste",
                 "ajustes_estoque", "ListarAjustes", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Consulta Estoque", "estoque/consulta",
                 "consulta_estoque", "ListarPosEstoque", "media",
                 observacao="Consulta de posição de estoque"),
    EndpointSpec("Compras/Estoque/Produção", "Movimento Estoque", "estoque/movestoque",
                 "movimento_estoque", "ListarMovimentos", "baixa"),
    EndpointSpec("Compras/Estoque/Produção", "Locais de Estoque", "estoque/local",
                 "locais_estoque", "ListarLocais", "media"),
    EndpointSpec("Compras/Estoque/Produção", "Resumo do Estoque", "estoque/resumo",
                 "resumo_estoque", "ObterResumoEstoque", "baixa"),

    # ------------------------------------------------------------------
    # VENDAS E NF-e
    # ------------------------------------------------------------------
    EndpointSpec("Vendas/NF-e", "Pedidos de Venda - Resumido", "produtos/pedidovenda",
                 "pedidos_venda_resumido", "ListarPedidos", "media"),
    EndpointSpec("Vendas/NF-e", "Pedidos de Venda", "produtos/pedido",
                 "pedidos_venda", "ListarPedidos", "media"),
    EndpointSpec("Vendas/NF-e", "Pedidos de Venda - Faturamento", "produtos/pedidovendafat",
                 "pedidos_venda_faturamento", None, "baixa", somente_escrita=True,
                 observacao="Operação de faturamento — fora do escopo somente-leitura"),
    EndpointSpec("Vendas/NF-e", "Pedidos de Venda - Etapas", "produtos/pedidoetapas",
                 "pedidos_venda_etapas", "ListarEtapas", "baixa"),
    EndpointSpec("Vendas/NF-e", "CT-e / CT-e OS", "produtos/cte", "cte", "ListarCTe", "baixa"),
    EndpointSpec("Vendas/NF-e", "Remessa de Produtos", "produtos/remessa",
                 "remessa_produtos", "ListarRemessa", "baixa"),
    EndpointSpec("Vendas/NF-e", "Remessa de Produtos - Faturamento", "produtos/remessafat",
                 "remessa_produtos_faturamento", None, "baixa", somente_escrita=True,
                 observacao="Operação de faturamento — fora do escopo somente-leitura"),
    EndpointSpec("Vendas/NF-e", "Resumo (Vendas)", "produtos/vendas-resumo",
                 "resumo_vendas", "ObterResumo", "baixa"),
    EndpointSpec("Vendas/NF-e", "Obter Documentos", "produtos/dfedocs",
                 "documentos_fiscais_vendas", "ObterDocumento", "baixa"),
    EndpointSpec("Vendas/NF-e", "Adicionar Cupom Fiscal", "produtos/cupomfiscalincluir",
                 "cupom_fiscal_incluir", None, "baixa", somente_escrita=True,
                 observacao="Ação de escrita (Incluir) — fora do escopo somente-leitura"),
    EndpointSpec("Vendas/NF-e", "Cancelar ou Excluir Cupom Fiscal", "produtos/cupomfiscal",
                 "cupom_fiscal_cancelar", None, "baixa", somente_escrita=True,
                 observacao="Ação de escrita (Cancelar/Excluir) — fora do escopo somente-leitura"),
    EndpointSpec("Vendas/NF-e", "Consultar Cupom Fiscal", "produtos/cupomfiscalconsultar",
                 "cupom_fiscal_consultar", "ConsultarCupomFiscal", "media"),
    EndpointSpec("Vendas/NF-e", "Importar NFC-e", "produtos/nfce",
                 "nfce_importar", None, "baixa", somente_escrita=True,
                 observacao="Ação de escrita (Importar) — fora do escopo somente-leitura"),
    EndpointSpec("Vendas/NF-e", "Importar CFe-Sat", "produtos/sat",
                 "sat_importar", None, "baixa", somente_escrita=True,
                 observacao="Ação de escrita (Importar) — fora do escopo somente-leitura"),
    EndpointSpec("Vendas/NF-e", "Formas de Pagamento (Vendas)", "produtos/formaspagvendas",
                 "formas_pagamento_vendas", "ListarFormasPagamento", "media"),
    EndpointSpec("Vendas/NF-e", "Tabela de Preços", "produtos/tabelaprecos",
                 "tabela_precos", "ListarTabelaPrecos", "media"),
    EndpointSpec("Vendas/NF-e", "Etapas de Faturamento", "produtos/etapafat",
                 "etapas_faturamento", "ListarEtapasFaturamento", "baixa"),
    EndpointSpec("Vendas/NF-e", "NF-e Consultas", "produtos/nfconsultar",
                 "nfe_consultas", "ListarNF", "media",
                 observacao="Consulta de notas fiscais de produto emitidas"),
    EndpointSpec("Vendas/NF-e", "NF-e Utilitários", "produtos/notafiscalutil",
                 "nfe_utilitarios", "ObterUtilitarios", "baixa"),
    EndpointSpec("Vendas/NF-e", "Importar NF-e", "produtos/nfe",
                 "nfe_importar", None, "baixa", somente_escrita=True,
                 observacao="Ação de escrita (Importar) — fora do escopo somente-leitura"),

    # ------------------------------------------------------------------
    # SERVIÇOS E NFS-e
    # ------------------------------------------------------------------
    EndpointSpec("Serviços/NFS-e", "Serviços", "servicos/servico",
                 "servicos_cadastrados", "ListarCadastroServico", "alta", ja_implementado_manualmente=True,
                 observacao="Já implementado em tools/servicos.py"),
    EndpointSpec("Serviços/NFS-e", "Ordens de Serviço", "servicos/os",
                 "ordens_servico", "ListarOS", "media"),
    EndpointSpec("Serviços/NFS-e", "Ordens de Serviço - Faturamento", "servicos/osp",
                 "os_faturamento", None, "baixa", somente_escrita=True,
                 observacao="Operação de faturamento — fora do escopo somente-leitura"),
    EndpointSpec("Serviços/NFS-e", "Ordens de Serviço - Fat. em Lote", "servicos/oslote",
                 "os_faturamento_lote", None, "baixa", somente_escrita=True,
                 observacao="Operação de faturamento em lote — fora do escopo somente-leitura"),
    EndpointSpec("Serviços/NFS-e", "Contratos de Serviço", "servicos/contrato",
                 "contratos_servico", "ListarContratos", "alta", ja_implementado_manualmente=True,
                 observacao="Já implementado em tools/servicos.py"),
    EndpointSpec("Serviços/NFS-e", "Contratos de Serviço - Faturamento", "servicos/contratofat",
                 "contratos_servico_faturamento", None, "baixa", somente_escrita=True,
                 observacao="Operação de faturamento — fora do escopo somente-leitura"),
    EndpointSpec("Serviços/NFS-e", "Contratos de Serviço - Fat. em Lote", "servicos/contratolote",
                 "contratos_servico_faturamento_lote", None, "baixa", somente_escrita=True,
                 observacao="Operação de faturamento em lote — fora do escopo somente-leitura"),
    EndpointSpec("Serviços/NFS-e", "Resumo (Serviços)", "servicos/resumo",
                 "resumo_servicos", "ObterResumo", "baixa"),
    EndpointSpec("Serviços/NFS-e", "Obter Documentos (Serviços)", "servicos/osdocs",
                 "documentos_servicos", "ObterDocumento", "baixa",
                 observacao="Recupera PDF/XML de NFS-e, recibo etc. — leitura, mas retorna binário/base64"),
    EndpointSpec("Serviços/NFS-e", "NFS-e Consultas", "servicos/nfse",
                 "nfse_consultas", "ListarNF", "media",
                 observacao="Relevante para comunicação com cliente e conciliação"),
    EndpointSpec("Serviços/NFS-e", "Serviços no Município", "servicos/listaservico",
                 "servicos_municipio", "ListarServicoMunicipio", "baixa"),
    EndpointSpec("Serviços/NFS-e", "Tipos de Tributação", "servicos/tipotrib",
                 "tipos_tributacao", "ListarTiposTributacao", "baixa"),
    EndpointSpec("Serviços/NFS-e", "LC 116", "servicos/lc116", "lc116", "ListarLC116", "baixa"),
    EndpointSpec("Serviços/NFS-e", "NBS", "servicos/nbs", "nbs", "ListarNBS", "baixa"),
    EndpointSpec("Serviços/NFS-e", "IBPT", "servicos/ibpt", "ibpt", "ListarIBPT", "baixa"),
    EndpointSpec("Serviços/NFS-e", "Tipo de Faturamento de Contrato", "servicos/contratotpfat",
                 "tipos_faturamento_contrato", "ListarTiposFaturamento", "baixa"),
    EndpointSpec("Serviços/NFS-e", "Tipo de Utilização", "servicos/tipoutilizacao",
                 "tipos_utilizacao", "ListarTiposUtilizacao", "baixa"),
    EndpointSpec("Serviços/NFS-e", "Classificação do Serviço", "servicos/classificacaoservico",
                 "classificacao_servico", "ListarClassificacaoServico", "baixa"),

    # ------------------------------------------------------------------
    # PAINEL DO CONTADOR
    # ------------------------------------------------------------------
    EndpointSpec("Painel do Contador", "Documentos Fiscais", "contador/xml",
                 "contador_documentos_fiscais", "ListarDocumentosFiscais", "baixa"),
    EndpointSpec("Painel do Contador", "Resumo (Contador)", "contador/resumo",
                 "contador_resumo", "ObterResumo", "baixa"),
]


def resumo_por_categoria() -> dict[str, dict[str, int]]:
    """Conta quantos endpoints por categoria são leitura/escrita/confiança."""
    resumo: dict[str, dict[str, int]] = {}
    for spec in CATALOG:
        cat = resumo.setdefault(
            spec.categoria, {"total": 0, "leitura": 0, "somente_escrita": 0,
                              "alta": 0, "media": 0, "baixa": 0}
        )
        cat["total"] += 1
        if spec.somente_escrita:
            cat["somente_escrita"] += 1
        else:
            cat["leitura"] += 1
            cat[spec.confianca] += 1
    return resumo


if __name__ == "__main__":
    import json

    print(f"Total de endpoints catalogados: {len(CATALOG)}")
    print(json.dumps(resumo_por_categoria(), indent=2, ensure_ascii=False))
