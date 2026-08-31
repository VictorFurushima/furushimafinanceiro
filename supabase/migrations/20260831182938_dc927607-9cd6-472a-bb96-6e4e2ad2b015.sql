-- Objetivo: reduzir os 7 roundtrips iniciais do dashboard para 1.
-- Tabelas afetadas: nenhuma alteração estrutural. Apenas leitura.
-- RLS: SECURITY INVOKER, respeita as policies atuais; owner resolvido por public.space_owner.
-- Rollback: DROP FUNCTION public.get_dashboard_bundle(integer);

CREATE OR REPLACE FUNCTION public.get_dashboard_bundle(p_months integer DEFAULT 6)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid),
d AS (
  SELECT date_trunc('month', CURRENT_DATE)::date AS cur_s,
         (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date AS cur_e,
         (date_trunc('month', CURRENT_DATE) - interval '1 month')::date AS prev_s,
         (date_trunc('month', CURRENT_DATE) - interval '1 day')::date AS prev_e
),
cur AS (SELECT * FROM d, LATERAL public.get_monthly_financial_summary(d.cur_s, d.cur_e) m),
prev AS (SELECT * FROM d, LATERAL public.get_monthly_financial_summary(d.prev_s, d.prev_e) m),
spend AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'category_id', s.category_id, 'name', s.name, 'color', s.color,
           'icon', s.icon, 'total', s.total) ORDER BY s.total DESC), '[]'::jsonb) AS v
  FROM d, LATERAL public.get_spending_by_category(d.cur_s, d.cur_e) s
),
series AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'month', x.month, 'receitas', x.receitas, 'despesas', x.despesas,
           'aportes', x.aportes, 'resgates', x.resgates) ORDER BY x.month), '[]'::jsonb) AS v
  FROM public.get_monthly_series(GREATEST(COALESCE(p_months, 6), 1)) x
),
recent AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', q.id, 'amount', q.amount, 'type', q.type, 'description', q.description,
           'occurred_at', q.occurred_at, 'category_id', q.category_id, 'flow', q.flow,
           'categories', CASE WHEN q.cat_name IS NULL THEN NULL
                              ELSE jsonb_build_object('name', q.cat_name, 'color', q.cat_color, 'icon', q.cat_icon) END
         ) ORDER BY q.occurred_at DESC, q.created_at DESC), '[]'::jsonb) AS v
  FROM (
    SELECT t.id, t.amount, t.type, t.description, t.occurred_at, t.category_id, t.flow, t.created_at,
           c.name AS cat_name, c.color AS cat_color, c.icon AS cat_icon
    FROM public.transactions t
    LEFT JOIN public.categories c ON c.id = t.category_id
    CROSS JOIN o
    WHERE t.user_id = o.uid
    ORDER BY t.occurred_at DESC, t.created_at DESC
    LIMIT 6
  ) q
)
SELECT jsonb_build_object(
  'overview', public.get_financial_overview(),
  'current_month', jsonb_build_object(
     'receitas', cur.receitas, 'despesas', cur.despesas, 'aportes', cur.aportes,
     'resgates', cur.resgates, 'saldo_liquido', cur.saldo_liquido),
  'previous_month', jsonb_build_object(
     'receitas', prev.receitas, 'despesas', prev.despesas, 'aportes', prev.aportes,
     'resgates', prev.resgates, 'saldo_liquido', prev.saldo_liquido),
  'spending', spend.v,
  'series', series.v,
  'recent_transactions', recent.v,
  'snapshot', public.get_dashboard_snapshot()
)
FROM cur, prev, spend, series, recent;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dashboard_bundle(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_bundle(integer) TO authenticated;