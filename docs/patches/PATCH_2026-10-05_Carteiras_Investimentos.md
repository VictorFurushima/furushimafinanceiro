# Patch de 05/10/2026: Carteira Global e investimentos

## Comportamento entregue

Carteira Global em /global-wallet consolida o capital registrado: saldo disponível em contas e dinheiro físico + valor atual das posições de investimento. Exibe disponível, valor de investimentos, capital aplicado, resultado das posições e valor após faturas pendentes. Metas, limite de cartão, receita prevista e a reserva de emergência não são somados novamente. Lançamentos sem conta aparecem como saldo a classificar. Contas e demais módulos continuam disponíveis. A Visão Geral mantém sua interface e passa a usar a mesma cotação na agregação.

Carteira de Investimentos em /investments oferece acompanhamento manual ou cotado. Ações/FIIs/ativos negociados usam ticker na brapi. Cripto usa o identificador CoinGecko. A posição cotada exige quantidade e calcula quantidade × preço, em BRL. Fonte, data de referência, última consulta, pendência, falha e atraso são visíveis. Preço unitário mantém até 12 casas decimais. O valor de mercado é bruto e não representa saldo líquido ou disponível para resgate.

Cadastro representa posição existente e não debita contas. Aportes/compras e resgates/vendas exigem uma conta de origem/destino. Posições cotadas também exigem a quantidade efetivamente negociada. A RPC atualiza dinheiro, posição, custo proporcional e evento na mesma transação. A operação não entra como consumo/receita real. Resgate parcial preserva o custo proporcional das unidades restantes. Cadastro com centavos preserva o valor ao editar.

Resultado das posições significa valor atual menos capital aplicado restante. Não é uma apuração fiscal, um relatório de ganhos realizados, rentabilidade ponderada por fluxos ou importação automática de dividendos. A antiga estimativa mensal foi renomeada para média mensal acumulada e explica seu cálculo.

## Cotações e histórico

pg_cron agenda investment-quotes-30min em */30 * * * * e investment-quotes-collect em */2 * * * *. As consultas funcionam com o site fechado. pg_net envia HTTP fora da transação. O coletor valida resposta, moeda, preço positivo, finitude, data e ordem temporal. A coleta mantém a última cotação válida em caso de erro. Referências anteriores não sobrescrevem posteriores. Cada fonte/ativo tem cache compartilhado, trava contra concorrência e intervalo mínimo de 30 minutos por tentativa. Até 100 requisições por execução. Falhas são tentadas novamente no próximo ciclo. As telas recarregam os dados do servidor a cada 2 minutos enquanto abertas.

Histórico unitário mantém cotações observadas. Histórico do valor da carteira captura valor/aplicado e contagens manual/pendente em janelas de 30 minutos. Gráficos mostram o último registro diário dos últimos 90 dias. Retenção de 180 dias. Não se inventam datas anteriores. Observações de mercado ficam fora do histórico reversível. Desfazer aporte restaura dinheiro e unidades e usa a cotação atual. Configuração e exclusão da posição entram no histórico financeiro.

Chaves brapi e CoinGecko Demo são próprias de cada titular e ficam criptografadas no Supabase Vault. A interface só lê status de configuração. Nenhuma chave foi fornecida, contratada, criada em conta externa ou publicada. Sem chave, brapi permite PETR4, VALE3, ITUB4 e MGLU3. Outros tickers dependem do plano/cobertura. CoinGecko exige chave Demo. O sistema não promete cobertura gratuita de todos os ativos.

CDB, LCI/LCA, fundos, Tesouro, poupança e outros produtos sem adaptador conectado continuam com valor manual identificado. A conexão a banco/corretora, saldo líquido, impostos, proventos automáticos, identificação específica desses contratos e reconciliação com extrato exigem a escolha da instituição/fonte e não foram simulados nesta entrega.

## Banco e controle de acesso

Migrações aplicadas e registradas: 20261005194500_investment_positions, 20261005194600_wallet_market_overview, 20261005194700_investment_quote_sync e 20261005200500_investment_valuation_history.

Tabela pública investment_tracking com FK CASCADE para investments, FK para usuário, posição única por investimento e índice de fonte/ativo. Leitura com RLS do titular/espectador. Sem escrita direta pelo cliente. Nenhuma coluna adicionada às tabelas antigas de investimentos/eventos, preservando snapshots já gravados. Histórico financeiro passa a monitorar 20 tabelas, com ordem correta de restauração da posição.

Tabelas privadas investment_quotes, investment_quote_history, investment_quote_requests, investment_credentials e investment_valuation_history. Tabelas/segredos sem acesso direto de anon/authenticated. RPCs de escrita verificam administrador e propriedade. Espectador consulta e não configura chaves, sincroniza ou movimenta capital. RPCs antigas bloqueiam posições cotadas sem unidades. RPC get_financial_overview usa as mesmas marcações.

Sem backfill, sem alteração dos saldos existentes. Havia zero investimentos antes da migração e duas contas, banco digital e dinheiro físico. Nenhum investimento pessoal foi inventado. Cache real inicial de PETR4 serve apenas à fonte de preços.

## Verificação e evidência

97 verificações passaram: 19 de ledger, 29 de importação/parcelas, 27 de histórico e 22 novas de carteiras. TypeScript, ESLint dos arquivos alterados e build passaram.

10 verificações Chromium/Playwright: total Global e composição, navegação, origem/data da cotação, edição preservando centavos, compra navegador → RPC → PostgreSQL → resposta, recarga após reversão com preço novo, histórico unitário, chave em campo password, duas carteiras em 390 px sem overflow, espectador e ausência de erros de página/RPC. Sessão local sintética. Requisições Supabase atendidas por PGlite com migrações reais. Rede HTTP/Vault/cron usam stubs locais. Não equivale a login real do titular no site publicado. agent-browser não suporta este ambiente, usado Playwright diretamente.

Em produção, teste SQL sob authenticated confirmou cadastro, aporte, patrimônio sem duplicação e reversão após mudança da cotação. Registros sintéticos e a mudança de preço do teste foram descartados por ROLLBACK. Captura/undo no mesmo teste exigiu deslocar chaves temporárias de agrupamento, também descartadas. Consulta real brapi retornou HTTP 200, persistiu PETR4 a R$ 55,55, referência 05/10/2026 16:59:30 America/Sao_Paulo, conferida às 17:00:37. Preço é evidência daquela consulta, não valor permanentemente atual.

RLS/permissões conferidas: authenticated sem UPDATE da posição nem SELECT de credenciais. anon sem EXECUTE de Carteira Global. Dois jobs ativos. Quatro migrações registradas.

GitHub PR #7: https://github.com/VictorFurushima/furushimafinanceiro/pull/7. Commit funcional integrado bf36664f555f5540e91ce5f9ad53293ac0485c45. Árvore funcional dbd38e0945e0e3dc2ee93f0cdcd2f5ac2b33a0e3 confere entre código testado e GitHub. Código/testes no Codex, sincronização GitHub, banco/publicação Lovable. Sem regenerar código em chat do Lovable.

## Uso

1. Abra Carteira Global para consultar capital e composição.
2. Abra Carteira de Investimentos e cadastre as posições existentes.
3. Para B3/cripto, escolha fonte, identificador e quantidade. Configure chave em Fontes quando exigida.
4. Para posições manuais, informe o valor do extrato.
5. Use Registrar aporte/resgate para novas movimentações. Informe conta e unidades executadas.
6. Atualizar cotações respeita o intervalo de consulta e recarrega os dados existentes. Novas respostas chegam em até 2 minutos após envio.
7. Use Histórico de ações para desfazer uma operação compatível. A cotação permanece atual.

## Rollback e continuidade

Antes de remover estrutura, manter exportação e checkpoint dos dados. Voltar frontend ao commit anterior, desativar jobs com cron.unschedule('investment-quotes-30min') e cron.unschedule('investment-quotes-collect'), restaurar get_financial_overview anterior e suspender uso das RPCs novas. Preservar posições e ações existentes, remover FK/tabela de posições só após plano de migração. Não remover Vault/pg_net/pg_cron globais nem apagar outras chaves. Segredos não fazem parte da reversão financeira.

Próximo passo para cobrir produtos bancários: informar bancos/corretoras e tipos de aplicação, escolher provedor com cobertura/custo verificados, conectar mediante consentimento específico e reconciliar posição, valor bruto/líquido e resgate com extrato. Não habilitar cálculos por Selic/CDI como se fossem saldos reais.

Fontes: https://brapi.dev/docs, https://brapi.dev/docs/acoes, https://docs.coingecko.com/demo/reference/simple-price, https://supabase.com/docs/guides/database/extensions/pg_net.

## Publicação confirmada

Publicação c44a1cb1-bbbe-49d6-98f1-5e7fdceb7e7d confirmada pelo header x-deployment-id do site. /global-wallet responde HTTP 200 e traz Carteira Global no título. Bundle global-wallet-DJtgBdmI.js contém get_global_wallet e os totais. /investments traz Carteira de Investimentos no título e usa investments-CiudltGH.js e use-app-data-DLjU9qS3.js. Coletor cron registrou execução succeeded. Após o teste de produção continuam zero investimentos e zero usuários sintéticos wallet-smoke no banco.

PDF entregue: PATCH_2026-10-05_Carteiras_Investimentos.pdf, duas páginas, com instruções, cobertura, validação e checkpoint. Não contém chaves ou dados pessoais de investimentos.
