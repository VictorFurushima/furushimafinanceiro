-- Migration: optimize_recurring_functions
-- Objetivo: tornar as rotinas recorrentes set-based e idempotentes.
-- Impacto: 1 statement em vez de N; duplicidade impedida pelos indices unicos parciais.
-- Rollback sugerido: restaurar as versoes anteriores (FOR LOOP + NOT EXISTS).

CREATE OR REPLACE FUNCTION public.generate_recurring_transactions()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

  WITH due AS (
    SELECT
      r.id, r.user_id, r.amount, r.name, r.account_id, r.category_id, r.payment_method,
      CASE
        WHEN r.frequency = 'monthly' THEN
          make_date(
            EXTRACT(YEAR FROM CURRENT_DATE)::int,
            EXTRACT(MONTH FROM CURRENT_DATE)::int,
            LEAST(r.billing_day, EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int)
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
    WHERE r.user_id = v_uid
      AND r.status = 'active'
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
  SELECT count(*)::int INTO v_count FROM ins;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_recharges()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count int := 0;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_month_end date := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

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
    WHERE r.user_id = v_uid
      AND r.is_recurring = true
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
    -- evita EXTRACT sobre a coluna indexada: usa limites do mes
    WHERE NOT EXISTS (
      SELECT 1 FROM public.balance_recharges b
      WHERE b.user_id = v_uid
        AND b.source_recharge_id = s.id
        AND b.expected_date >= v_month_start
        AND b.expected_date <= v_month_end
    )
    ON CONFLICT (user_id, source_recharge_id, expected_date) WHERE source_recharge_id IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_overdue_recharges()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  UPDATE public.balance_recharges
  SET status = 'atrasada'
  WHERE user_id = v_uid
    AND expected_date < CURRENT_DATE
    AND status IN ('prevista', 'confirmada');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
