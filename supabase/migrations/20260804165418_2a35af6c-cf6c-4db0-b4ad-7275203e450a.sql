-- ============ ROLES ============
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

-- Returns the financial space the user can read: itself for admins, the granting owner for viewers
CREATE OR REPLACE FUNCTION public.space_owner(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT owner_id FROM public.user_roles
      WHERE user_id = _user_id AND role = 'viewer' AND owner_id IS NOT NULL LIMIT 1),
    _user_id
  );
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.space_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.space_owner(uuid) TO authenticated;

DROP POLICY IF EXISTS "roles self read" ON public.user_roles;
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR owner_id = auth.uid());

-- Every existing user becomes the admin of their own space
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- ============ PROFILES: email ============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
UPDATE public.profiles p SET email = u.email FROM auth.users u WHERE u.id = p.id AND p.email IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;

-- ============ TRANSACTIONS: flow ============
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'real';

-- ============ INVESTMENTS ============
CREATE TABLE IF NOT EXISTS public.investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  inv_type text NOT NULL DEFAULT 'outros',
  institution text,
  invested_amount numeric NOT NULL DEFAULT 0,
  current_amount numeric NOT NULL DEFAULT 0,
  initial_amount numeric NOT NULL DEFAULT 0,
  applied_at date NOT NULL DEFAULT CURRENT_DATE,
  maturity_date date,
  liquidity text NOT NULL DEFAULT 'diaria',
  risk text NOT NULL DEFAULT 'baixo',
  objective text,
  notes text,
  status text NOT NULL DEFAULT 'ativo',
  is_emergency_reserve boolean NOT NULL DEFAULT false,
  color text NOT NULL DEFAULT '#228E9A',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investments TO authenticated;
GRANT ALL ON public.investments TO service_role;
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.investment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investment_id uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  previous_amount numeric,
  new_amount numeric,
  occurred_at date NOT NULL DEFAULT CURRENT_DATE,
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  transaction_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investment_events TO authenticated;
GRANT ALL ON public.investment_events TO service_role;
ALTER TABLE public.investment_events ENABLE ROW LEVEL SECURITY;

-- ============ NOTES ============
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  note_date date NOT NULL DEFAULT CURRENT_DATE,
  link_type text NOT NULL DEFAULT 'general',
  link_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO authenticated;
GRANT ALL ON public.notes TO service_role;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- ============ SHOPPING PLANNER ============
CREATE TABLE IF NOT EXISTS public.shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item text NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  store text,
  link text,
  price numeric NOT NULL DEFAULT 0,
  shipping numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  interest numeric NOT NULL DEFAULT 0,
  desired_date date,
  priority text NOT NULL DEFAULT 'media',
  purchase_type text NOT NULL DEFAULT 'necessidade',
  payment_method text NOT NULL DEFAULT 'debito_pix',
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  installments integer NOT NULL DEFAULT 1,
  down_payment numeric NOT NULL DEFAULT 0,
  notes text,
  image_url text,
  status text NOT NULL DEFAULT 'planejado',
  score integer,
  transaction_id uuid,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopping_items TO authenticated;
GRANT ALL ON public.shopping_items TO service_role;
ALTER TABLE public.shopping_items ENABLE ROW LEVEL SECURITY;

-- ============ USER SETTINGS ============
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  min_reserve numeric NOT NULL DEFAULT 0,
  max_free_balance_pct numeric NOT NULL DEFAULT 30,
  max_income_installment_pct numeric NOT NULL DEFAULT 20,
  allow_low_score_wants boolean NOT NULL DEFAULT false,
  min_priority_auto text NOT NULL DEFAULT 'media',
  purchase_alerts boolean NOT NULL DEFAULT true,
  reminder_enabled boolean NOT NULL DEFAULT false,
  reminder_day integer NOT NULL DEFAULT 5,
  reminder_amount numeric NOT NULL DEFAULT 0,
  reminder_message text,
  reminder_investment_id uuid REFERENCES public.investments(id) ON DELETE SET NULL,
  reminder_last_shown date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- ============ updated_at triggers ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['investments','notes','shopping_items','user_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- ============ RLS: space read for viewers, writes for admins only ============
DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','balance_recharges','budgets','categories','category_limits',
    'credit_card_bills','credit_cards','goals','ocr_detected_transactions',
    'recurring_expenses','transactions','uploaded_transaction_images',
    'investments','investment_events','notes','shopping_items','user_settings'
  ] LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = public.space_owner(auth.uid()))',
      t || '_space_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (user_id = auth.uid() AND public.is_admin(auth.uid())) WITH CHECK (user_id = auth.uid() AND public.is_admin(auth.uid()))',
      t || '_admin_write', t);
  END LOOP;
END $$;

-- ============ Viewer management (admin only) ============
CREATE OR REPLACE FUNCTION public.grant_viewer_access(p_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_target uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RETURN 'forbidden';
  END IF;
  SELECT id INTO v_target FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF v_target IS NULL THEN RETURN 'not_found'; END IF;
  IF v_target = v_uid THEN RETURN 'self'; END IF;
  IF public.is_admin(v_target) THEN
    DELETE FROM public.user_roles WHERE user_id = v_target AND role = 'admin';
  END IF;
  INSERT INTO public.user_roles (user_id, role, owner_id) VALUES (v_target, 'viewer', v_uid)
  ON CONFLICT (user_id, role) DO UPDATE SET owner_id = EXCLUDED.owner_id;
  RETURN 'ok';
END; $$;

CREATE OR REPLACE FUNCTION public.revoke_viewer_access(p_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN RETURN 'forbidden'; END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = 'viewer' AND owner_id = v_uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN 'ok';
END; $$;

CREATE OR REPLACE FUNCTION public.list_my_viewers()
RETURNS TABLE (user_id uuid, email text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.user_id, u.email::text, r.created_at
  FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
  WHERE r.role = 'viewer' AND r.owner_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.grant_viewer_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_viewer_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_viewers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_viewer_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_viewer_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_viewers() TO authenticated;

-- ============ Investment operations (RLS-respecting) ============
CREATE OR REPLACE FUNCTION public.invest_contribute(
  p_investment_id uuid, p_amount numeric, p_date date, p_account_id uuid, p_notes text
) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); inv RECORD; v_tx uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'valor inválido'; END IF;
  SELECT * INTO inv FROM public.investments WHERE id = p_investment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'investimento não encontrado'; END IF;

  IF p_account_id IS NOT NULL THEN
    INSERT INTO public.transactions (user_id, amount, type, flow, description, occurred_at, account_id)
    VALUES (v_uid, p_amount, 'expense', 'contribution', 'Aporte: ' || inv.name, COALESCE(p_date, CURRENT_DATE), p_account_id)
    RETURNING id INTO v_tx;
  END IF;

  UPDATE public.investments
  SET invested_amount = invested_amount + p_amount,
      current_amount = current_amount + p_amount
  WHERE id = p_investment_id;

  INSERT INTO public.investment_events (user_id, investment_id, event_type, amount, occurred_at, account_id, transaction_id, notes)
  VALUES (v_uid, p_investment_id, 'aporte', p_amount, COALESCE(p_date, CURRENT_DATE), p_account_id, v_tx, p_notes);

  RETURN v_tx;
END; $$;

CREATE OR REPLACE FUNCTION public.invest_redeem(
  p_investment_id uuid, p_amount numeric, p_date date, p_account_id uuid, p_notes text
) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); inv RECORD; v_tx uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'valor inválido'; END IF;
  SELECT * INTO inv FROM public.investments WHERE id = p_investment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'investimento não encontrado'; END IF;
  IF p_amount > inv.current_amount THEN RAISE EXCEPTION 'valor maior que o disponível'; END IF;

  IF p_account_id IS NOT NULL THEN
    INSERT INTO public.transactions (user_id, amount, type, flow, description, occurred_at, account_id)
    VALUES (v_uid, p_amount, 'income', 'redemption', 'Resgate: ' || inv.name, COALESCE(p_date, CURRENT_DATE), p_account_id)
    RETURNING id INTO v_tx;
  END IF;

  UPDATE public.investments
  SET current_amount = GREATEST(0, current_amount - p_amount),
      invested_amount = GREATEST(0, invested_amount - LEAST(p_amount, invested_amount)),
      status = CASE WHEN current_amount - p_amount <= 0 THEN 'resgatado' ELSE status END
  WHERE id = p_investment_id;

  INSERT INTO public.investment_events (user_id, investment_id, event_type, amount, occurred_at, account_id, transaction_id, notes)
  VALUES (v_uid, p_investment_id, 'resgate', p_amount, COALESCE(p_date, CURRENT_DATE), p_account_id, v_tx, p_notes);

  RETURN v_tx;
END; $$;

CREATE OR REPLACE FUNCTION public.invest_update_value(
  p_investment_id uuid, p_new_amount numeric, p_notes text
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); inv RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO inv FROM public.investments WHERE id = p_investment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'investimento não encontrado'; END IF;

  UPDATE public.investments SET current_amount = p_new_amount WHERE id = p_investment_id;

  INSERT INTO public.investment_events (user_id, investment_id, event_type, amount, previous_amount, new_amount, occurred_at, notes)
  VALUES (v_uid, p_investment_id, 'rendimento', p_new_amount - inv.current_amount, inv.current_amount, p_new_amount, CURRENT_DATE, p_notes);
END; $$;

-- ============ Shopping: convert to real transaction (idempotent) ============
CREATE OR REPLACE FUNCTION public.complete_shopping_item(p_item_id uuid, p_create_transaction boolean)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); it RECORD; v_tx uuid; v_final numeric; v_month int; v_year int; v_bill uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO it FROM public.shopping_items WHERE id = p_item_id;
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
                make_date(v_year, v_month, LEAST((SELECT due_day FROM public.credit_cards WHERE id = it.card_id), 28)),
                'aberta');
      ELSE
        UPDATE public.credit_card_bills
        SET amount = amount + CASE WHEN it.installments > 1 THEN v_final / it.installments ELSE v_final END
        WHERE id = v_bill;
      END IF;
    END IF;
  END IF;

  UPDATE public.shopping_items SET status = 'comprado', transaction_id = v_tx WHERE id = p_item_id;
  RETURN v_tx;
END; $$;

REVOKE ALL ON FUNCTION public.invest_contribute(uuid, numeric, date, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invest_redeem(uuid, numeric, date, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invest_update_value(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_shopping_item(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invest_contribute(uuid, numeric, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invest_redeem(uuid, numeric, date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invest_update_value(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_shopping_item(uuid, boolean) TO authenticated;