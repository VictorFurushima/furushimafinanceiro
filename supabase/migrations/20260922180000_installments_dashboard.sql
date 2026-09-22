-- Objetivo: consultar compras parceladas sem criar outro ledger financeiro.
-- Tabelas afetadas: leitura de transactions, credit_card_bill_items, credit_card_bills, credit_cards, categories.
-- Impacto de dados: nenhum; nenhuma transacao ou parcela e criada por esta consulta.
-- RLS: preservada; RPC STABLE SECURITY INVOKER, escopo space_owner.
-- Indices/FKs: reutiliza FKs e indices existentes do ledger.
-- Rollback: DROP FUNCTION public.get_installments(uuid,text,text,integer,integer);

CREATE FUNCTION public.get_installments(
  p_card_id uuid DEFAULT NULL, p_status text DEFAULT 'all', p_search text DEFAULT '',
  p_page integer DEFAULT 0, p_page_size integer DEFAULT 20
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
WITH owner AS (SELECT public.space_owner((SELECT auth.uid())) AS id),
clock AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today),
purchases AS (
  SELECT t.id,t.description,t.amount,t.occurred_at,t.installment_count,
    t.credit_card_id,c.name AS card_name,cat.name AS category_name,
    count(*) FILTER (WHERE b.status='paga')::int AS paid_count,
    count(*) FILTER (WHERE b.status<>'paga' AND b.due_date<clock.today)::int AS overdue_count,
    coalesce(sum(i.amount) FILTER (WHERE b.status='paga'),0) AS paid_amount,
    coalesce(sum(i.amount) FILTER (WHERE b.status<>'paga'),0) AS remaining_amount,
    coalesce(sum(i.amount) FILTER (WHERE b.status<>'paga' AND b.due_date<clock.today),0) AS overdue_amount,
    coalesce(sum(i.amount) FILTER (WHERE b.status<>'paga' AND date_trunc('month',b.due_date)=date_trunc('month',clock.today)),0) AS current_month_amount,
    min(b.due_date) FILTER (WHERE b.status<>'paga') AS next_due_date,
    max(b.due_date) AS last_due_date,
    jsonb_agg(jsonb_build_object('number',i.installment_number,'amount',i.amount,
      'due_date',b.due_date,'payment_date',b.payment_date,'bill_id',b.id,
      'status',CASE WHEN b.status='paga' THEN 'paid' WHEN b.due_date<clock.today THEN 'overdue' ELSE 'pending' END)
      ORDER BY i.installment_number) AS installments
  FROM transactions t JOIN owner ON owner.id=t.user_id CROSS JOIN clock
  JOIN credit_cards c ON c.id=t.credit_card_id
  JOIN credit_card_bill_items i ON i.transaction_id=t.id
  JOIN credit_card_bills b ON b.id=i.bill_id
  LEFT JOIN categories cat ON cat.id=t.category_id
  WHERE t.installment_count>1 AND t.flow='real'
    AND (p_card_id IS NULL OR t.credit_card_id=p_card_id)
    AND (coalesce(p_search,'')='' OR t.description ILIKE '%'||left(p_search,100)||'%')
  GROUP BY t.id,c.name,cat.name
), filtered AS (
  SELECT * FROM purchases WHERE coalesce(p_status,'all')='all'
    OR (p_status='active' AND remaining_amount>0)
    OR (p_status='paid' AND remaining_amount=0)
    OR (p_status='overdue' AND overdue_count>0)
), page AS (
  SELECT * FROM filtered ORDER BY occurred_at DESC,id
  LIMIT least(greatest(coalesce(p_page_size,20),1),50)
  OFFSET greatest(coalesce(p_page,0),0)*least(greatest(coalesce(p_page_size,20),1),50)
), months AS (
  SELECT (date_trunc('month',clock.today)+make_interval(months=>n))::date AS month
  FROM clock CROSS JOIN generate_series(0,11) n
), forecast AS (
  SELECT months.month,coalesce(sum(i.amount),0) AS amount FROM months
  LEFT JOIN credit_card_bills b ON date_trunc('month',b.due_date)=months.month AND b.status<>'paga'
  LEFT JOIN credit_card_bill_items i ON i.bill_id=b.id AND i.transaction_id IN (SELECT id FROM purchases)
  GROUP BY months.month
)
SELECT jsonb_build_object(
  'count',(SELECT count(*) FROM filtered),
  'summary',(SELECT jsonb_build_object('active_count',count(*) FILTER (WHERE remaining_amount>0),
    'remaining_amount',coalesce(sum(remaining_amount),0),'current_month_amount',coalesce(sum(current_month_amount),0),
    'overdue_amount',coalesce(sum(overdue_amount),0)) FROM purchases),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),
  'forecast',coalesce((SELECT jsonb_agg(to_jsonb(forecast) ORDER BY month) FROM forecast),'[]'::jsonb)
);
$$;
REVOKE ALL ON FUNCTION public.get_installments(uuid,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_installments(uuid,text,text,integer,integer) TO authenticated;
