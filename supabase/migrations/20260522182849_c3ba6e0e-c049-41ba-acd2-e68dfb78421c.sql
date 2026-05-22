
-- balance_recharges
CREATE TABLE public.balance_recharges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  recharge_type text NOT NULL DEFAULT 'fixed_income',
  expected_amount numeric NOT NULL,
  expected_date date NOT NULL,
  account_id uuid,
  card_id uuid,
  payment_method text,
  status text NOT NULL DEFAULT 'prevista',
  notes text,
  converted_to_income boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  recurring_day integer,
  source_recharge_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.balance_recharges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recharges owner all" ON public.balance_recharges FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- credit_cards
CREATE TABLE public.credit_cards (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  bank text,
  total_limit numeric NOT NULL DEFAULT 0,
  used_limit numeric NOT NULL DEFAULT 0,
  closing_day integer NOT NULL DEFAULT 1,
  due_day integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'active',
  color text NOT NULL DEFAULT '#22d3ee',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cards owner all" ON public.credit_cards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- credit_card_bills
CREATE TABLE public.credit_card_bills (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  card_id uuid NOT NULL,
  month integer NOT NULL,
  year integer NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  payment_date date,
  status text NOT NULL DEFAULT 'aberta',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, month, year)
);
ALTER TABLE public.credit_card_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bills owner all" ON public.credit_card_bills FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Generate recurring recharges (idempotent per month)
CREATE OR REPLACE FUNCTION public.generate_recurring_recharges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_due_date date;
  v_count int := 0;
  v_uid uuid := auth.uid();
  v_day int;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT * FROM public.balance_recharges
    WHERE user_id = v_uid AND is_recurring = true AND source_recharge_id IS NULL
      AND status <> 'cancelada'
  LOOP
    v_day := COALESCE(r.recurring_day, EXTRACT(DAY FROM r.expected_date)::int);
    v_due_date := make_date(
      EXTRACT(YEAR FROM CURRENT_DATE)::int,
      EXTRACT(MONTH FROM CURRENT_DATE)::int,
      LEAST(v_day, EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int)
    );

    IF NOT EXISTS (
      SELECT 1 FROM public.balance_recharges b
      WHERE b.user_id = v_uid
        AND b.source_recharge_id = r.id
        AND EXTRACT(YEAR FROM b.expected_date) = EXTRACT(YEAR FROM v_due_date)
        AND EXTRACT(MONTH FROM b.expected_date) = EXTRACT(MONTH FROM v_due_date)
    ) THEN
      INSERT INTO public.balance_recharges (
        user_id, name, recharge_type, expected_amount, expected_date,
        account_id, card_id, payment_method, status, notes,
        is_recurring, source_recharge_id
      ) VALUES (
        v_uid, r.name, r.recharge_type, r.expected_amount, v_due_date,
        r.account_id, r.card_id, r.payment_method, 'prevista', r.notes,
        false, r.id
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Mark overdue recharges
CREATE OR REPLACE FUNCTION public.mark_overdue_recharges()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  UPDATE public.balance_recharges
  SET status = 'atrasada'
  WHERE user_id = v_uid
    AND status IN ('prevista', 'confirmada')
    AND expected_date < CURRENT_DATE;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Confirm recharge -> income transaction (skip for card-related types)
CREATE OR REPLACE FUNCTION public.confirm_recharge_as_income(p_recharge_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_tx_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO r FROM public.balance_recharges
  WHERE id = p_recharge_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'recharge not found'; END IF;

  UPDATE public.balance_recharges
  SET status = 'recebida'
  WHERE id = p_recharge_id;

  IF r.recharge_type IN ('bill_payment', 'limit_release') THEN
    RETURN NULL;
  END IF;

  IF r.converted_to_income THEN RETURN NULL; END IF;

  INSERT INTO public.transactions (
    user_id, amount, type, description, occurred_at, account_id, payment_method
  ) VALUES (
    v_uid, r.expected_amount, 'income', r.name, CURRENT_DATE, r.account_id, r.payment_method
  ) RETURNING id INTO v_tx_id;

  UPDATE public.balance_recharges
  SET converted_to_income = true
  WHERE id = p_recharge_id;

  RETURN v_tx_id;
END;
$$;

-- Pay credit card bill
CREATE OR REPLACE FUNCTION public.pay_credit_card_bill(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO b FROM public.credit_card_bills
  WHERE id = p_bill_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill not found'; END IF;

  IF b.status = 'paga' THEN RETURN; END IF;

  UPDATE public.credit_card_bills
  SET status = 'paga', payment_date = CURRENT_DATE
  WHERE id = p_bill_id;

  UPDATE public.credit_cards
  SET used_limit = GREATEST(0, used_limit - b.amount)
  WHERE id = b.card_id AND user_id = v_uid;
END;
$$;
