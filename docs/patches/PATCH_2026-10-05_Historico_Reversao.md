# Histórico de ações e reversão financeira

Data: 05/10/2026. Projeto: Furushima Financeiro.

## Comportamento

Menu Histórico de ações, com busca, período, área, situação e paginação de 25 ações. A tela mostra dados registrados e o estado que será recuperado. A confirmação chama uma única RPC transacional. Ações vinculadas à mesma transação do banco são revertidas juntas, incluindo parcelas, faturas, limites, movimentos de conta e revisões OCR. Cada reversão é registrada e pode ser revertida novamente.

## Cobertura e limites

19 tabelas: contas, categorias, orçamentos, limites por categoria, cartões, faturas, parcelas, lançamentos, assinaturas, recargas, metas, investimentos e eventos, compras planejadas, preferências, perfil, imagens e revisões/recibos OCR. O histórico inicia na ativação, sem inventar ações anteriores. Alterações de arquivos enviados são registradas, mas sua reversão usa o importador porque snapshots do banco não recuperam bytes do Storage. Permissões e autenticação estão fora deste histórico financeiro. Escritas de manutenção sem usuário autenticado não são registradas.

Uma operação feita por múltiplas requisições independentes aparece como múltiplas ações. Operações financeiras existentes em RPCs são agrupadas integralmente.

## Segurança e integridade

Histórico imutável para clientes, RLS por espaço, leitura para espectador e reversão apenas para administrador titular. A RPC compara o estado atual com snapshots, verifica novos vínculos e chaves únicas reutilizadas, usa locks NOWAIT e revalida após obter locks. Em conflito, nenhuma mudança é feita. Toda restauração passa pelas constraints e pela comparação final integral.

Contexto de replay em tabela privada, sem escrita pelo cliente. Suspende somente durante a RPC autorizada os triggers que recalculam dados ou exigem estados intermediários, evitando recriação de parcelas. As definições originais ficam em private.history_trigger_backups. Escritas normais mantêm as validações existentes.

## Verificação

27 testes de integração de reversão: criar/editar/excluir, pagamento e estorno de faturas, compras parceladas, transferências, aportes/resgates, compras com entrada, recargas, OCR, metas, orçamentos, assinaturas, preferências, refazer reversão, idempotência, conflitos, titular/espectador e isolamento. Um teste força falha em um filho depois de restaurar o pai e comprova rollback de dados, contexto privado e auditoria. 29 testes de importação/parcelas com os novos triggers instalados e 19 testes financeiros existentes. TypeScript, ESLint dos arquivos alterados e build passaram. Os testes PGlite usam uma conexão; não simulam carga concorrente real.

## Migração e manutenção

20261005181000_financial_action_history.sql, sem backfill. Mudanças futuras em colunas ou triggers financeiros exigem revisão da compatibilidade dos snapshots e do contexto de replay. Não editar a migração aplicada.

Rollback operacional: voltar o frontend, remover zz_history_capture das 19 tabelas, executar as function_definition armazenadas em private.history_trigger_backups e retirar as três RPCs públicas. Preservar as tabelas de histórico para auditoria. O rollback desta funcionalidade não desfaz operações do usuário.

## Fluxo de execução

Código e testes no Codex; histórico e integração no GitHub; banco e publicação no Lovable, sem solicitar regeneração do código ao agente Lovable.

## Evidência de publicação

PR #6 integrado: https://github.com/VictorFurushima/furushimafinanceiro/pull/6. Commit funcional aa508b15340b66b1d1679bf99a61c649e2b212bc. Árvore enviada ao GitHub confere com a árvore testada localmente aa9a3d3f259d2bbbfc2cc6606784751d78842e72.

Migração aplicada e registrada em produção: 19 triggers de captura, 9 funções originais preservadas. Permissões de leitura/escrita e isolamento do contexto privado conferidos. Teste em produção, sob papel authenticated, confirmou captura, reversão integral, idempotência e limpeza do contexto. Todos os registros do teste foram descartados por ROLLBACK.

Publicação 6f9505a5-f0cc-4574-ac0b-8b0948d23d52. Página https://furushimafinanceiro.lovable.app/history responde HTTP 200 e carrega index-ErBNW4qQ.js, history-BXn9qPgW.js e history-CASGkgwF.js. O bundle publicado contém as três RPCs, o título Histórico de ações e Confirmar reversão.

Verificação visual por Chromium/Playwright: 7 verificações passaram, incluindo fluxo navegador → RPC → PostgreSQL → resposta, persistência após recarga, busca sem resultados, conflito criado entre prévia e confirmação, viewport móvel de 390 px, controles do espectador e ausência de erros de página. A sessão foi sintética local e as requisições Supabase foram atendidas por uma instância PGlite com as migrações reais, sem usar credenciais ou dados reais no navegador. O teste SQL em produção e a conferência dos bundles complementam essa evidência; não representam uma sessão real do usuário na tela publicada.

O CLI agent-browser não iniciou o daemon neste ambiente; a inspeção visual usou Playwright diretamente. O servidor e o navegador foram iniciados no mesmo processo de verificação para respeitar o isolamento de rede do ambiente.
