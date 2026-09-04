-- Objetivo: saldo historico de estatisticas sem duplicar cartao/transferencia.
-- Tabelas afetadas: nenhuma; RPC get_statistics_extras.
-- Impacto de dados: nenhum. Mantem as series de receitas/despesas do dashboard.
-- RLS: invoker e space_owner preservados.
-- Indices/FKs: nenhum; usa transactions_user_date_idx existente.
-- Rollback: nova migration restaurando a definicao anterior da RPC.
CREATE OR REPLACE FUNCTION public.get_statistics_extras(p_from date, p_to date, p_top integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid),
base AS (
  SELECT t.* FROM public.transactions t, o
  WHERE t.user_id = o.uid AND t.occurred_at BETWEEN p_from AND p_to
),
dow AS (
  SELECT jsonb_agg(jsonb_build_object('dow', d, 'total', total) ORDER BY d) AS v
  FROM (
    SELECT g.d, COALESCE(sum(b.amount),0) AS total
    FROM generate_series(0,6) AS g(d)
    LEFT JOIN base b ON EXTRACT(DOW FROM b.occurred_at)::int = g.d
      AND b.type = 'expense' AND COALESCE(b.flow,'real') = 'real'
    GROUP BY g.d
  ) q
),
pay AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', pm, 'total', total) ORDER BY total DESC), '[]'::jsonb) AS v
  FROM (
    SELECT b.payment_method AS pm, sum(b.amount) AS total
    FROM base b
    WHERE b.type='expense' AND COALESCE(b.flow,'real')='real' AND b.payment_method IS NOT NULL
    GROUP BY b.payment_method
  ) q
),
top AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'description', q.description, 'category_name', q.cname, 'amount', q.amount
  ) ORDER BY q.amount DESC), '[]'::jsonb) AS v
  FROM (
    SELECT b.id, b.description, c.name AS cname, b.amount
    FROM base b LEFT JOIN public.categories c ON c.id = b.category_id
    WHERE b.type='expense' AND COALESCE(b.flow,'real')='real'
    ORDER BY b.amount DESC
    LIMIT GREATEST(p_top,1)
  ) q
),
opening AS (
  SELECT
    (SELECT COALESCE(sum(initial_balance),0) FROM public.accounts a, o WHERE a.user_id = o.uid)
    + COALESCE((
        SELECT sum(CASE WHEN t.credit_card_id IS NOT NULL OR t.type='transfer' THEN 0 WHEN t.type='income' THEN t.amount ELSE -t.amount END)
        FROM public.transactions t, o
        WHERE t.user_id = o.uid AND t.occurred_at < p_from
      ),0) AS v
)
SELECT jsonb_build_object(
  'cash_series', COALESCE((SELECT jsonb_agg(jsonb_build_object('month',s.month,'net',s.net) ORDER BY s.month) FROM (
    SELECT date_trunc('month',d)::date AS month, COALESCE((SELECT sum(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END)
      FROM base t WHERE t.credit_card_id IS NULL AND t.type IN ('income','expense') AND date_trunc('month',t.occurred_at)=date_trunc('month',d)),0) AS net
    FROM generate_series(date_trunc('month',p_from),date_trunc('month',p_to),interval '1 month') d
  ) s),'[]'::jsonb),
  'day_of_week', dow.v,
  'payment_breakdown', pay.v,
  'top_expenses', top.v,
  'opening_balance', opening.v
) FROM dow, pay, top, opening;
$function$
;