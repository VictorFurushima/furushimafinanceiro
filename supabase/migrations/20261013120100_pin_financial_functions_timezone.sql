-- Objetivo: calcular "hoje" e "mes atual" no fuso America/Sao_Paulo dentro das funcoes financeiras.
--   O banco roda em UTC (padrao Supabase, mantido). Entre 21h e 0h de Brasilia, CURRENT_DATE ja era o
--   dia seguinte: pagamento de fatura e recebimento ficavam com a data de amanha, o painel virava o
--   mes 3h antes e a fatura passava a "atrasada" antes do fim do dia de vencimento.
--   O ajuste fica na configuracao de cada funcao (SET timezone), sem alterar corpo, assinatura ou retorno.
--   O Historico de acoes guarda linhas como jsonb, e timestamptz vira texto no fuso ativo. Como a
--   captura roda dentro dessas funcoes, captura, conflitos e reversao ficam fixos em UTC (o fuso em que
--   todo o historico existente foi gravado); sem isso, desfazer uma acao feita por elas acusaria conflito.
-- Tabelas afetadas: nenhuma estrutura. Datas gravadas daqui em diante usam o dia de Sao Paulo.
-- Impacto de dados: nenhum backfill. O cron diario (06:10 UTC = 03:10 BRT) continua no mesmo dia.
--   Snapshots do historico continuam em UTC, identicos aos ja gravados.
-- RLS: inalterada.
-- Indices/FKs: nenhum.
-- Rollback: ALTER FUNCTION <assinatura> RESET timezone; para cada funcao abaixo.
-- Manutencao: CREATE OR REPLACE dessas funcoes remove o SET timezone; reaplique-o na mesma migration.

-- Historico de acoes: snapshots sempre em UTC, qualquer que seja o fuso de quem escreve.
ALTER FUNCTION private.capture_financial_action() SET timezone TO 'UTC';
ALTER FUNCTION private.financial_action_conflicts(uuid) SET timezone TO 'UTC';
ALTER FUNCTION public.revert_financial_action(uuid) SET timezone TO 'UTC';

-- Regras de negocio: "hoje" e "mes atual" no dia de Sao Paulo.

ALTER FUNCTION private.run_financial_daily_maintenance() SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.generate_recurring_transactions() SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.generate_recurring_recharges() SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.mark_overdue_recharges() SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.get_financial_overview() SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.get_dashboard_snapshot() SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.get_dashboard_bundle(integer) SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.get_monthly_series(integer) SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.pay_credit_card_bill(uuid, uuid) SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.confirm_recharge_as_income(uuid) SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.validate_bill() SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.invest_update_value(uuid, numeric, text) SET timezone TO 'America/Sao_Paulo';
ALTER FUNCTION public.update_investment_details(uuid, text, text, text, numeric, numeric, numeric, date, date, text, text, text, text, text, boolean, text)
  SET timezone TO 'America/Sao_Paulo';
