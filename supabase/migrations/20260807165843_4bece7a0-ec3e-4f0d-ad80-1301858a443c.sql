-- Objetivo: mover a automacao financeira do browser (useEffect + localStorage) para o backend via pg_cron.
-- Tabelas afetadas: transactions (insert), balance_recharges (insert/update).
-- Impacto de dados: idempotente via unique parciais ja existentes.
-- RLS: funcao SECURITY DEFINER (cron nao possui auth.uid()); EXECUTE revogado de anon/authenticated/public.
-- Rollback: SELECT cron.unschedule('financial-daily-maintenance'); DROP FUNCTION private.run_financial_daily_maintenance();

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.run_financial_daily_maintenance()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx int := 0;
  v_rc int := 0;
  v_overdue int := 0;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_month_end date := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
BEGIN
  -- 1) transacoes recorrentes para todos os owners
  WITH due AS (
    SELECT
      r.id, r.user_id, r.amount, r.name, r.account_id, r.category_id, r.payment_method,
      CASE
        WHEN r.frequency = 'monthly' THEN
          make_date(
            EXTRACT(YEAR FROM CURRENT_DATE)::int,
            EXTRACT(MONTH FROM CURRENT_DATE)::int,
            LEAST(r.billing_day, EXTRACT(DAY FROM v_month_end)::int)
          )
        WHEN r.frequency = 'yearly' THEN
          make_date(
            EXTRACT(YEAR FROM CURRENT_DATE)::int,
            EXTRACT(MONTH FROM r.start_date)::int,
            EXTRACT(DAY FROM r.start_date)::int
          )
        WHEN r.frequency = 'weekly' THEN
          CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::int - EXTRACT(DOW FROM r.start_date)::int + 7) % 7)
        ELSE CURRENT_DATE
      END AS due_date
    FROM public.recurring_expenses r
    WHERE r.status = 'active'
      AND r.start_date <= CURRENT_DATE
      AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)
  ),
  ins AS (
    INSERT INTO public.transactions
      (user_id, amount, type, description, occurred_at, account_id, category_id, payment_method, recurring_id)
    SELECT d.user_id, d.amount, 'expense', d.name, d.due_date, d.account_id, d.category_id, d.payment_method, d.id
    FROM due d
    WHERE d.due_date <= CURRENT_DATE
    ON CONFLICT (user_id, recurring_id, occurred_at) WHERE recurring_id IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_tx FROM ins;

  -- 2) recargas recorrentes do mes para todos os owners
  WITH src AS (
    SELECT
      r.*,
      make_date(
        EXTRACT(YEAR FROM CURRENT_DATE)::int,
        EXTRACT(MONTH FROM CURRENT_DATE)::int,
        LEAST(
          COALESCE(r.recurring_day, EXTRACT(DAY FROM r.expected_date)::int),
          EXTRACT(DAY FROM v_month_end)::int
        )
      ) AS due_date
    FROM public.balance_recharges r
    WHERE r.is_recurring = true
      AND r.source_recharge_id IS NULL
      AND r.status <> 'cancelada'
  ),
  ins AS (
    INSERT INTO public.balance_recharges
      (user_id, name, recharge_type, expected_amount, expected_date,
       account_id, card_id, payment_method, status, notes, is_recurring, source_recharge_id)
    SELECT s.user_id, s.name, s.recharge_type, s.expected_amount, s.due_date,
           s.account_id, s.card_id, s.payment_method, 'prevista', s.notes, false, s.id
    FROM src s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.balance_recharges b
      WHERE b.source_recharge_id = s.id
        AND b.expected_date >= v_month_start
        AND b.expected_date <= v_month_end
    )
    ON CONFLICT (user_id, source_recharge_id, expected_date) WHERE source_recharge_id IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_rc FROM ins;

  -- 3) recargas vencidas
  UPDATE public.balance_recharges
  SET status = 'atrasada'
  WHERE expected_date < CURRENT_DATE
    AND status IN ('prevista', 'confirmada');
  GET DIAGNOSTICS v_overdue = ROW_COUNT;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'recurring_transactions_created', v_tx,
    'recurring_recharges_created', v_rc,
    'recharges_marked_overdue', v_overdue
  );
END;
$$;

REVOKE ALL ON FUNCTION private.run_financial_daily_maintenance() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.run_financial_daily_maintenance() FROM anon, authenticated;

-- Agendamento idempotente: 03:10 America/Sao_Paulo == 06:10 UTC
DO $do$
BEGIN
  PERFORM cron.unschedule('financial-daily-maintenance')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'financial-daily-maintenance');

  PERFORM cron.schedule(
    'financial-daily-maintenance',
    '10 6 * * *',
    $job$SELECT private.run_financial_daily_maintenance();$job$
  );
END
$do$;