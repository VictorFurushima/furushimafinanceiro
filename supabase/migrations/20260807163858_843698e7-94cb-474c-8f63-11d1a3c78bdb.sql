
-- Aggregation RPCs (SECURITY INVOKER, RLS applies, scoped to resolved space owner)

CREATE OR REPLACE FUNCTION public.get_financial_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
WITH o AS (SELECT public.space_owner(auth.uid()) AS uid),
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
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_financial_summary(p_from date, p_to date)
RETURNS TABLE(receitas numeric, despesas numeric, aportes numeric, resgates numeric, saldo_liquido numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(sum(CASE WHEN t.type='income'  AND COALESCE(t.flow,'real')='real' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.type='expense' AND COALESCE(t.flow,'real')='real' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.flow='contribution' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.flow='redemption'   THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.type='income'  AND COALESCE(t.flow,'real')='real' THEN t.amount
                      WHEN t.type='expense' AND COALESCE(t.flow,'real')='real' THEN -t.amount ELSE 0 END),0)
  FROM public.transactions t
  WHERE t.user_id = public.space_owner(auth.uid())
    AND t.occurred_at BETWEEN p_from AND p_to;
$$;

CREATE OR REPLACE FUNCTION public.get_spending_by_category(p_from date, p_to date)
RETURNS TABLE(category_id uuid, name text, color text, icon text, total numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT c.id, COALESCE(c.name,'Sem categoria'), COALESCE(c.color,'#64748b'), COALESCE(c.icon,'circle'),
         COALESCE(sum(t.amount),0)
  FROM public.transactions t
  LEFT JOIN public.categories c ON c.id = t.category_id
  WHERE t.user_id = public.space_owner(auth.uid())
    AND t.type = 'expense' AND COALESCE(t.flow,'real') = 'real'
    AND t.occurred_at BETWEEN p_from AND p_to
  GROUP BY c.id, c.name, c.color, c.icon
  ORDER BY 5 DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_account_balances()
RETURNS TABLE(id uuid, name text, type text, color text, initial_balance numeric, balance numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT a.id, a.name, a.type, a.color, a.initial_balance,
         a.initial_balance + COALESCE((
           SELECT sum(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END)
           FROM public.transactions t
           WHERE t.account_id = a.id AND t.user_id = a.user_id
         ),0)
  FROM public.accounts a
  WHERE a.user_id = public.space_owner(auth.uid())
  ORDER BY a.created_at;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_series(p_months int DEFAULT 6)
RETURNS TABLE(month date, receitas numeric, despesas numeric, aportes numeric, resgates numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH months AS (
    SELECT generate_series(
      date_trunc('month', CURRENT_DATE) - ((GREATEST(p_months,1) - 1) * interval '1 month'),
      date_trunc('month', CURRENT_DATE),
      interval '1 month'
    )::date AS m
  )
  SELECT months.m,
    COALESCE(sum(CASE WHEN t.type='income'  AND COALESCE(t.flow,'real')='real' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.type='expense' AND COALESCE(t.flow,'real')='real' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.flow='contribution' THEN t.amount ELSE 0 END),0),
    COALESCE(sum(CASE WHEN t.flow='redemption'   THEN t.amount ELSE 0 END),0)
  FROM months
  LEFT JOIN public.transactions t
    ON t.user_id = public.space_owner(auth.uid())
   AND t.occurred_at >= months.m
   AND t.occurred_at < (months.m + interval '1 month')::date
  GROUP BY months.m
  ORDER BY months.m;
$$;

REVOKE ALL ON FUNCTION public.get_financial_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_monthly_financial_summary(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_spending_by_category(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_account_balances() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_monthly_series(int) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_financial_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_financial_summary(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_spending_by_category(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_series(int) TO authenticated;
