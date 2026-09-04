-- Snapshot estrutural auditado em d4e5128b; sem dados de usuarios.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin','viewer');
CREATE TABLE public.accounts (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,type text NOT NULL DEFAULT 'checking'::text,initial_balance numeric(14,2) NOT NULL DEFAULT 0,color text NOT NULL DEFAULT '#4f46e5'::text,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.balance_recharges (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,recharge_type text NOT NULL DEFAULT 'fixed_income'::text,expected_amount numeric NOT NULL,expected_date date NOT NULL,account_id uuid,card_id uuid,payment_method text,status text NOT NULL DEFAULT 'prevista'::text,notes text,converted_to_income boolean NOT NULL DEFAULT false,is_recurring boolean NOT NULL DEFAULT false,recurring_day integer,source_recharge_id uuid,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.budgets (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,category_id uuid NOT NULL,amount numeric(14,2) NOT NULL,month date NOT NULL,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.categories (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,type text NOT NULL,color text NOT NULL DEFAULT '#4f46e5'::text,icon text NOT NULL DEFAULT 'circle'::text,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.category_limits (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,category_id uuid NOT NULL,monthly_limit numeric NOT NULL,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.credit_card_bills (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,card_id uuid NOT NULL,month integer NOT NULL,year integer NOT NULL,amount numeric NOT NULL DEFAULT 0,due_date date NOT NULL,payment_date date,status text NOT NULL DEFAULT 'aberta'::text,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.credit_cards (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,bank text,total_limit numeric NOT NULL DEFAULT 0,used_limit numeric NOT NULL DEFAULT 0,closing_day integer NOT NULL DEFAULT 1,due_day integer NOT NULL DEFAULT 10,status text NOT NULL DEFAULT 'active'::text,color text NOT NULL DEFAULT '#22d3ee'::text,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.goals (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,target_amount numeric NOT NULL,current_amount numeric NOT NULL DEFAULT 0,deadline date,category_id uuid,color text NOT NULL DEFAULT '#22d3ee'::text,notes text,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.investment_events (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,investment_id uuid NOT NULL,event_type text NOT NULL,amount numeric NOT NULL DEFAULT 0,previous_amount numeric,new_amount numeric,occurred_at date NOT NULL DEFAULT CURRENT_DATE,account_id uuid,transaction_id uuid,notes text,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.investments (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,inv_type text NOT NULL DEFAULT 'outros'::text,institution text,invested_amount numeric NOT NULL DEFAULT 0,current_amount numeric NOT NULL DEFAULT 0,initial_amount numeric NOT NULL DEFAULT 0,applied_at date NOT NULL DEFAULT CURRENT_DATE,maturity_date date,liquidity text NOT NULL DEFAULT 'diaria'::text,risk text NOT NULL DEFAULT 'baixo'::text,objective text,notes text,status text NOT NULL DEFAULT 'ativo'::text,is_emergency_reserve boolean NOT NULL DEFAULT false,color text NOT NULL DEFAULT '#228E9A'::text,created_at timestamp with time zone NOT NULL DEFAULT now(),updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.ocr_detected_transactions (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,image_id uuid NOT NULL,detected_date date,detected_amount numeric,detected_type text,detected_description text,detected_payment_method text,detected_account text,suggested_category text,suggested_category_id uuid,confidence_level text DEFAULT 'media'::text,review_status text NOT NULL DEFAULT 'pending'::text,possible_duplicate boolean NOT NULL DEFAULT false,saved_transaction_id uuid,raw_text text,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.profiles (id uuid NOT NULL,full_name text,avatar_url text,created_at timestamp with time zone NOT NULL DEFAULT now(),updated_at timestamp with time zone NOT NULL DEFAULT now(),email text);
CREATE TABLE public.recurring_expenses (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,amount numeric NOT NULL,category_id uuid,account_id uuid,payment_method text,billing_day integer NOT NULL DEFAULT 1,frequency text NOT NULL DEFAULT 'monthly'::text,start_date date NOT NULL DEFAULT CURRENT_DATE,end_date date,status text NOT NULL DEFAULT 'active'::text,notes text,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.shopping_items (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,item text NOT NULL,category_id uuid,store text,link text,price numeric NOT NULL DEFAULT 0,shipping numeric NOT NULL DEFAULT 0,discount numeric NOT NULL DEFAULT 0,interest numeric NOT NULL DEFAULT 0,desired_date date,priority text NOT NULL DEFAULT 'media'::text,purchase_type text NOT NULL DEFAULT 'necessidade'::text,payment_method text NOT NULL DEFAULT 'debito_pix'::text,account_id uuid,card_id uuid,installments integer NOT NULL DEFAULT 1,down_payment numeric NOT NULL DEFAULT 0,notes text,image_url text,status text NOT NULL DEFAULT 'planejado'::text,score integer,transaction_id uuid,goal_id uuid,created_at timestamp with time zone NOT NULL DEFAULT now(),updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.transactions (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,account_id uuid,category_id uuid,amount numeric(14,2) NOT NULL,type text NOT NULL,description text,occurred_at date NOT NULL DEFAULT CURRENT_DATE,created_at timestamp with time zone NOT NULL DEFAULT now(),subcategory text,payment_method text,notes text,recurring_id uuid,flow text NOT NULL DEFAULT 'real'::text,credit_card_id uuid,destination_account_id uuid,bill_id uuid);
CREATE TABLE public.uploaded_transaction_images (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,file_name text NOT NULL,storage_path text NOT NULL,image_url text,processing_status text NOT NULL DEFAULT 'pending'::text,ocr_confidence text,delete_after_processing boolean NOT NULL DEFAULT false,error_message text,upload_date timestamp with time zone NOT NULL DEFAULT now(),created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.user_roles (id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,role app_role NOT NULL,owner_id uuid,created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE public.user_settings (user_id uuid NOT NULL,min_reserve numeric NOT NULL DEFAULT 0,max_free_balance_pct numeric NOT NULL DEFAULT 30,max_income_installment_pct numeric NOT NULL DEFAULT 20,allow_low_score_wants boolean NOT NULL DEFAULT false,min_priority_auto text NOT NULL DEFAULT 'media'::text,purchase_alerts boolean NOT NULL DEFAULT true,reminder_enabled boolean NOT NULL DEFAULT false,reminder_day integer NOT NULL DEFAULT 5,reminder_amount numeric NOT NULL DEFAULT 0,reminder_message text,reminder_investment_id uuid,reminder_last_shown date,created_at timestamp with time zone NOT NULL DEFAULT now(),updated_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."accounts" ADD CONSTRAINT "accounts_pkey" PRIMARY KEY (id);
ALTER TABLE public."categories" ADD CONSTRAINT "categories_type_check" CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text])));
ALTER TABLE public."categories" ADD CONSTRAINT "categories_pkey" PRIMARY KEY (id);
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_pkey" PRIMARY KEY (id);
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_pkey" PRIMARY KEY (id);
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_user_id_category_id_month_key" UNIQUE (user_id, category_id, month);
ALTER TABLE public."recurring_expenses" ADD CONSTRAINT "recurring_expenses_billing_day_check" CHECK (((billing_day >= 1) AND (billing_day <= 31)));
ALTER TABLE public."user_settings" ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY (user_id);
ALTER TABLE public."recurring_expenses" ADD CONSTRAINT "recurring_expenses_frequency_check" CHECK ((frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'yearly'::text, 'custom'::text])));
ALTER TABLE public."recurring_expenses" ADD CONSTRAINT "recurring_expenses_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text])));
ALTER TABLE public."recurring_expenses" ADD CONSTRAINT "recurring_expenses_pkey" PRIMARY KEY (id);
ALTER TABLE public."goals" ADD CONSTRAINT "goals_pkey" PRIMARY KEY (id);
ALTER TABLE public."category_limits" ADD CONSTRAINT "category_limits_pkey" PRIMARY KEY (id);
ALTER TABLE public."category_limits" ADD CONSTRAINT "category_limits_user_id_category_id_key" UNIQUE (user_id, category_id);
ALTER TABLE public."balance_recharges" ADD CONSTRAINT "balance_recharges_pkey" PRIMARY KEY (id);
ALTER TABLE public."credit_cards" ADD CONSTRAINT "credit_cards_pkey" PRIMARY KEY (id);
ALTER TABLE public."credit_card_bills" ADD CONSTRAINT "credit_card_bills_pkey" PRIMARY KEY (id);
ALTER TABLE public."credit_card_bills" ADD CONSTRAINT "credit_card_bills_card_id_month_year_key" UNIQUE (card_id, month, year);
ALTER TABLE public."uploaded_transaction_images" ADD CONSTRAINT "uploaded_transaction_images_pkey" PRIMARY KEY (id);
ALTER TABLE public."ocr_detected_transactions" ADD CONSTRAINT "ocr_detected_transactions_pkey" PRIMARY KEY (id);
ALTER TABLE public."user_roles" ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY (id);
ALTER TABLE public."user_roles" ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE (user_id, role);
ALTER TABLE public."investments" ADD CONSTRAINT "investments_pkey" PRIMARY KEY (id);
ALTER TABLE public."investment_events" ADD CONSTRAINT "investment_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_type_check" CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text])));
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_transfer_check" CHECK (((type <> 'transfer'::text) OR ((account_id IS NOT NULL) AND (destination_account_id IS NOT NULL) AND (destination_account_id <> account_id))));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."budgets" ADD CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_card_id_fkey" FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE SET NULL;
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_goal_id_fkey" FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL;
ALTER TABLE public."user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."ocr_detected_transactions" ADD CONSTRAINT "ocr_detected_transactions_image_id_fkey" FOREIGN KEY (image_id) REFERENCES uploaded_transaction_images(id) ON DELETE CASCADE;
ALTER TABLE public."recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE public."recurring_expenses" ADD CONSTRAINT "recurring_expenses_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public."user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."investments" ADD CONSTRAINT "investments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."investment_events" ADD CONSTRAINT "investment_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."investment_events" ADD CONSTRAINT "investment_events_investment_id_fkey" FOREIGN KEY (investment_id) REFERENCES investments(id) ON DELETE CASCADE;
ALTER TABLE public."investment_events" ADD CONSTRAINT "investment_events_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public."user_settings" ADD CONSTRAINT "user_settings_reminder_investment_id_fkey" FOREIGN KEY (reminder_investment_id) REFERENCES investments(id) ON DELETE SET NULL;
ALTER TABLE public."credit_cards" ADD CONSTRAINT "credit_cards_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."credit_card_bills" ADD CONSTRAINT "credit_card_bills_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."category_limits" ADD CONSTRAINT "category_limits_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."uploaded_transaction_images" ADD CONSTRAINT "uploaded_transaction_images_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."balance_recharges" ADD CONSTRAINT "balance_recharges_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."ocr_detected_transactions" ADD CONSTRAINT "ocr_detected_transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."recurring_expenses" ADD CONSTRAINT "recurring_expenses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."balance_recharges" ADD CONSTRAINT "balance_recharges_account_id_fkey" FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public."balance_recharges" ADD CONSTRAINT "balance_recharges_card_id_fkey" FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE SET NULL;
ALTER TABLE public."balance_recharges" ADD CONSTRAINT "balance_recharges_source_recharge_id_fkey" FOREIGN KEY (source_recharge_id) REFERENCES balance_recharges(id) ON DELETE SET NULL;
ALTER TABLE public."credit_card_bills" ADD CONSTRAINT "credit_card_bills_card_id_fkey" FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE CASCADE;
ALTER TABLE public."goals" ADD CONSTRAINT "goals_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE public."category_limits" ADD CONSTRAINT "category_limits_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
ALTER TABLE public."ocr_detected_transactions" ADD CONSTRAINT "ocr_detected_transactions_suggested_category_id_fkey" FOREIGN KEY (suggested_category_id) REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE public."ocr_detected_transactions" ADD CONSTRAINT "ocr_detected_transactions_saved_transaction_id_fkey" FOREIGN KEY (saved_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_recurring_id_fkey" FOREIGN KEY (recurring_id) REFERENCES recurring_expenses(id) ON DELETE SET NULL;
ALTER TABLE public."investment_events" ADD CONSTRAINT "investment_events_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
ALTER TABLE public."shopping_items" ADD CONSTRAINT "shopping_items_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;
ALTER TABLE public."goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_credit_card_id_fkey" FOREIGN KEY (credit_card_id) REFERENCES credit_cards(id) ON DELETE SET NULL;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_destination_account_id_fkey" FOREIGN KEY (destination_account_id) REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE public."transactions" ADD CONSTRAINT "transactions_bill_id_fkey" FOREIGN KEY (bill_id) REFERENCES credit_card_bills(id) ON DELETE SET NULL;
CREATE INDEX idx_investments_user_status_created ON public.investments USING btree (user_id, status, created_at DESC);
CREATE INDEX idx_ccbills_user_due ON public.credit_card_bills USING btree (user_id, due_date);
CREATE INDEX idx_ccbills_card ON public.credit_card_bills USING btree (card_id);
CREATE INDEX idx_inv_events_user_date ON public.investment_events USING btree (user_id, occurred_at DESC);
CREATE INDEX idx_inv_events_inv_date ON public.investment_events USING btree (investment_id, occurred_at DESC);
CREATE INDEX idx_inv_events_tx ON public.investment_events USING btree (transaction_id) WHERE (transaction_id IS NOT NULL);
CREATE INDEX idx_recharges_user_expected ON public.balance_recharges USING btree (user_id, expected_date);
CREATE UNIQUE INDEX uq_recharges_source_date ON public.balance_recharges USING btree (user_id, source_recharge_id, expected_date) WHERE (source_recharge_id IS NOT NULL);
CREATE INDEX idx_recharges_account ON public.balance_recharges USING btree (account_id) WHERE (account_id IS NOT NULL);
CREATE INDEX idx_recharges_card ON public.balance_recharges USING btree (card_id) WHERE (card_id IS NOT NULL);
CREATE INDEX idx_credit_cards_user_created ON public.credit_cards USING btree (user_id, created_at);
CREATE INDEX idx_shopping_user_status_created ON public.shopping_items USING btree (user_id, status, created_at DESC);
CREATE INDEX idx_shopping_tx ON public.shopping_items USING btree (transaction_id) WHERE (transaction_id IS NOT NULL);
CREATE INDEX idx_user_roles_owner_role ON public.user_roles USING btree (owner_id, role) WHERE (owner_id IS NOT NULL);
CREATE INDEX idx_uploaded_images_user_date ON public.uploaded_transaction_images USING btree (user_id, upload_date DESC);
CREATE INDEX idx_ocr_tx_image ON public.ocr_detected_transactions USING btree (image_id);
CREATE INDEX idx_ocr_tx_user ON public.ocr_detected_transactions USING btree (user_id);
CREATE INDEX idx_ocr_saved_tx ON public.ocr_detected_transactions USING btree (saved_transaction_id) WHERE (saved_transaction_id IS NOT NULL);
CREATE INDEX idx_ocr_pending_review ON public.ocr_detected_transactions USING btree (user_id, created_at DESC) WHERE (review_status = ANY (ARRAY['pending'::text, 'needs_review'::text]));
CREATE INDEX idx_categories_user_name ON public.categories USING btree (user_id, name);
CREATE INDEX idx_accounts_user_created ON public.accounts USING btree (user_id, created_at);
CREATE INDEX transactions_user_date_idx ON public.transactions USING btree (user_id, occurred_at DESC);
CREATE INDEX idx_transactions_account ON public.transactions USING btree (account_id) WHERE (account_id IS NOT NULL);
CREATE INDEX idx_transactions_category ON public.transactions USING btree (category_id) WHERE (category_id IS NOT NULL);
CREATE UNIQUE INDEX uq_transactions_recurring_period ON public.transactions USING btree (user_id, recurring_id, occurred_at) WHERE (recurring_id IS NOT NULL);
CREATE INDEX idx_transactions_credit_card ON public.transactions USING btree (credit_card_id, occurred_at DESC) WHERE (credit_card_id IS NOT NULL);
CREATE INDEX idx_transactions_destination_account ON public.transactions USING btree (destination_account_id) WHERE (destination_account_id IS NOT NULL);
CREATE INDEX idx_transactions_bill ON public.transactions USING btree (bill_id) WHERE (bill_id IS NOT NULL);
CREATE INDEX idx_budgets_user_month ON public.budgets USING btree (user_id, month);
CREATE INDEX idx_category_limits_category ON public.category_limits USING btree (category_id);
CREATE INDEX idx_recurring_user_status_day ON public.recurring_expenses USING btree (user_id, status, billing_day);
CREATE INDEX idx_goals_user_created ON public.goals USING btree (user_id, created_at);
CREATE INDEX idx_goals_category ON public.goals USING btree (category_id) WHERE (category_id IS NOT NULL);
SET check_function_bodies=off;
CREATE OR REPLACE FUNCTION private.grant_viewer_access(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_target uuid; v_is_admin boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN 'forbidden';
  END IF;
  SELECT id INTO v_target FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF v_target IS NULL THEN RETURN 'not_found'; END IF;
  IF v_target = v_uid THEN RETURN 'self'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target AND role = 'admin')
    INTO v_is_admin;
  IF v_is_admin THEN
    DELETE FROM public.user_roles WHERE user_id = v_target AND role = 'admin';
  END IF;
  INSERT INTO public.user_roles (user_id, role, owner_id) VALUES (v_target, 'viewer', v_uid)
  ON CONFLICT (user_id, role) DO UPDATE SET owner_id = EXCLUDED.owner_id;
  RETURN 'ok';
END; $function$
;
CREATE OR REPLACE FUNCTION private.list_my_viewers()
 RETURNS TABLE(user_id uuid, email text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT r.user_id, u.email::text, r.created_at
  FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
  WHERE r.role = 'viewer' AND r.owner_id = auth.uid();
$function$
;
CREATE OR REPLACE FUNCTION private.revoke_viewer_access(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN 'forbidden';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = 'viewer' AND owner_id = v_uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN 'ok';
END; $function$
;
CREATE OR REPLACE FUNCTION private.run_financial_daily_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tx int := 0;
  v_rc int := 0;
  v_overdue int := 0;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
  v_month_end date := (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date;
BEGIN
  -- 1) transacoes recorrentes para todos os owners
  WITH due AS (
    SELECT
      r.id, r.user_id, r.amount, r.name, r.account_id, r.category_id, r.payment_method,
      CASE
        WHEN r.frequency = 'monthly' THEN
          make_date(
            EXTRACT(YEAR FROM CURRENT_DATE)::int,
            EXTRACT(MONTH FROM CURRENT_DATE)::int,
            LEAST(r.billing_day, EXTRACT(DAY FROM v_month_end)::int)
          )
        WHEN r.frequency = 'yearly' THEN
          make_date(
            EXTRACT(YEAR FROM CURRENT_DATE)::int,
            EXTRACT(MONTH FROM r.start_date)::int,
            EXTRACT(DAY FROM r.start_date)::int
          )
        WHEN r.frequency = 'weekly' THEN
          CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::int - EXTRACT(DOW FROM r.start_date)::int + 7) % 7)
        ELSE CURRENT_DATE
      END AS due_date
    FROM public.recurring_expenses r
    WHERE r.status = 'active'
      AND r.start_date <= CURRENT_DATE
      AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)
  ),
  ins AS (
    INSERT INTO public.transactions
      (user_id, amount, type, description, occurred_at, account_id, category_id, payment_method, recurring_id)
    SELECT d.user_id, d.amount, 'expense', d.name, d.due_date, d.account_id, d.category_id, d.payment_method, d.id
    FROM due d
    WHERE d.due_date <= CURRENT_DATE
    ON CONFLICT (user_id, recurring_id, occurred_at) WHERE recurring_id IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_tx FROM ins;

  -- 2) recargas recorrentes do mes para todos os owners
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
    WHERE r.is_recurring = true
      AND r.source_recharge_id IS NULL
      AND r.status <> 'cancelada'
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
      WHERE b.source_recharge_id = s.id
        AND b.expected_date >= v_month_start
        AND b.expected_date <= v_month_end
    )
    ON CONFLICT (user_id, source_recharge_id, expected_date) WHERE source_recharge_id IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_rc FROM ins;

  -- 3) recargas vencidas
  UPDATE public.balance_recharges
  SET status = 'atrasada'
  WHERE expected_date < CURRENT_DATE
    AND status IN ('prevista', 'confirmada');
  GET DIAGNOSTICS v_overdue = ROW_COUNT;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'recurring_transactions_created', v_tx,
    'recurring_recharges_created', v_rc,
    'recharges_marked_overdue', v_overdue
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_card_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_due_day int;
  v_month int := EXTRACT(MONTH FROM NEW.occurred_at)::int;
  v_year int := EXTRACT(YEAR FROM NEW.occurred_at)::int;
  v_bill uuid;
BEGIN
  IF NEW.credit_card_id IS NULL OR NEW.type <> 'expense'
     OR COALESCE(NEW.flow, 'real') <> 'real' THEN
    RETURN NEW;
  END IF;

  SELECT due_day INTO v_due_day
  FROM public.credit_cards
  WHERE id = NEW.credit_card_id AND user_id = NEW.user_id;
  IF v_due_day IS NULL THEN RETURN NEW; END IF;

  UPDATE public.credit_cards
  SET used_limit = used_limit + NEW.amount
  WHERE id = NEW.credit_card_id AND user_id = NEW.user_id;

  SELECT id INTO v_bill
  FROM public.credit_card_bills
  WHERE card_id = NEW.credit_card_id AND user_id = NEW.user_id
    AND month = v_month AND year = v_year;

  IF v_bill IS NULL THEN
    INSERT INTO public.credit_card_bills (user_id, card_id, month, year, amount, due_date, status)
    VALUES (NEW.user_id, NEW.credit_card_id, v_month, v_year, NEW.amount,
            make_date(v_year, v_month, LEAST(v_due_day, 28)), 'aberta');
  ELSE
    UPDATE public.credit_card_bills
    SET amount = amount + NEW.amount
    WHERE id = v_bill;
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.complete_shopping_item(p_item_id uuid, p_create_transaction boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); it RECORD; v_tx uuid; v_final numeric; v_month int; v_year int; v_bill uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO it FROM public.shopping_items WHERE id = p_item_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'compra não encontrada'; END IF;
  IF it.transaction_id IS NOT NULL THEN RETURN it.transaction_id; END IF;

  v_final := GREATEST(0, it.price + it.shipping + it.interest - it.discount);

  IF p_create_transaction THEN
    INSERT INTO public.transactions (user_id, amount, type, flow, description, occurred_at, account_id, category_id, payment_method, notes)
    VALUES (v_uid, v_final, 'expense', 'real', it.item, COALESCE(it.desired_date, CURRENT_DATE),
            it.account_id, it.category_id,
            CASE WHEN it.payment_method IN ('credito_vista','credito_parcelado') THEN 'credito'
                 WHEN it.payment_method = 'dinheiro' THEN 'dinheiro' ELSE 'pix' END,
            it.notes)
    RETURNING id INTO v_tx;

    IF it.card_id IS NOT NULL THEN
      UPDATE public.credit_cards SET used_limit = used_limit + v_final WHERE id = it.card_id AND user_id = v_uid;
      v_month := EXTRACT(MONTH FROM CURRENT_DATE)::int;
      v_year := EXTRACT(YEAR FROM CURRENT_DATE)::int;
      SELECT id INTO v_bill FROM public.credit_card_bills
        WHERE card_id = it.card_id AND month = v_month AND year = v_year AND user_id = v_uid;
      IF v_bill IS NULL THEN
        INSERT INTO public.credit_card_bills (user_id, card_id, month, year, amount, due_date, status)
        VALUES (v_uid, it.card_id, v_month, v_year,
                CASE WHEN it.installments > 1 THEN v_final / it.installments ELSE v_final END,
                make_date(v_year, v_month, LEAST((SELECT due_day FROM public.credit_cards WHERE id = it.card_id AND user_id = v_uid), 28)),
                'aberta');
      ELSE
        UPDATE public.credit_card_bills
        SET amount = amount + CASE WHEN it.installments > 1 THEN v_final / it.installments ELSE v_final END
        WHERE id = v_bill AND user_id = v_uid;
      END IF;
    END IF;
  END IF;

  UPDATE public.shopping_items SET status = 'comprado', transaction_id = v_tx WHERE id = p_item_id AND user_id = v_uid;
  RETURN v_tx;
END; $function$
;
CREATE OR REPLACE FUNCTION public.confirm_recharge_as_income(p_recharge_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE r RECORD; v_tx_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO r FROM public.balance_recharges
  WHERE id = p_recharge_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'recharge not found'; END IF;

  UPDATE public.balance_recharges SET status = 'recebida'
  WHERE id = p_recharge_id AND user_id = v_uid;

  IF r.recharge_type IN ('bill_payment', 'limit_release') THEN RETURN NULL; END IF;
  IF r.converted_to_income THEN RETURN NULL; END IF;

  INSERT INTO public.transactions (user_id, amount, type, description, occurred_at, account_id, payment_method)
  VALUES (v_uid, r.expected_amount, 'income', r.name, CURRENT_DATE, r.account_id, r.payment_method)
  RETURNING id INTO v_tx_id;

  UPDATE public.balance_recharges SET converted_to_income = true
  WHERE id = p_recharge_id AND user_id = v_uid;

  RETURN v_tx_id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.generate_recurring_recharges()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  ),
  ins AS (
    INSERT INTO public.balance_recharges
      (user_id, name, recharge_type, expected_amount, expected_date,
       account_id, card_id, payment_method, status, notes, is_recurring, source_recharge_id)
    SELECT s.user_id, s.name, s.recharge_type, s.expected_amount, s.due_date,
           s.account_id, s.card_id, s.payment_method, 'prevista', s.notes, false, s.id
    FROM src s
    -- evita EXTRACT sobre a coluna indexada: usa limites do mes
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
$function$
;
CREATE OR REPLACE FUNCTION public.generate_recurring_transactions()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_count int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

  WITH due AS (
    SELECT
      r.id, r.user_id, r.amount, r.name, r.account_id, r.category_id, r.payment_method,
      CASE
        WHEN r.frequency = 'monthly' THEN
          make_date(
            EXTRACT(YEAR FROM CURRENT_DATE)::int,
            EXTRACT(MONTH FROM CURRENT_DATE)::int,
            LEAST(r.billing_day, EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::int)
          )
        WHEN r.frequency = 'yearly' THEN
          make_date(
            EXTRACT(YEAR FROM CURRENT_DATE)::int,
            EXTRACT(MONTH FROM r.start_date)::int,
            EXTRACT(DAY FROM r.start_date)::int
          )
        WHEN r.frequency = 'weekly' THEN
          CURRENT_DATE - ((EXTRACT(DOW FROM CURRENT_DATE)::int - EXTRACT(DOW FROM r.start_date)::int + 7) % 7)
        ELSE CURRENT_DATE
      END AS due_date
    FROM public.recurring_expenses r
    WHERE r.user_id = v_uid
      AND r.status = 'active'
      AND r.start_date <= CURRENT_DATE
      AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)
  ),
  ins AS (
    INSERT INTO public.transactions
      (user_id, amount, type, description, occurred_at, account_id, category_id, payment_method, recurring_id)
    SELECT d.user_id, d.amount, 'expense', d.name, d.due_date, d.account_id, d.category_id, d.payment_method, d.id
    FROM due d
    WHERE d.due_date <= CURRENT_DATE
    ON CONFLICT (user_id, recurring_id, occurred_at) WHERE recurring_id IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO v_count FROM ins;

  RETURN v_count;
END;
$function$
;
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
  moves AS (
    -- lado da conta de origem; compra no cartao nunca debita conta
    SELECT t.account_id AS acc_id,
           CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END AS delta
    FROM public.transactions t, o
    WHERE t.user_id = o.uid AND t.account_id IS NOT NULL
      AND t.type IN ('income', 'expense', 'transfer')
      AND t.credit_card_id IS NULL
    UNION ALL
    -- lado da conta de destino em transferencias
    SELECT t.destination_account_id, t.amount
    FROM public.transactions t, o
    WHERE t.user_id = o.uid AND t.type = 'transfer'
      AND t.destination_account_id IS NOT NULL
  ),
  agg AS (SELECT acc_id, sum(delta) AS delta FROM moves GROUP BY acc_id)
  SELECT acc.id, acc.name, acc.type, acc.color, acc.initial_balance,
         acc.initial_balance + COALESCE(agg.delta, 0)
  FROM acc
  LEFT JOIN agg ON agg.acc_id = acc.id
  ORDER BY acc.created_at;
$function$
;
CREATE OR REPLACE FUNCTION public.get_dashboard_bundle(p_months integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
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
$function$
;
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
$function$
;
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
$function$
;
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
$function$
;
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
$function$
;
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
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.grant_viewer_access(p_email text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$ SELECT private.grant_viewer_access(p_email); $function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.categories (user_id, name, type, color, icon) VALUES
    (NEW.id, 'Salário', 'income', '#10b981', 'briefcase'),
    (NEW.id, 'Freelance', 'income', '#22d3ee', 'laptop'),
    (NEW.id, 'Investimentos', 'income', '#a78bfa', 'trending-up'),
    (NEW.id, 'Alimentação', 'expense', '#f97316', 'utensils'),
    (NEW.id, 'Moradia', 'expense', '#ef4444', 'home'),
    (NEW.id, 'Transporte', 'expense', '#eab308', 'car'),
    (NEW.id, 'Lazer', 'expense', '#ec4899', 'gamepad-2'),
    (NEW.id, 'Saúde', 'expense', '#06b6d4', 'heart-pulse'),
    (NEW.id, 'Compras', 'expense', '#8b5cf6', 'shopping-bag');

  INSERT INTO public.accounts (user_id, name, type, color)
  VALUES (NEW.id, 'Conta Principal', 'checking', '#4f46e5');

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$function$
;
CREATE OR REPLACE FUNCTION public.invest_contribute(p_investment_id uuid, p_amount numeric, p_date date, p_account_id uuid, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); inv RECORD; v_tx uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'valor inválido'; END IF;
  SELECT * INTO inv FROM public.investments WHERE id = p_investment_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'investimento não encontrado'; END IF;

  IF p_account_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_uid) THEN
      RAISE EXCEPTION 'conta não encontrada';
    END IF;
    INSERT INTO public.transactions (user_id, amount, type, flow, description, occurred_at, account_id)
    VALUES (v_uid, p_amount, 'expense', 'contribution', 'Aporte: ' || inv.name, COALESCE(p_date, CURRENT_DATE), p_account_id)
    RETURNING id INTO v_tx;
  END IF;

  UPDATE public.investments
  SET invested_amount = invested_amount + p_amount,
      current_amount = current_amount + p_amount
  WHERE id = p_investment_id AND user_id = v_uid;

  INSERT INTO public.investment_events (user_id, investment_id, event_type, amount, occurred_at, account_id, transaction_id, notes)
  VALUES (v_uid, p_investment_id, 'aporte', p_amount, COALESCE(p_date, CURRENT_DATE), p_account_id, v_tx, p_notes);

  RETURN v_tx;
END; $function$
;
CREATE OR REPLACE FUNCTION public.invest_redeem(p_investment_id uuid, p_amount numeric, p_date date, p_account_id uuid, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); inv RECORD; v_tx uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'valor inválido'; END IF;
  SELECT * INTO inv FROM public.investments WHERE id = p_investment_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'investimento não encontrado'; END IF;
  IF p_amount > inv.current_amount THEN RAISE EXCEPTION 'valor maior que o disponível'; END IF;

  IF p_account_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_uid) THEN
      RAISE EXCEPTION 'conta não encontrada';
    END IF;
    INSERT INTO public.transactions (user_id, amount, type, flow, description, occurred_at, account_id)
    VALUES (v_uid, p_amount, 'income', 'redemption', 'Resgate: ' || inv.name, COALESCE(p_date, CURRENT_DATE), p_account_id)
    RETURNING id INTO v_tx;
  END IF;

  UPDATE public.investments
  SET current_amount = GREATEST(0, current_amount - p_amount),
      invested_amount = GREATEST(0, invested_amount - LEAST(p_amount, invested_amount)),
      status = CASE WHEN current_amount - p_amount <= 0 THEN 'resgatado' ELSE status END
  WHERE id = p_investment_id AND user_id = v_uid;

  INSERT INTO public.investment_events (user_id, investment_id, event_type, amount, occurred_at, account_id, transaction_id, notes)
  VALUES (v_uid, p_investment_id, 'resgate', p_amount, COALESCE(p_date, CURRENT_DATE), p_account_id, v_tx, p_notes);

  RETURN v_tx;
END; $function$
;
CREATE OR REPLACE FUNCTION public.invest_update_value(p_investment_id uuid, p_new_amount numeric, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); inv RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO inv FROM public.investments WHERE id = p_investment_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'investimento não encontrado'; END IF;

  UPDATE public.investments SET current_amount = p_new_amount WHERE id = p_investment_id AND user_id = v_uid;

  INSERT INTO public.investment_events (user_id, investment_id, event_type, amount, previous_amount, new_amount, occurred_at, notes)
  VALUES (v_uid, p_investment_id, 'rendimento', p_new_amount - inv.current_amount, inv.current_amount, p_new_amount, CURRENT_DATE, p_notes);
END; $function$
;
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$function$
;
CREATE OR REPLACE FUNCTION public.list_my_viewers()
 RETURNS TABLE(user_id uuid, email text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ SELECT * FROM private.list_my_viewers(); $function$
;
CREATE OR REPLACE FUNCTION public.mark_overdue_recharges()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  UPDATE public.balance_recharges
  SET status = 'atrasada'
  WHERE user_id = v_uid
    AND expected_date < CURRENT_DATE
    AND status IN ('prevista', 'confirmada');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.pay_credit_card_bill(p_bill_id uuid, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE b RECORD; v_uid uuid := auth.uid(); v_card_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO b FROM public.credit_card_bills
  WHERE id = p_bill_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill not found'; END IF;
  IF b.status = 'paga' THEN RETURN; END IF;

  IF p_account_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id AND user_id = v_uid) THEN
      RAISE EXCEPTION 'conta nao encontrada';
    END IF;
    SELECT name INTO v_card_name FROM public.credit_cards WHERE id = b.card_id AND user_id = v_uid;
    INSERT INTO public.transactions
      (user_id, amount, type, flow, description, occurred_at, account_id, bill_id, payment_method)
    VALUES (v_uid, b.amount, 'expense', 'bill_payment',
            'Pagamento de fatura ' || COALESCE(v_card_name, 'cartao'),
            CURRENT_DATE, p_account_id, b.id, 'transferencia');
  END IF;

  UPDATE public.credit_card_bills
  SET status = 'paga', payment_date = CURRENT_DATE
  WHERE id = p_bill_id AND user_id = v_uid;

  UPDATE public.credit_cards
  SET used_limit = GREATEST(0, used_limit - b.amount)
  WHERE id = b.card_id AND user_id = v_uid;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.revoke_viewer_access(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$ SELECT private.revoke_viewer_access(p_user_id); $function$
;
CREATE OR REPLACE FUNCTION public.space_owner(_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT owner_id FROM public.user_roles
      WHERE user_id = _user_id AND role = 'viewer' AND owner_id IS NOT NULL LIMIT 1),
    _user_id
  );
$function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$
;
SET check_function_bodies=on;
ALTER TABLE public."investments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."credit_card_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."investment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."balance_recharges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."credit_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."shopping_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."uploaded_transaction_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ocr_detected_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."category_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."recurring_expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."goals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_space_read" ON public."categories" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "categories_admin_write" ON public."categories" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "category_limits_space_read" ON public."category_limits" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "category_limits_admin_write" ON public."category_limits" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "credit_card_bills_space_read" ON public."credit_card_bills" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "credit_card_bills_admin_write" ON public."credit_card_bills" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "credit_cards_space_read" ON public."credit_cards" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "credit_cards_admin_write" ON public."credit_cards" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "goals_space_read" ON public."goals" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "accounts_space_read" ON public."accounts" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "accounts_admin_write" ON public."accounts" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "balance_recharges_space_read" ON public."balance_recharges" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "balance_recharges_admin_write" ON public."balance_recharges" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "budgets_space_read" ON public."budgets" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "budgets_admin_write" ON public."budgets" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "goals_admin_write" ON public."goals" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "investments_space_read" ON public."investments" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "investments_admin_write" ON public."investments" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "investment_events_space_read" ON public."investment_events" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "investment_events_admin_write" ON public."investment_events" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "ocr_detected_transactions_space_read" ON public."ocr_detected_transactions" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "ocr_detected_transactions_admin_write" ON public."ocr_detected_transactions" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "recurring_expenses_space_read" ON public."recurring_expenses" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "recurring_expenses_admin_write" ON public."recurring_expenses" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "shopping_items_space_read" ON public."shopping_items" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "shopping_items_admin_write" ON public."shopping_items" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "transactions_space_read" ON public."transactions" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "transactions_admin_write" ON public."transactions" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "uploaded_transaction_images_space_read" ON public."uploaded_transaction_images" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "uploaded_transaction_images_admin_write" ON public."uploaded_transaction_images" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "user_settings_space_read" ON public."user_settings" FOR SELECT TO authenticated USING ((user_id = ( SELECT space_owner(( SELECT auth.uid() AS uid)) AS space_owner))) ;
CREATE POLICY "user_settings_admin_write" ON public."user_settings" FOR ALL TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_admin(( SELECT auth.uid() AS uid)) AS is_admin)));
CREATE POLICY "roles self read" ON public."user_roles" FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid)))) ;
CREATE POLICY "Profiles self select" ON public."profiles" FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) ;
CREATE POLICY "Profiles self update" ON public."profiles" FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Profiles self insert" ON public."profiles" FOR INSERT TO authenticated  WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.investments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.shopping_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_apply_card_purchase AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION apply_card_purchase();
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

