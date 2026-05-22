
-- Expand transactions with subcategory, payment method, notes, recurring link
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS recurring_id uuid;

-- Recurring expenses / subscriptions
CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  amount numeric NOT NULL,
  category_id uuid,
  account_id uuid,
  payment_method text,
  billing_day int NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 31),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','yearly','custom')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recurring owner all" ON public.recurring_expenses FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Goals
CREATE TABLE IF NOT EXISTS public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  target_amount numeric NOT NULL,
  current_amount numeric NOT NULL DEFAULT 0,
  deadline date,
  category_id uuid,
  color text NOT NULL DEFAULT '#22d3ee',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goals owner all" ON public.goals FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Category monthly limits
CREATE TABLE IF NOT EXISTS public.category_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category_id uuid NOT NULL,
  monthly_limit numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id)
);
ALTER TABLE public.category_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "limits owner all" ON public.category_limits FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Function to generate recurring transactions for the current user (idempotent)
CREATE OR REPLACE FUNCTION public.generate_recurring_transactions()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_due_date date;
  v_count int := 0;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT * FROM public.recurring_expenses
    WHERE user_id = v_uid AND status = 'active'
      AND start_date <= CURRENT_DATE
      AND (end_date IS NULL OR end_date >= CURRENT_DATE)
  LOOP
    -- Compute the due date for this period based on frequency
    IF r.frequency = 'monthly' THEN
      v_due_date := make_date(
        EXTRACT(YEAR FROM CURRENT_DATE)::int,
        EXTRACT(MONTH FROM CURRENT_DATE)::int,
        LEAST(r.billing_day, EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int)
      );
    ELSIF r.frequency = 'yearly' THEN
      v_due_date := make_date(
        EXTRACT(YEAR FROM CURRENT_DATE)::int,
        EXTRACT(MONTH FROM r.start_date)::int,
        EXTRACT(DAY FROM r.start_date)::int
      );
    ELSIF r.frequency = 'weekly' THEN
      v_due_date := CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::int - EXTRACT(DOW FROM r.start_date)::int + 7) % 7);
    ELSE
      v_due_date := CURRENT_DATE;
    END IF;

    -- Only insert if due_date has passed AND no transaction yet for this recurring in this period
    IF v_due_date <= CURRENT_DATE THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.user_id = v_uid
          AND t.recurring_id = r.id
          AND t.occurred_at = v_due_date
      ) THEN
        INSERT INTO public.transactions (user_id, amount, type, description, occurred_at, account_id, category_id, payment_method, recurring_id)
        VALUES (v_uid, r.amount, 'expense', r.name, v_due_date, r.account_id, r.category_id, r.payment_method, r.id);
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
