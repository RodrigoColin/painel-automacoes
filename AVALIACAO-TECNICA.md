# Avaliação técnica do Portal Proos
Data: 19/09/2026

**Parecer:** a base é adequada para um MVP, mas há falhas de isolamento, sincronização e operação que precisam ser corrigidas antes de ampliar o uso como portal financeiro e de clientes. Não recomendo reescrever o projeto: recomendo estabilizar os fluxos existentes e evoluir por módulos.

**Escopo e limites:** inventário de 84 arquivos em src, 34 migrações SQL, executor Python, script de exemplo e configurações do projeto. Revisão estática das camadas de autenticação, autorização, integrações, agendamento, consultas, indicadores e componentes de interface. Dependências e artefatos gerados não foram auditados linha a linha. Não consultei valores de .env.local nem executei operações em Omie, Infisical, n8n ou banco de produção. As conclusões sobre RLS representam as migrações do repositório; precisam ser confrontadas com as políticas e permissões efetivamente implantadas. Não houve teste visual nem teste autenticado ponta a ponta.

**Validação local:** npx tsc --noEmit, npm run lint e npm run build concluídos sem erros. O build gerou as rotas com sucesso. Isso confirma a compilação, não a correção das regras de negócio. Verificações locais também reproduziram colisão de nomes de pastas, classificação indevida de “Não recorrente” e normalização de caminho de redirecionamento para outro domínio.

**Preservação:** não alterei código funcional. Já existiam alterações em src/lib/omie/faturamento.ts e src/components/omie-faturamento-interativo.tsx e uma pasta .claude não rastreada; foram preservadas.

## Pontos positivos

- Next.js com TypeScript estrito e separação entre componentes, consultas, integrações e executores.
- DAL com verificação de sessão e vínculos, combinada com isolamento por empresa nas políticas RLS.
- Valores de segredos separados dos metadados e integração com Infisical.
- Dados de faturamento materializados no banco, evitando recalcular todo o histórico diretamente no Omie.
- Paginação na leitura do faturamento, timeouts em várias integrações e tratamento parcial de falhas no resumo financeiro.
- Transação no banco para transferir automações entre empresas.
- Interface com componentes reutilizáveis, estados vazios, tema, filtros e identificação da empresa.

## Correções prioritárias

### 1. Alta — colisão de pastas pode misturar credenciais de clientes

**Evidência:** [src/lib/infisical/clientes.ts:77](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/infisical/clientes.ts:77>).

O caminho é derivado somente do nome normalizado da empresa. “São José” e “Sao Jose” viram a mesma pasta; dois clientes com o mesmo nome também. Não há unicidade de caminho na tabela que mapeia empresas para pastas. Gravar as chaves do segundo cliente pode substituir as do primeiro, levando a consultas de dados financeiros da empresa errada.

**Correção:** usar o UUID da empresa no caminho e impor unicidade do destino no banco. Antes de migrar pastas existentes, detectar colisões e reconciliar a titularidade das credenciais.

### 2. Alta — vínculo de usuário usa e-mail editável como identidade confiável

**Evidência:** [src/lib/acoes.ts:315](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/acoes.ts:315>) e [supabase/migrations/0022_restaura_multi_tenant.sql:239](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/supabase/migrations/0022_restaura_multi_tenant.sql:239>).

A criação de acesso procura a conta existente em perfis.email. A política de UPDATE do próprio perfil restringe a linha, mas não as colunas. Nas migrações não encontrei proteção específica do e-mail. Se as permissões implantadas permitem esse UPDATE, um usuário pode alterar seu perfil para um e-mail que um administrador pretende convidar e receber o vínculo destinado a essa pessoa.

**Correção:** resolver identidade a partir do Auth, manter o e-mail do perfil sincronizado e não editável pelo cliente e adotar convite com confirmação. Validar essa hipótese em banco de homologação com os grants reais.

### 3. Alta — falha no Omie apaga o espelho dos contratos

**Evidência:** [src/lib/omie/sincronizacao.ts:293](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/sincronizacao.ts:293>).

Qualquer erro ao buscar contratos vira lista vazia. Em seguida, o código exclui todos os contratos locais da empresa. Um timeout ou bloqueio temporário tem, portanto, o mesmo efeito de uma resposta válida sem contratos. A sincronização ainda pode terminar como sucesso.

**Correção:** separar “consulta falhou” de “consulta retornou zero”; preservar a última versão válida, registrar aviso e somente substituir contratos após leitura bem-sucedida.

### 4. Alta — atualização financeira não é atômica e a trava admite corrida

**Evidência:** [src/lib/omie/sincronizacao.ts:257](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/sincronizacao.ts:257>) e [src/lib/omie/sincronizacao.ts:344](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/sincronizacao.ts:344>).

A trava lê o estado e grava o início em requisições separadas. Duas chamadas simultâneas podem passar juntas. O faturamento é apagado e reinserido por mês e por lote, sem transação envolvendo a substituição. Uma falha depois do DELETE deixa o mês vazio ou parcial; leitores também podem observar esse intervalo.

**Correção:** reserva atômica por empresa, com expiração e identificação do executor; carregar em staging e publicar a nova versão em transação/RPC. Verificar os erros de gravação do estado, hoje ignorados.

### 5. Alta — agendador pode duplicar execuções e exceder o tempo disponível

**Evidência:** [src/app/api/agendador/route.ts:42](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/app/api/agendador/route.ts:42>) e [src/app/api/agendador/route.ts:128](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/app/api/agendador/route.ts:128>).

O dispatcher busca até 20 automações e executa em série, dentro de 300 segundos. Um script pode consumir quase todo esse tempo sozinho. Não há reserva atômica: chamadas sobrepostas podem selecionar e executar a mesma automação. Reagendar antes da execução também pode perder uma ocorrência se o processo morrer entre o reagendamento e o disparo. Erros ao registrar execução e logs não impedem o fluxo.

**Correção:** separar despacho e execução, persistir jobs com chave única por automação/horário, reservar com lock e processar com limite de concorrência. Adotar timeout por job, política explícita de recuperação e retentativa idempotente.

### 6. Alta — sincronizador do n8n perde histórico e pode deixar execuções abertas para sempre

**Evidência:** [src/lib/executores/n8n-sincronizacao.ts:39](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/executores/n8n-sincronizacao.ts:39>) e [src/app/api/sincronizar-n8n/route.ts:145](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/app/api/sincronizar-n8n/route.ts:145>).

A leitura traz apenas uma página de até 100 execuções e não percorre nextCursor. Se houver mais execuções entre sincronizações, parte fica para trás. Além disso, o marco avança para o início da execução concluída mais recente: uma execução anterior ainda em andamento fica abaixo do marco e nunca é revisitada.

**Correção:** percorrer todas as páginas necessárias, guardar cursor com desempate por ID, usar sobreposição e reconciliar separadamente execuções ainda abertas. A descoberta de workflows também só busca uma página, com limite 250. [Paginação oficial do n8n](https://docs.n8n.io/api/pagination/).

### 7. Alta — “pausar” workflow do n8n não pausa o workflow real

**Evidência:** [src/components/lista-automacoes.tsx:170](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/components/lista-automacoes.tsx:170>), [src/lib/acoes.ts:892](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/acoes.ts:892>) e [src/lib/n8n-descoberta.ts:80](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/n8n-descoberta.ts:80>).

O controle altera somente o status local. Workflows monitorados continuam disparando no n8n, embora a interface descreva pausados como “sem disparar”. A descoberta sincroniza o nome, mas não atualiza o estado dos workflows já conhecidos.

**Correção:** distinguir estado real do n8n de preferência local de acompanhamento. Se o botão significar pausar execução, integrar a desativação real e confirmar o resultado; caso contrário, trocar o texto e o comportamento da interface.

### 8. Alta — rotação da chave do n8n pode aparentar sucesso sem atualizar o segredo

**Evidência:** [src/lib/acoes.ts:67](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/acoes.ts:67>) e [supabase/migrations/0022_restaura_multi_tenant.sql:298](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/supabase/migrations/0022_restaura_multi_tenant.sql:298>).

Quando o INSERT encontra a chave existente, o código tenta UPDATE com a sessão. A tabela não permite SELECT. O comentário afirma que UPDATE simples dispensa leitura, mas o Supabase documenta a necessidade de política correspondente de SELECT. O UPDATE pode não alcançar a linha, e o código não verifica linhas afetadas.

**Correção:** RPC restrita, com autorização explícita, ou escrita privilegiada no servidor após validar admin de plataforma; não tornar o segredo legível para resolver isso. Testar a rotação de uma chave já existente. [Documentação de RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

### 9. Alta — proteção do último administrador não cobre todos os caminhos

**Evidência:** [supabase/migrations/0022_restaura_multi_tenant.sql:24](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/supabase/migrations/0022_restaura_multi_tenant.sql:24>) e [src/lib/acoes.ts:351](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/acoes.ts:351>).

A migração remove a proteção anterior no banco. A checagem atual ocorre na exclusão pela aplicação, mas o cadastro usa upsert e pode rebaixar um administrador existente para editor. Também há concorrência entre exclusões e acesso direto permitido pela política de membros.

**Correção:** impor a invariável no banco, com serialização por empresa, cobrindo exclusão, mudança de papel e inativação. Separar criação de vínculo de edição de permissões.

## Precisão dos indicadores e integração financeira

### 10. Alta — regras de recorrência podem classificar e somar valores incorretamente

**Evidência:** [src/lib/omie/faturamento.ts:250](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/faturamento.ts:250>) e [src/lib/omie/faturamento.ts:355](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/faturamento.ts:355>).

A expressão que detecta “recorrente” também aceita “Não recorrente”. Além disso, quando existem mais de sete categorias recorrentes, as excedentes entram em “Outras”, marcada como não recorrente. O MRR total é calculado a partir das categorias visuais e pode excluir valores, enquanto a contagem de clientes considera todas as categorias originais.

**Correção:** classificação explícita por código de categoria, configurável por empresa. Calcular indicadores sobre os dados completos; agrupar em “Outras” somente para apresentação.

### 11. Média — situação atual dos contratos é aplicada ao passado

**Evidência:** [src/lib/omie/faturamento.ts:275](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/faturamento.ts:275>) e [src/lib/omie/faturamento.ts:388](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/faturamento.ts:388>).

O histórico mensal usa a mesma situação atual de contrato para todos os meses. Um contrato criado recentemente pode aparecer como “não faturado” em meses anteriores à sua existência; uma alteração atual pode reclassificar saídas antigas. O código reconhece a limitação em comentários, mas ela restringe o uso do histórico como indicador estável.

**Correção:** guardar início, término, vigência e alterações de situação ou snapshots por competência. Separar saída por ausência de faturamento de cancelamento confirmado. Diferenciar retorno de cliente de primeira entrada e incluir expansão/redução de receita quando a análise exigir decomposição do MRR.

### 12. Média — revisão histórica e rastreabilidade financeira insuficientes

**Evidência:** [src/lib/omie/sincronizacao.ts:274](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/sincronizacao.ts:274>) e [supabase/migrations/0031_faturamento_omie.sql:20](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/supabase/migrations/0031_faturamento_omie.sql:20>).

A atualização habitual refaz apenas dois meses: cancelamentos e correções mais antigos permanecem no espelho. Os dados persistidos são agregados; não há origem por OS para explicar cada diferença. Arredondar cada grupo isoladamente também pode produzir diferença de centavos entre categorias e total.

**Correção:** sincronização incremental por alteração, quando disponível, complementada por reconciliação periódica e reprocessamento por período. Guardar identificador da OS e dados necessários à conferência. Fazer rateio em centavos com distribuição determinística do resíduo.

### 13. Média — indicadores das automações ficam incompletos com crescimento

**Evidência:** [src/lib/consultas.ts:55](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/consultas.ts:55>) e [src/lib/consultas.ts:275](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/consultas.ts:275>).

As consultas que calculam totais dos últimos 30 dias não paginam nem agregam no banco. Ao atingir o teto da API, o indicador fica truncado. O próprio módulo de faturamento já trata esse problema, mas o dashboard não. Horários são agrupados no fuso do servidor, sem America/Sao_Paulo explícito.

**Correção:** agregação SQL por empresa/período, com índices e fuso explícito. Paginação no histórico e filtros no servidor. A tela de histórico carrega apenas as últimas 200 execuções e filtra esse subconjunto.

### 14. Média — cache local e consultas ao vivo prejudicam resiliência

**Evidência:** [src/lib/omie/resumo.ts:18](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/resumo.ts:18>) e [src/app/(painel)/omie/page.tsx:77](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/app/(painel)/omie/page.tsx:77>).

O cache e o bloqueio de atualização vivem em Map dentro do processo. Não coordenam instâncias distintas nem chamadas simultâneas. Mesmo a aba de faturamento, que usa dados persistidos, aguarda o resumo ao vivo e a leitura de segredos antes de mostrar conteúdo.

**Correção:** cache compartilhado por empresa, coordenação de consultas simultâneas e preservação da última resposta válida. Renderizar faturamento independentemente da disponibilidade das APIs externas, exibindo o horário da última atualização bem-sucedida. Guardar separadamente horário da última tentativa e do último sucesso.

### 15. Média — uma empresa problemática pode interromper a sincronização das demais

**Evidência:** [src/app/api/sincronizar-omie/route.ts:41](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/app/api/sincronizar-omie/route.ts:41>) e [src/lib/omie/sincronizacao.ts:269](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/omie/sincronizacao.ts:269>).

O cron percorre todas as empresas em série dentro de 300 segundos. A leitura das credenciais ocorre antes do try de sincronização; uma exceção ali pode interromper o lote completo. Empresas posteriores também podem deixar de ser atendidas por falta de tempo.

**Correção:** jobs independentes por empresa, captura de falha por item e progresso retomável. Separar falha de configuração, falha transitória e erro de dados, com alertas acionáveis.

## Segurança e operação

### 16. Média — opções visíveis não são aplicadas na execução

**Evidência:** [src/components/form-nova-automacao.tsx:164](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/components/form-nova-automacao.tsx:164>), [src/components/form-integracao-infisical.tsx:116](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/components/form-integracao-infisical.tsx:116>) e [src/app/api/agendador/route.ts:147](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/app/api/agendador/route.ts:147>).

Tentativas são gravadas, mas não usadas pelo executor. Injeção e mascaramento de segredos continuam na interface, embora o dispatcher declare que foram retirados do fluxo. O formulário permite timeout acima do teto de 290 segundos aplicado no Python.

**Correção:** implementar os comportamentos ou desabilitar os controles com explicação. Não apresentar mascaramento como proteção ativa quando o caminho de execução não o utiliza.

### 17. Média — Python precisa de limites reais de recursos

**Evidência:** [api/executar.py:60](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/api/executar.py:60>) e [api/executar.py:82](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/api/executar.py:82>).

Ambiente reduzido e diretório temporário são úteis, mas não constituem sandbox. O script executa como subprocesso do runtime; captura de saída é ilimitada até terminar. Truncar logs posteriormente no Next não limita memória nem resposta do executor. O timeout não implementa gestão explícita de toda a árvore de processos.

**Correção:** manter upload restrito à Proos, definir dependências reproduzíveis e limitar saída, memória, processos e acesso conforme o trabalho. Para ampliar o uso, adotar executor isolado por job com cancelamento efetivo e logs limitados durante a captura.

### 18. Média — validação de cron aceita expressão impossível

**Evidência:** [src/lib/automacao-tipos.ts:141](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/automacao-tipos.ts:141>) e [src/lib/agendamento.ts:39](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/lib/agendamento.ts:39>).

A validação verifica caracteres e quantidade de campos. Uma expressão como “99 99 * * *” passa e depois produz próxima execução nula. A automação pode ser cadastrada ativa sem jamais executar.

**Correção:** validar semanticamente com o parser no servidor antes do upload/cadastro e mostrar as próximas execuções para conferência.

### 19. Média — redirecionamento do callback aceita caminho normalizado para outro domínio

**Evidência:** [src/app/auth/callback/route.ts:10](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/src/app/auth/callback/route.ts:10>).

A validação aceita uma barra seguida de contrabarra, por não começar com duas barras normais. Ao resolver esse valor com new URL, a origem pode mudar. Isso foi reproduzido localmente sem acessar domínio externo.

**Correção:** resolver o destino e comparar sua origem com a origem permitida; rejeitar contrabarras e aplicar validação compartilhada no login e callback.

### 20. Média — migrações misturam evolução de schema e operações de ambiente

**Evidência:** [supabase/migrations/0015_remove_multi_tenant.sql:30](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/supabase/migrations/0015_remove_multi_tenant.sql:30>) e [supabase/migrations/0022_restaura_multi_tenant.sql:359](<C:/Users/Usuario/Office 365/Proos - Documentos/Portal Proos/painel-automacoes/supabase/migrations/0022_restaura_multi_tenant.sql:359>).

O histórico contém TRUNCATE, reconstrução do modelo e seed que promove todos os perfis existentes a administradores da Proos. Isso pode ter sido adequado ao ambiente inicial, mas não é um procedimento seguro de atualização sobre uma base com clientes reais.

**Correção:** testar a sequência em banco descartável, comparar schema implantado e separar seed de desenvolvimento de concessão de privilégios em produção. Não editar cegamente migrações já aplicadas; corrigir por novas migrações e documentar a linha de base.

## Melhorias de engenharia e experiência

- **Permissões por módulo:** hoje o acesso financeiro acompanha o vínculo com a empresa. Definir separadamente quem vê financeiro, opera automações, cadastra credenciais e administra usuários.
- **Segredos:** consolidar o papel de acessos_chaves, automacao_segredos e Infisical. Hoje coexistem fluxos diferentes e recursos sem consumidor ativo. Usar chaves estrangeiras compostas quando empresa_id é repetido em tabelas filhas, garantindo consistência de titularidade.
- **Auditoria:** registrar mudanças de acesso, vínculo de automação, credenciais e configurações com ator e empresa; logs de execução não substituem essa trilha. Preferir arquivamento de automações quando o histórico precisa ser preservado.
- **Autenticação:** evoluir criação manual de senhas para convite; avaliar MFA para administradores. Resolver falhas de contagem de vínculos de modo restritivo antes de excluir conta ou permitir alteração de senha.
- **Fronteira do servidor:** adicionar server-only em módulos privilegiados e de segredos, conforme o guia de segurança incluído nesta versão do Next.
- **Validação:** aplicar schemas de entrada no servidor, inclusive limites de tamanho e enumerações. Tipos TypeScript não validam requisições externas.
- **Observabilidade:** registrar resultado de cada cron, tempo, empresa, última execução bem-sucedida e falhas persistentes. Alarmes para fila atrasada e execuções abandonadas.
- **Interface:** o botão “Exportar CSV” do histórico não tem ação. Erros retornados ao alternar automações são descartados. Os diálogos não gerenciam foco inicial, contenção e retorno do foco.
- **CSV:** o exportador financeiro escapa aspas, mas não neutraliza texto que uma planilha possa interpretar como fórmula. Tratar textos externos preservando campos numéricos.
- **Estados da aplicação:** criar error/loading apropriados e distinguir “sem registros”, “não sincronizado”, “falha de consulta” e “dados desatualizados”. Atualmente faturamento vazio pode aparecer como nunca sincronizado.
- **Organização:** dividir acoes.ts por domínio; separar tabelas, filtros e exportações do grande componente financeiro. Manter cálculo de indicadores em funções puras testáveis.
- **Documentação:** substituir o README padrão por instalação, variáveis sem valores, arquitetura, matriz de permissões, configuração de cron/Vault, publicação, backup e recuperação.
- **Entrega:** adicionar CI para tipos, lint, build e testes críticos. Não há suíte de testes nem pipeline versionado identificado. Documentar runtime Python e dependências.
- **Consistência:** comentários ainda descrevem Vercel Cron, enquanto as migrações usam pg_cron. A origem operacional precisa estar clara para diagnóstico e implantação.

## Evolução funcional para o objetivo da Proos

**Gestão de clientes:** distinguir a empresa que acessa o portal dos clientes comerciais importados do Omie. Criar ficha com CNPJ, contatos, responsáveis, serviços contratados, status, documentos, histórico de atendimento e pendências. Definir quais campos têm Omie como fonte principal e quais pertencem ao portal.

**Central de informações:** documentos e links por cliente, busca, categorias, versões, responsáveis e permissões. Já existem estruturas antigas de arquivos no banco, mas não há um módulo completo correspondente nas rotas atuais.

**Financeiro:** consolidar a confiabilidade da leitura antes de adicionar escrita no Omie. Evoluir com detalhamento de títulos, vencimentos, recebimentos, pagamentos, conciliação, projeções e comparativos. Separar claramente faturamento, recebimento e receita recorrente contratada; o cálculo atual chamado MRR representa faturamento em categorias classificadas como recorrentes.

**Automações:** catálogo de serviços, responsável operacional, SLA, versão do script/workflow, logs por execução, alerta de falha e reprocessamento controlado. Tornar explícito se o portal executa ou somente monitora cada integração.

**Visão Proos:** carteira consolidada com clientes em atenção, integrações desconectadas, automações com falha, atualização financeira atrasada e pendências de onboarding.

## Ordem sugerida

1. **Isolamento e acesso:** colisão de pastas, identidade por e-mail, último administrador e rotação da chave n8n.
2. **Confiabilidade operacional:** reserva atômica de jobs, sincronizações transacionais, preservação de contratos e histórico completo do n8n.
3. **Precisão financeira:** categorias explícitas, indicadores independentes da apresentação, reconciliação e histórico de contratos.
4. **Sustentação:** testes críticos, CI, documentação, auditoria e alertas.
5. **Expansão:** cadastro completo de clientes, central de informações e novos fluxos financeiros.

**Critérios mínimos de aceite:** duas empresas nunca compartilham credenciais; falha externa preserva a última versão válida; duas chamadas simultâneas não executam o mesmo job; mais de 100 execuções do n8n são importadas integralmente; execução longa recebe desfecho; mais de 1.000 registros não truncam indicadores; mais de sete categorias recorrentes não alteram o total; usuário não consegue modificar identidade confiável ou remover o último admin pelos caminhos alternativos.

As prioridades acima derivam do código local. Antes de aplicar correções de banco, confirmar as políticas reais e testar em homologação com dados representativos e sem credenciais de produção.

