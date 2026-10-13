-- Objetivo: impedir ocorrencias recorrentes duplicadas, retroativas ou diarias.
--   * Recarga recorrente: o proprio cadastro e a primeira ocorrencia. Copias so nascem nos meses
--     seguintes ao mes de expected_date do modelo (antes: copia no mesmo mes e ate antes do inicio).
--   * Assinatura: nenhuma ocorrencia anterior a start_date (antes: assinatura criada depois do dia de
--     cobranca lancava a cobranca do mes corrente com data anterior ao inicio).
--   * Frequencia legada 'custom' nao tem agenda: deixa de gerar uma despesa por dia.
-- Tabelas afetadas: public.transactions e public.balance_recharges (somente linhas geradas daqui em diante).
-- Impacto de dados: nenhum backfill nem exclusao. A unica copia duplicada encontrada em producao
--   (recarga gerada pelo cron em 06/10/2026) foi cancelada manualmente em 13/10 com autorizacao do titular.
-- RLS: inalterada. Funcoes mantem SECURITY e ACL atuais (CREATE OR REPLACE preserva permissoes).
-- Indices/FKs: nenhum.
-- Rollback: reaplicar generate_recurring_transactions e run_financial_daily_maintenance de
--   20260904190200_full_project_hardening.sql e generate_recurring_recharges de
--   20260807162849_9bdcd0d1-f9c6-4c98-9d8a-3f9edb7fe243.sql.

CREATE OR REPLACE FUNCTION public.generate_recurring_transactions()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE uid uuid:=auth.uid(); created_count integer:=0;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RETURN 0; END IF;
  WITH due AS (
    SELECT r.*,
      CASE
        WHEN r.frequency='monthly' THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,EXTRACT(MONTH FROM CURRENT_DATE)::int,
          LEAST(r.billing_day,EXTRACT(DAY FROM (date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day'))::int))
        WHEN r.frequency='yearly' THEN
          make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,EXTRACT(MONTH FROM r.start_date)::int,1)
          + LEAST(r.billing_day,EXTRACT(DAY FROM (
              date_trunc('month',make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,EXTRACT(MONTH FROM r.start_date)::int,1))
              + interval '1 month - 1 day'))::int)-1
        WHEN r.frequency='weekly' THEN CURRENT_DATE-((EXTRACT(DOW FROM CURRENT_DATE)::int-EXTRACT(DOW FROM r.start_date)::int+7)%7)
      END AS due_date
    FROM public.recurring_expenses r
    WHERE r.user_id=uid AND r.status='active' AND r.frequency IN ('monthly','weekly','yearly')
      AND r.start_date<=CURRENT_DATE AND (r.end_date IS NULL OR r.end_date>=CURRENT_DATE)
      AND (r.payment_method<>'credito' OR r.credit_card_id IS NOT NULL)
  ), ins AS (
    INSERT INTO public.transactions
      (user_id,amount,type,flow,description,occurred_at,account_id,credit_card_id,category_id,payment_method,recurring_id)
    SELECT d.user_id,d.amount,'expense','real',d.name,d.due_date,
      CASE WHEN d.payment_method='credito' THEN NULL ELSE d.account_id END,
      CASE WHEN d.payment_method='credito' THEN d.credit_card_id ELSE NULL END,
      d.category_id,d.payment_method,d.id
    FROM due d
    -- Nunca lanca cobranca anterior ao inicio da assinatura.
    WHERE d.due_date<=CURRENT_DATE AND d.due_date>=d.start_date
    ON CONFLICT (user_id,recurring_id,occurred_at) WHERE recurring_id IS NOT NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*)::int INTO created_count FROM ins;
  RETURN created_count;
END $$;

CREATE OR REPLACE FUNCTION public.generate_recurring_recharges()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
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
      -- O modelo ja representa o mes de expected_date; copias so nos meses seguintes.
      AND r.expected_date < v_month_start
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
$$;

CREATE OR REPLACE FUNCTION private.run_financial_daily_maintenance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tx_count int:=0; recharge_count int:=0; overdue_count int:=0; overdue_bill_count int:=0;
  month_start date:=date_trunc('month',CURRENT_DATE)::date;
  month_end date:=(date_trunc('month',CURRENT_DATE)+interval '1 month - 1 day')::date;
BEGIN
  WITH due AS (
    SELECT r.*,
      CASE
        WHEN r.frequency='monthly' THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,EXTRACT(MONTH FROM CURRENT_DATE)::int,LEAST(r.billing_day,EXTRACT(DAY FROM month_end)::int))
        WHEN r.frequency='yearly' THEN
          make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,EXTRACT(MONTH FROM r.start_date)::int,1)
          + LEAST(r.billing_day,EXTRACT(DAY FROM (
              date_trunc('month',make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,EXTRACT(MONTH FROM r.start_date)::int,1))
              + interval '1 month - 1 day'))::int)-1
        WHEN r.frequency='weekly' THEN CURRENT_DATE-((EXTRACT(DOW FROM CURRENT_DATE)::int-EXTRACT(DOW FROM r.start_date)::int+7)%7)
      END AS due_date
    FROM public.recurring_expenses r
    WHERE r.status='active' AND r.frequency IN ('monthly','weekly','yearly')
      AND r.start_date<=CURRENT_DATE AND (r.end_date IS NULL OR r.end_date>=CURRENT_DATE)
      AND (r.payment_method<>'credito' OR r.credit_card_id IS NOT NULL)
  ), ins AS (
    INSERT INTO public.transactions
      (user_id,amount,type,flow,description,occurred_at,account_id,credit_card_id,category_id,payment_method,recurring_id)
    SELECT d.user_id,d.amount,'expense','real',d.name,d.due_date,
      CASE WHEN d.payment_method='credito' THEN NULL ELSE d.account_id END,
      CASE WHEN d.payment_method='credito' THEN d.credit_card_id ELSE NULL END,
      d.category_id,d.payment_method,d.id
    FROM due d WHERE d.due_date<=CURRENT_DATE AND d.due_date>=d.start_date
    ON CONFLICT (user_id,recurring_id,occurred_at) WHERE recurring_id IS NOT NULL DO NOTHING RETURNING 1
  ) SELECT count(*)::int INTO tx_count FROM ins;

  WITH src AS (
    SELECT r.*,make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,EXTRACT(MONTH FROM CURRENT_DATE)::int,
      LEAST(COALESCE(r.recurring_day,EXTRACT(DAY FROM r.expected_date)::int),EXTRACT(DAY FROM month_end)::int)) AS due_date
    FROM public.balance_recharges r
    WHERE r.is_recurring=true AND r.source_recharge_id IS NULL AND r.status<>'cancelada'
      AND r.expected_date<month_start
  ), ins AS (
    INSERT INTO public.balance_recharges
      (user_id,name,recharge_type,expected_amount,expected_date,account_id,card_id,payment_method,status,notes,is_recurring,source_recharge_id)
    SELECT s.user_id,s.name,s.recharge_type,s.expected_amount,s.due_date,s.account_id,s.card_id,s.payment_method,'prevista',s.notes,false,s.id
    FROM src s
    WHERE NOT EXISTS (SELECT 1 FROM public.balance_recharges b WHERE b.source_recharge_id=s.id AND b.expected_date>=month_start AND b.expected_date<=month_end)
    ON CONFLICT (user_id,source_recharge_id,expected_date) WHERE source_recharge_id IS NOT NULL DO NOTHING RETURNING 1
  ) SELECT count(*)::int INTO recharge_count FROM ins;

  UPDATE public.balance_recharges SET status='atrasada'
  WHERE expected_date<CURRENT_DATE AND status IN ('prevista','confirmada');
  GET DIAGNOSTICS overdue_count=ROW_COUNT;

  UPDATE public.credit_card_bills SET status='atrasada'
  WHERE due_date<CURRENT_DATE AND status='aberta';
  GET DIAGNOSTICS overdue_bill_count=ROW_COUNT;

  RETURN jsonb_build_object('ran_at',now(),'recurring_transactions_created',tx_count,
    'recurring_recharges_created',recharge_count,'recharges_marked_overdue',overdue_count,
    'bills_marked_overdue',overdue_bill_count);
END $$;

-- Reafirma permissoes vigentes (CREATE OR REPLACE ja as preserva; mantido explicito para auditoria).
REVOKE ALL ON FUNCTION private.run_financial_daily_maintenance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_recurring_recharges() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_recurring_transactions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_recurring_transactions() TO authenticated;
