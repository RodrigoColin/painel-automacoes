# Plano de Categorias + DRE — Desimec (revisão de especialista)

Desimec: metal-mecânica com (1) **fabricação sob encomenda / não-seriada**, (2) **serviços de usinagem**, (3) **futuros produtos seriados**, (4) **gestão de projetos**. O plano precisa permitir **margem por linha de negócio** e DRE gerencial correto.

## Menu de DRE do Omie (fixo, não editável) — 28 contas
```
1   LUCRO BRUTO
 1.01  Receita Liquida Operacional
   1.01.01 Receita Bruta de Vendas (+)
   1.01.02 Impostos (-)                      <- impostos sobre venda
   1.01.03 Deducoes de Receita (-)           <- devolucoes, descontos incondicionais
 1.11  Receita Liquida Indireta
   1.11.01 Outras Receitas (+)
   1.11.02 Receitas Financeiras (+)
 1.21  Custos  (define a MARGEM BRUTA)
   1.21.01 Custo Medio (CMC) das Vendas (-)  [OCULTA - automatica do estoque/producao]
   1.21.02 Custo dos Servicos Prestados (-)
   1.21.03 Outros Custos (-)                 <- usamos p/ custo de produto manual (MP/insumos)
2   DESPESAS
 2.01 Variaveis
   2.01.01 Despesas Variaveis (-)            <- comissoes, frete de venda, taxa cartao/marketplace
 2.11 Fixas
   2.11.01 Despesas com Pessoal (-)
   2.11.02 Despesas Administrativas (-)
   2.11.03 Despesas Financeiras (-)
   2.11.04 Despesas de Vendas e Marketing (-)
   2.11.05 Outros Tributos (-)               <- IRPJ, CSLL, taxas, retencoes
3   INVESTIMENTOS
   3.01.01 Ativos (-)                        <- imobilizado
   3.01.02 Servicos (-)
```
Estrutura gerencial: Receita Bruta − Impostos − Deducoes = **Receita Liquida** − Custos = **LUCRO BRUTO (margem bruta)** − Despesas Variaveis − Despesas Fixas = **Resultado Operacional** − Investimentos = **Resultado**.

## ACHADO CRITICO — a base do Omie esta com o DRE "descableado"
Varias categorias padrao da Desimec estao **sem conta de DRE** (codigo_dre vazio) → hoje nao aparecem no DRE:
- **2.01.01 Compras p/ Revenda** e **2.01.03 Compras de Materia Prima**: SEM DRE → custo nao entra na margem.
- **2.06.* Impostos** (ICMS, PIS, COFINS, ISS, IRPJ, CSLL, Simples/DAS): TODAS sem DRE.
- **2.07.* Investimento**: todas sem DRE.
Alem disso, classificacoes erradas:
- **2.01.02 Frete** -> hoje "Deducoes de Receita" (deveria ser custo ou despesa variavel).
- **2.02.01 Comissoes** -> hoje "Outros Custos" (deveria ser Despesa Variavel, para compor margem de contribuicao).
Ou seja: **antes de migrar dados, a base precisa ser recabeada no DRE.** Fizemos isso no de-para (coluna Omie_DRE_Codigo).

## Arquitetura de margem para a Desimec
- **Receita** separada por linha: Produtos Fabricados (1.01.01), Servicos (1.01.02), Revenda (1.01.03) -> todas DRE 1.01.01 Receita Bruta.
- **Impostos sobre venda** (ICMS/ISS/PIS/COFINS/Simples) -> DRE 1.01.02 Impostos.
- **Custo de Produto** (materia-prima, insumos, consumiveis de producao) -> DRE 1.21.03; **Custo de Servico** (materiais/mao de obra aplicados em servico) -> DRE 1.21.02. => formam a **margem bruta** por linha.
- **Despesas Variaveis** (comissoes, frete de venda, taxas cartao) -> DRE 2.01.01 => **margem de contribuicao**.
- **Despesas Fixas**: Pessoal / Administrativas / Financeiras / Vendas e Marketing / Outros Tributos.
- **Investimentos** (imobilizado) -> fora do resultado operacional (grupo 3).

## Alem das categorias (essencial para margem real)
1. **Centro de Custos**: criar *Fabricacao, Servicos, Projetos, Comercial, Administrativo* -> permite margem por linha mesmo com despesas compartilhadas e rateio.
2. **Projetos / Ordem de Producao (OS)**: para **custo e margem por pedido nao-seriado** (job costing) e por projeto. Categoria+DRE da a visao por linha; Projeto/OS da a visao por pedido.
3. **Produtos seriados (futuro)**: usar modulo de Producao + Estoque (custo medio) -> CMV automatico na conta OCULTA 1.21.01; ficha tecnica p/ custo-padrao.
4. **tipo_categoria de compra** (MAT=materia-prima, REV=revenda, USO=uso/consumo) nas categorias de custo, para alimentar estoque corretamente quando ativarem producao.

## Regras de folha (Opcao B) e go-forward
- Folha CLT (chao de fabrica) -> **Salarios - Producao (MOD)** e **Encargos - Producao** = CUSTO (margem bruta).
- **Leandra e Pedro = administrativos** -> a folha deles vai para **Salarios (2.03.01) / encargos** = Despesa com Pessoal. Classificar assim a partir de 01/10. (No historico do CA a folha vem em lump por tipo; fica majoritariamente em Producao, com a parcela admin deles nao carvada do passado.)
- Pro-labore dos socios -> Despesa com Pessoal (2.03.15).
- Beneficios (VT, VA, plano saude/odonto, seguro de vida, PLR) -> Despesa com Pessoal (periodo), NAO entram na margem bruta.
- Vale-Alimentacao + Combustivel (categoria mista no CA): DIVIDIDA em VA (2.03.17) e Combustivel (2.04.16); ratear no import.

## Status do de-para
`de_para_categorias.csv` agora tem: CA_Categoria | CA_Tipo | CA_GrupoDRE | Omie_Grupo | Omie_Codigo | Omie_Categoria | **Omie_DRE_Codigo | Omie_DRE_Conta** | Acao | Confianca | Observacao.
149 linhas | 28 categorias novas a criar | 22 a revisar.
