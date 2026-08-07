-- Objetivo: resolver space_owner((select auth.uid())) uma vez por statement (InitPlan/CTE) nas RPCs agregadas
-- e tornar get_account_balances set-based.
-- Tabelas afetadas: nenhuma (apenas funcoes). Impacto de dados: nenhum. RLS: inalterada (SECURITY INVOKER).
-- Indices/FKs: nenhum novo. Rollback: restaurar definicoes anteriores das funcoes.

CREATE OR REPLACE FUNCTION public.get_account_balances()
RETURNS TABLE(id uuid, name text, type text, color text, initial_balance numeric, balance numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid),
  acc AS (
    SELECT a.id, a.name, a.type, a.color, a.initial_balance, a.created_at
    FROM public.accounts a, o
    WHERE a.user_id = o.uid
  ),
  agg AS (
    SELECT t.account_id,
           sum(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END) AS delta
    FROM public.transactions t, o
    WHERE t.user_id = o.uid AND t.account_id IS NOT NULL
    GROUP BY t.account_id
  )
  SELECT acc.id, acc.name, acc.type, acc.color, acc.initial_balance,
         acc.initial_balance + COALESCE(agg.delta, 0)
  FROM acc
  LEFT JOIN agg ON agg.account_id = acc.id
  ORDER BY acc.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.get_monthly_financial_summary(p_from date, p_to date)
RETURNS TABLE(receitas numeric, despesas numeric, aportes numeric, resgates numeric, saldo_liquido numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid)
  SELECT
    COALESCE(sum(CASE WHEN t.type='income'  AND COALESCE(t.flow,'real')='real' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.type='expense' AND COALESCE(t.flow,'real')='real' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.flow='contribution' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.flow='redemption'   THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.type='income'  AND COALESCE(t.flow,'real')='real' THEN t.amount
                      WHEN t.type='expense' AND COALESCE(t.flow,'real')='real' THEN -t.amount ELSE 0 END),0)
  FROM public.transactions t, o
  WHERE t.user_id = o.uid
    AND t.occurred_at BETWEEN p_from AND p_to;
$function$;

CREATE OR REPLACE FUNCTION public.get_spending_by_category(p_from date, p_to date)
RETURNS TABLE(category_id uuid, name text, color text, icon text, total numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid)
  SELECT c.id, COALESCE(c.name,'Sem categoria'), COALESCE(c.color,'#64748b'), COALESCE(c.icon,'circle'),
         COALESCE(sum(t.amount),0)
  FROM public.transactions t
  CROSS JOIN o
  LEFT JOIN public.categories c ON c.id = t.category_id
  WHERE t.user_id = o.uid
    AND t.type = 'expense' AND COALESCE(t.flow,'real') = 'real'
    AND t.occurred_at BETWEEN p_from AND p_to
  GROUP BY c.id, c.name, c.color, c.icon
  ORDER BY 5 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_monthly_series(p_months integer DEFAULT 6)
RETURNS TABLE(month date, receitas numeric, despesas numeric, aportes numeric, resgates numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid),
  months AS (
    SELECT generate_series(
      date_trunc('month', CURRENT_DATE) - ((GREATEST(p_months,1) - 1) * interval '1 month'),
      date_trunc('month', CURRENT_DATE),
      interval '1 month'
    )::date AS m
  ),
  tx AS (
    SELECT t.occurred_at, t.type, t.flow, t.amount
    FROM public.transactions t, o
    WHERE t.user_id = o.uid
      AND t.occurred_at >= (SELECT min(m) FROM months)
      AND t.occurred_at < ((SELECT max(m) FROM months) + interval '1 month')::date
  )
  SELECT months.m,
    COALESCE(sum(CASE WHEN tx.type='income'  AND COALESCE(tx.flow,'real')='real' THEN tx.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN tx.type='expense' AND COALESCE(tx.flow,'real')='real' THEN tx.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN tx.flow='contribution' THEN tx.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN tx.flow='redemption'   THEN tx.amount ELSE 0 END),0)
  FROM months
  LEFT JOIN tx
    ON tx.occurred_at >= months.m
   AND tx.occurred_at < (months.m + interval '1 month')::date
  GROUP BY months.m
  ORDER BY months.m;
$function$;

CREATE OR REPLACE FUNCTION public.get_financial_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid),
ms AS (SELECT date_trunc('month', CURRENT_DATE)::date AS s,
              (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date AS e),
acc AS (SELECT COALESCE(sum(initial_balance),0) AS v FROM public.accounts, o WHERE user_id = o.uid),
tx AS (
  SELECT
    COALESCE(sum(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END),0) AS net,
    COALESCE(sum(CASE WHEN t.type='expense' AND COALESCE(t.flow,'real')='real' AND t.occurred_at BETWEEN ms.s AND ms.e THEN t.amount ELSE 0 END),0) AS gastos_mes,
    COALESCE(sum(CASE WHEN t.type='income'  AND COALESCE(t.flow,'real')='real' AND t.occurred_at BETWEEN ms.s AND ms.e THEN t.amount ELSE 0 END),0) AS receitas_mes,
    COALESCE(sum(CASE WHEN t.flow='contribution' AND t.occurred_at BETWEEN ms.s AND ms.e THEN t.amount ELSE 0 END),0) AS aportes_mes,
    COALESCE(sum(CASE WHEN t.flow='redemption'   AND t.occurred_at BETWEEN ms.s AND ms.e THEN t.amount ELSE 0 END),0) AS resgates_mes
  FROM public.transactions t, o, ms WHERE t.user_id = o.uid
),
inv AS (
  SELECT COALESCE(sum(invested_amount),0) AS investido, COALESCE(sum(current_amount),0) AS atual
  FROM public.investments, o WHERE user_id = o.uid AND status <> 'resgatado'
),
rec AS (
  SELECT COALESCE(sum(amount),0) AS fixos,
         COALESCE(sum(CASE WHEN billing_day >= EXTRACT(DAY FROM CURRENT_DATE)::int THEN amount ELSE 0 END),0) AS pendentes
  FROM public.recurring_expenses, o WHERE user_id = o.uid AND status='active' AND frequency='monthly'
),
bills AS (
  SELECT COALESCE(sum(amount),0) AS abertas,
         COALESCE(sum(CASE WHEN due_date BETWEEN ms.s AND ms.e THEN amount ELSE 0 END),0) AS previstas
  FROM public.credit_card_bills b, o, ms WHERE b.user_id = o.uid AND b.status <> 'paga'
),
rch AS (
  SELECT COALESCE(sum(expected_amount),0) AS seguras
  FROM public.balance_recharges r, o, ms
  WHERE r.user_id = o.uid AND r.recharge_type='fixed_income'
    AND r.status IN ('prevista','confirmada','recebida')
    AND r.expected_date BETWEEN ms.s AND ms.e
),
st AS (SELECT s.* FROM public.user_settings s, o WHERE s.user_id = o.uid)
SELECT jsonb_build_object(
  'saldo_disponivel', acc.v + tx.net,
  'total_investido', inv.investido,
  'valor_atual_investimentos', inv.atual,
  'rendimento_total', inv.atual - inv.investido,
  'patrimonio_total', acc.v + tx.net + inv.atual,
  'gastos_reais_mes', tx.gastos_mes,
  'receitas_reais_mes', tx.receitas_mes,
  'aportes_mes', tx.aportes_mes,
  'resgates_mes', tx.resgates_mes,
  'gastos_fixos', rec.fixos,
  'contas_pendentes', rec.pendentes,
  'faturas_abertas', bills.abertas,
  'faturas_previstas', bills.previstas,
  'receitas_previstas_seguras', rch.seguras,
  'min_reserve', COALESCE((SELECT min_reserve FROM st),0),
  'max_free_balance_pct', COALESCE((SELECT max_free_balance_pct FROM st),30),
  'max_income_installment_pct', COALESCE((SELECT max_income_installment_pct FROM st),20),
  'aportes_programados', COALESCE((SELECT CASE WHEN reminder_enabled THEN reminder_amount ELSE 0 END FROM st),0)
)
FROM acc, tx, inv, rec, bills, rch;
$function$;

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
        SELECT sum(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END)
        FROM public.transactions t, o
        WHERE t.user_id = o.uid AND t.occurred_at < p_from
      ),0) AS v
)
SELECT jsonb_build_object(
  'day_of_week', dow.v,
  'payment_breakdown', pay.v,
  'top_expenses', top.v,
  'opening_balance', opening.v
) FROM dow, pay, top, opening;
$function$;