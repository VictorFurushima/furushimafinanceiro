-- Objetivo: RPC compacta para o dashboard, evitando baixar datasets completos de recharges/cards/bills/recurring.
-- Tabelas afetadas: nenhuma (leitura). Impacto de dados: nenhum.
-- RLS: SECURITY INVOKER + STABLE, escopada por space_owner((select auth.uid())).
-- Indices: reutiliza os existentes. Rollback: DROP FUNCTION public.get_dashboard_snapshot();

CREATE OR REPLACE FUNCTION public.get_dashboard_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid),
ms AS (SELECT date_trunc('month', CURRENT_DATE)::date AS s,
              (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date AS e),
r AS (
  SELECT b.* FROM public.balance_recharges b, o WHERE b.user_id = o.uid
),
r_month AS (
  SELECT r.* FROM r, ms
  WHERE r.expected_date BETWEEN ms.s AND ms.e
    AND r.status <> 'cancelada'
    AND r.recharge_type NOT IN ('bill_payment','limit_release')
),
r_tot AS (
  SELECT
    COALESCE(sum(CASE WHEN status IN ('prevista','confirmada') THEN expected_amount ELSE 0 END),0) AS previsto,
    COALESCE(sum(CASE WHEN status IN ('confirmada','recebida') THEN expected_amount ELSE 0 END),0) AS confirmado
  FROM r_month
),
r_next AS (
  SELECT jsonb_build_object(
           'name', name, 'expected_amount', expected_amount, 'expected_date', expected_date,
           'days', (expected_date - CURRENT_DATE)
         ) AS v
  FROM r
  WHERE status IN ('prevista','confirmada') AND expected_date >= CURRENT_DATE
  ORDER BY expected_date
  LIMIT 1
),
r_counts AS (
  SELECT
    count(*) FILTER (WHERE status = 'atrasada')::int AS overdue,
    count(*) FILTER (
      WHERE status IN ('prevista','confirmada')
        AND expected_date >= CURRENT_DATE
        AND expected_date <= CURRENT_DATE + 3
    )::int AS upcoming
  FROM r
),
c AS (SELECT cc.* FROM public.credit_cards cc, o WHERE cc.user_id = o.uid),
c_list AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id, 'name', q.name, 'total_limit', q.total_limit, 'used_limit', q.used_limit
         ) ORDER BY q.created_at), '[]'::jsonb) AS v
  FROM (SELECT id, name, total_limit, used_limit, created_at FROM c ORDER BY created_at LIMIT 3) q
),
c_stats AS (
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE total_limit > 0 AND (total_limit - used_limit) / total_limit < 0.2)::int AS low
  FROM c
),
b_list AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id, 'card_name', q.card_name, 'amount', q.amount,
           'due_date', q.due_date, 'days', q.days
         ) ORDER BY q.days), '[]'::jsonb) AS v,
         (SELECT count(*)::int FROM public.credit_card_bills bb, o
           WHERE bb.user_id = o.uid AND bb.status <> 'paga'
             AND (bb.due_date - CURRENT_DATE) <= 5) AS total
  FROM (
    SELECT bb.id, cc.name AS card_name, bb.amount, bb.due_date,
           (bb.due_date - CURRENT_DATE) AS days
    FROM public.credit_card_bills bb
    LEFT JOIN public.credit_cards cc ON cc.id = bb.card_id
    CROSS JOIN o
    WHERE bb.user_id = o.uid AND bb.status <> 'paga'
      AND (bb.due_date - CURRENT_DATE) <= 5
    ORDER BY days
    LIMIT 4
  ) q
),
s_list AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id, 'name', q.name, 'amount', q.amount, 'days', q.days
         ) ORDER BY q.days), '[]'::jsonb) AS v
  FROM (
    SELECT re.id, re.name, re.amount,
           (CASE
              WHEN re.billing_day >= EXTRACT(DAY FROM CURRENT_DATE)::int
                THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int,
                               LEAST(re.billing_day, EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int))
              ELSE make_date(EXTRACT(YEAR FROM (CURRENT_DATE + interval '1 month'))::int,
                             EXTRACT(MONTH FROM (CURRENT_DATE + interval '1 month'))::int,
                             LEAST(re.billing_day, EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE + interval '1 month') + interval '1 month - 1 day'))::int))
            END - CURRENT_DATE) AS days
    FROM public.recurring_expenses re, o
    WHERE re.user_id = o.uid AND re.status = 'active' AND re.frequency = 'monthly'
    ORDER BY days
    LIMIT 4
  ) q
)
SELECT jsonb_build_object(
  'recharges_previsto_mes', r_tot.previsto,
  'recharges_confirmado_mes', r_tot.confirmado,
  'recharges_restante_mes', r_tot.previsto,
  'next_recharge', (SELECT v FROM r_next),
  'recharges_overdue_count', r_counts.overdue,
  'recharges_upcoming_count', r_counts.upcoming,
  'cards', c_list.v,
  'cards_count', c_stats.total,
  'cards_low_limit_count', c_stats.low,
  'upcoming_bills', b_list.v,
  'upcoming_bills_count', b_list.total,
  'upcoming_subscriptions', s_list.v
)
FROM r_tot, r_counts, c_list, c_stats, b_list, s_list;
$function$;