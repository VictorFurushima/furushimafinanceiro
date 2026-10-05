-- Objetivo: usar a mesma cotacao na Visao Geral e na Carteira Global.
-- Tabelas afetadas: nenhuma. Ajuste da RPC get_financial_overview.
-- Impacto de dados: nenhum.
-- RLS: preservada, leitura pelo titular do espaco.
-- Indices/FKs: nenhum.
-- Rollback: restaurar a definicao anterior de get_financial_overview.
CREATE OR REPLACE FUNCTION public.get_financial_overview()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
WITH o AS (SELECT public.space_owner((SELECT auth.uid())) AS uid),
ms AS (SELECT date_trunc('month', CURRENT_DATE)::date AS s,
              (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date AS e),
acc AS (SELECT COALESCE(sum(initial_balance),0) AS v FROM public.accounts, o WHERE user_id = o.uid),
tx AS (
  SELECT
    -- transferencias se anulam e compra no cartao nao move conta
    COALESCE(sum(CASE
      WHEN t.type='income'  AND t.credit_card_id IS NULL THEN t.amount
      WHEN t.type='expense' AND t.credit_card_id IS NULL THEN -t.amount
      ELSE 0 END),0) AS net,
    COALESCE(sum(CASE WHEN t.type='expense' AND COALESCE(t.flow,'real')='real' AND t.occurred_at BETWEEN ms.s AND ms.e THEN t.amount ELSE 0 END),0) AS gastos_mes,
    COALESCE(sum(CASE WHEN t.type='income'  AND COALESCE(t.flow,'real')='real' AND t.occurred_at BETWEEN ms.s AND ms.e THEN t.amount ELSE 0 END),0) AS receitas_mes,
    COALESCE(sum(CASE WHEN t.flow='contribution' AND t.occurred_at BETWEEN ms.s AND ms.e THEN t.amount ELSE 0 END),0) AS aportes_mes,
    COALESCE(sum(CASE WHEN t.flow='redemption'   AND t.occurred_at BETWEEN ms.s AND ms.e THEN t.amount ELSE 0 END),0) AS resgates_mes
  FROM public.transactions t, o, ms WHERE t.user_id = o.uid
),
inv AS (
  SELECT COALESCE(sum(invested_amount),0) AS investido, COALESCE(sum(CASE WHEN t.quantity=0 THEN 0 WHEN t.id IS NOT NULL AND q.price IS NOT NULL THEN round(t.quantity*q.price,2) ELSE i.current_amount END),0) AS atual
  FROM public.investments i LEFT JOIN public.investment_tracking t ON t.investment_id=i.id AND t.user_id=i.user_id LEFT JOIN private.investment_quotes q ON q.provider=t.provider AND q.asset_code=t.asset_code, o WHERE i.user_id = o.uid AND i.status <> 'resgatado'
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
