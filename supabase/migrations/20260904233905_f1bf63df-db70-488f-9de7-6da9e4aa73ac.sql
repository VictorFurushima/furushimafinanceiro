-- Revisao integral: integridade de dados, recorrencias no cartao, OCR atomico,
-- convites de espectadores, Storage e privilegios de funcoes.

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- Limite de tamanho/MIME do bucket aplicado pela ferramenta de storage (nao por migration).

DROP POLICY IF EXISTS "users delete own prints" ON storage.objects;
DROP POLICY IF EXISTS "users read own prints" ON storage.objects;
DROP POLICY IF EXISTS "users upload own prints" ON storage.objects;
CREATE POLICY "users delete own prints" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='transaction-prints' AND auth.uid()::text=(storage.foldername(name))[1]);
CREATE POLICY "users read own prints" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='transaction-prints' AND auth.uid()::text=(storage.foldername(name))[1]);
CREATE POLICY "users upload own prints" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='transaction-prints' AND auth.uid()::text=(storage.foldername(name))[1]);

-- Invariantes que antes existiam apenas nos formularios.
ALTER TABLE public.balance_recharges
  ADD CONSTRAINT balance_recharges_amount_positive CHECK (expected_amount > 0),
  ADD CONSTRAINT balance_recharges_recurring_day_valid CHECK (recurring_day IS NULL OR recurring_day BETWEEN 1 AND 31);
ALTER TABLE public.budgets ADD CONSTRAINT budgets_amount_positive CHECK (amount > 0);
ALTER TABLE public.category_limits ADD CONSTRAINT category_limits_amount_positive CHECK (monthly_limit > 0);
ALTER TABLE public.goals
  ADD CONSTRAINT goals_target_positive CHECK (target_amount > 0),
  ADD CONSTRAINT goals_current_nonnegative CHECK (current_amount >= 0);
ALTER TABLE public.investments
  ADD CONSTRAINT investments_amounts_nonnegative CHECK (invested_amount >= 0 AND current_amount >= 0 AND initial_amount >= 0),
  ADD CONSTRAINT investments_maturity_valid CHECK (maturity_date IS NULL OR maturity_date >= applied_at);
ALTER TABLE public.recurring_expenses
  ADD CONSTRAINT recurring_expenses_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT recurring_expenses_dates_valid CHECK (end_date IS NULL OR end_date >= start_date);
ALTER TABLE public.shopping_items
  ADD COLUMN down_payment_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD CONSTRAINT shopping_items_amounts_nonnegative CHECK (price >= 0 AND shipping >= 0 AND discount >= 0 AND interest >= 0 AND down_payment >= 0),
  ADD CONSTRAINT shopping_items_down_payment_valid CHECK (down_payment <= GREATEST(price + shipping + interest - discount,0)),
  ADD CONSTRAINT shopping_items_installments_valid CHECK (installments BETWEEN 1 AND 120);
CREATE INDEX idx_shopping_down_payment_tx ON public.shopping_items(down_payment_transaction_id)
  WHERE down_payment_transaction_id IS NOT NULL;
ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_values_valid CHECK (
    min_reserve >= 0 AND reminder_amount >= 0 AND reminder_day BETWEEN 1 AND 31
    AND max_free_balance_pct BETWEEN 0 AND 100
    AND max_income_installment_pct BETWEEN 0 AND 100
  );
ALTER TABLE public.ocr_detected_transactions
  ADD CONSTRAINT ocr_detected_amount_positive CHECK (detected_amount IS NULL OR detected_amount > 0),
  ADD CONSTRAINT ocr_detected_type_valid CHECK (detected_type IS NULL OR detected_type IN ('income','expense')),
  ADD CONSTRAINT ocr_review_status_valid CHECK (review_status IN ('pending','needs_review','saved','ignored'));

-- Assinaturas no credito passam pelo mesmo ciclo de fatura das compras manuais.
ALTER TABLE public.recurring_expenses ADD COLUMN credit_card_id uuid;
ALTER TABLE public.recurring_expenses
  ADD CONSTRAINT recurring_expenses_credit_card_id_fkey FOREIGN KEY (credit_card_id)
  REFERENCES public.credit_cards(id) ON DELETE RESTRICT;
UPDATE public.recurring_expenses
SET status='paused'
WHERE payment_method='credito' AND credit_card_id IS NULL AND status='active';
ALTER TABLE public.recurring_expenses ADD CONSTRAINT recurring_expenses_active_credit_card_required
  CHECK (payment_method<>'credito' OR status<>'active' OR credit_card_id IS NOT NULL);
CREATE INDEX idx_recurring_expenses_credit_card ON public.recurring_expenses(credit_card_id)
  WHERE credit_card_id IS NOT NULL;

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
        ELSE CURRENT_DATE
      END AS due_date
    FROM public.recurring_expenses r
    WHERE r.user_id=uid AND r.status='active' AND r.start_date<=CURRENT_DATE
      AND (r.end_date IS NULL OR r.end_date>=CURRENT_DATE)
      AND (r.payment_method<>'credito' OR r.credit_card_id IS NOT NULL)
  ), ins AS (
    INSERT INTO public.transactions
      (user_id,amount,type,flow,description,occurred_at,account_id,credit_card_id,category_id,payment_method,recurring_id)
    SELECT d.user_id,d.amount,'expense','real',d.name,d.due_date,
      CASE WHEN d.payment_method='credito' THEN NULL ELSE d.account_id END,
      CASE WHEN d.payment_method='credito' THEN d.credit_card_id ELSE NULL END,
      d.category_id,d.payment_method,d.id
    FROM due d
    WHERE d.due_date<=CURRENT_DATE
    ON CONFLICT (user_id,recurring_id,occurred_at) WHERE recurring_id IS NOT NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*)::int INTO created_count FROM ins;
  RETURN created_count;
END $$;

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
        ELSE CURRENT_DATE
      END AS due_date
    FROM public.recurring_expenses r
    WHERE r.status='active' AND r.start_date<=CURRENT_DATE AND (r.end_date IS NULL OR r.end_date>=CURRENT_DATE)
      AND (r.payment_method<>'credito' OR r.credit_card_id IS NOT NULL)
  ), ins AS (
    INSERT INTO public.transactions
      (user_id,amount,type,flow,description,occurred_at,account_id,credit_card_id,category_id,payment_method,recurring_id)
    SELECT d.user_id,d.amount,'expense','real',d.name,d.due_date,
      CASE WHEN d.payment_method='credito' THEN NULL ELSE d.account_id END,
      CASE WHEN d.payment_method='credito' THEN d.credit_card_id ELSE NULL END,
      d.category_id,d.payment_method,d.id
    FROM due d WHERE d.due_date<=CURRENT_DATE
    ON CONFLICT (user_id,recurring_id,occurred_at) WHERE recurring_id IS NOT NULL DO NOTHING RETURNING 1
  ) SELECT count(*)::int INTO tx_count FROM ins;

  WITH src AS (
    SELECT r.*,make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,EXTRACT(MONTH FROM CURRENT_DATE)::int,
      LEAST(COALESCE(r.recurring_day,EXTRACT(DAY FROM r.expected_date)::int),EXTRACT(DAY FROM month_end)::int)) AS due_date
    FROM public.balance_recharges r
    WHERE r.is_recurring=true AND r.source_recharge_id IS NULL AND r.status<>'cancelada'
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

-- O cron sem JWT so pode criar a cobranca que corresponde exatamente a uma recorrencia ativa.
CREATE OR REPLACE FUNCTION public.apply_card_purchase()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; due date; m date; bid uuid; part numeric; cents bigint;
BEGIN
  IF (TG_OP='INSERT' AND NEW.credit_card_id IS NULL AND NEW.flow <> 'bill_payment')
     OR (TG_OP='DELETE' AND OLD.credit_card_id IS NULL AND OLD.flow <> 'bill_payment')
     OR (TG_OP='UPDATE' AND OLD.credit_card_id IS NULL AND NEW.credit_card_id IS NULL
       AND OLD.flow <> 'bill_payment' AND NEW.flow <> 'bill_payment') THEN RETURN NULL; END IF;

  IF auth.uid() IS NULL THEN
    IF TG_OP<>'INSERT' OR NEW.recurring_id IS NULL OR NEW.flow<>'real'
       OR NOT EXISTS (
         SELECT 1 FROM public.recurring_expenses r
         WHERE r.id=NEW.recurring_id AND r.user_id=NEW.user_id AND r.status='active'
           AND r.payment_method='credito' AND r.credit_card_id=NEW.credit_card_id
           AND r.amount=NEW.amount AND r.name=NEW.description
       ) THEN
      RAISE EXCEPTION 'Operacao automatica de cartao invalida';
    END IF;
  ELSIF NOT public.is_admin(auth.uid())
     OR (CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END)<>auth.uid() THEN
    RAISE EXCEPTION 'Operacao financeira exige administrador titular';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    DELETE FROM public.credit_card_bill_items WHERE transaction_id=OLD.id;
    IF OLD.flow='bill_payment' THEN
      UPDATE public.credit_card_bills SET status='aberta' WHERE id=OLD.bill_id;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN NULL; END IF;
  IF NEW.flow='bill_payment' THEN
    UPDATE public.credit_card_bills SET status='paga' WHERE id=NEW.bill_id;
  ELSIF NEW.credit_card_id IS NOT NULL THEN
    SELECT id,closing_day,due_day INTO c FROM public.credit_cards WHERE id=NEW.credit_card_id FOR UPDATE;
    due := public.card_cycle_due(NEW.occurred_at,c.closing_day,c.due_day);
    cents := round(NEW.amount*100);
    IF cents < NEW.installment_count OR NEW.amount <> cents::numeric/100 THEN
      RAISE EXCEPTION 'Use centavos inteiros e parcelas de ao menos R$ 0,01'; END IF;
    FOR i IN 1..NEW.installment_count LOOP
      m := (date_trunc('month',due) + make_interval(months=>i-1))::date;
      part := (cents / NEW.installment_count + CASE WHEN i <= cents % NEW.installment_count THEN 1 ELSE 0 END)::numeric/100;
      INSERT INTO public.credit_card_bills(user_id,card_id,month,year,amount,due_date)
        VALUES (NEW.user_id,c.id,EXTRACT(MONTH FROM m),EXTRACT(YEAR FROM m),0,
          m + (LEAST(c.due_day,EXTRACT(DAY FROM m + interval '1 month - 1 day')::int)-1))
        ON CONFLICT(card_id,month,year) DO NOTHING;
      SELECT id INTO bid FROM public.credit_card_bills WHERE card_id=c.id
        AND month=EXTRACT(MONTH FROM m) AND year=EXTRACT(YEAR FROM m) AND status <> 'paga' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ciclo ja pago: estorne o pagamento antes de incluir compra'; END IF;
      INSERT INTO public.credit_card_bill_items(user_id,transaction_id,bill_id,installment_number,amount)
        VALUES(NEW.user_id,NEW.id,bid,i,part);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;

-- Entrada e saldo financiado sao gravados juntos e permanecem rastreaveis.
CREATE OR REPLACE FUNCTION public.complete_shopping_item(
  p_item_id uuid,
  p_create_transaction boolean,
  p_purchase_date date DEFAULT CURRENT_DATE
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE uid uuid:=auth.uid(); it record; tx uuid; entry_tx uuid;
  total numeric; financed numeric; credit boolean;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
  SELECT * INTO it FROM public.shopping_items WHERE id=p_item_id AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra nao encontrada'; END IF;
  IF it.transaction_id IS NOT NULL THEN RETURN it.transaction_id; END IF;

  total:=round(it.price+it.shipping+it.interest-it.discount,2);
  credit:=it.payment_method IN ('credito_vista','credito_parcelado');
  IF total<=0 THEN RAISE EXCEPTION 'O valor final da compra deve ser positivo'; END IF;
  IF it.down_payment>total THEN RAISE EXCEPTION 'A entrada nao pode superar o valor final'; END IF;

  IF p_create_transaction THEN
    IF credit AND it.card_id IS NULL THEN RAISE EXCEPTION 'Selecione o cartao da compra'; END IF;
    IF credit AND it.down_payment>=total THEN
      RAISE EXCEPTION 'A entrada deve ser menor que o valor final em uma compra no credito';
    END IF;
    IF credit AND it.down_payment>0 AND it.account_id IS NULL THEN
      RAISE EXCEPTION 'Selecione a conta usada para pagar a entrada';
    END IF;

    IF credit THEN
      financed:=total-it.down_payment;
      IF it.down_payment>0 THEN
        INSERT INTO public.transactions(user_id,amount,type,flow,description,occurred_at,account_id,category_id,payment_method,notes)
        VALUES(uid,it.down_payment,'expense','real',it.item||' - entrada',COALESCE(p_purchase_date,CURRENT_DATE),
          it.account_id,it.category_id,'pix',it.notes)
        RETURNING id INTO entry_tx;
      END IF;
      INSERT INTO public.transactions(user_id,amount,type,flow,description,occurred_at,category_id,payment_method,notes,credit_card_id,installment_count)
      VALUES(uid,financed,'expense','real',it.item,COALESCE(p_purchase_date,CURRENT_DATE),
        it.category_id,'credito',it.notes,it.card_id,
        CASE WHEN it.payment_method='credito_parcelado' THEN GREATEST(COALESCE(it.installments,1),1) ELSE 1 END)
      RETURNING id INTO tx;
    ELSE
      INSERT INTO public.transactions(user_id,amount,type,flow,description,occurred_at,account_id,category_id,payment_method,notes)
      VALUES(uid,total,'expense','real',it.item,COALESCE(p_purchase_date,CURRENT_DATE),
        it.account_id,it.category_id,
        CASE WHEN it.payment_method='dinheiro' THEN 'dinheiro' ELSE 'pix' END,it.notes)
      RETURNING id INTO tx;
    END IF;
  END IF;

  UPDATE public.shopping_items
  SET status='comprado',transaction_id=tx,down_payment_transaction_id=entry_tx
  WHERE id=p_item_id;
  RETURN tx;
END $$;

-- Edicao de investimento e respectivo historico tornam-se uma unica transacao.
CREATE FUNCTION public.update_investment_details(
  p_investment_id uuid,p_name text,p_inv_type text,p_institution text,
  p_invested_amount numeric,p_current_amount numeric,p_initial_amount numeric,
  p_applied_at date,p_maturity_date date,p_liquidity text,p_risk text,
  p_objective text,p_notes text,p_status text,p_is_emergency_reserve boolean,p_color text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE uid uuid:=auth.uid(); old_row public.investments%ROWTYPE;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
  IF length(trim(COALESCE(p_name,'')))=0 OR p_invested_amount<0 OR p_current_amount<0 OR p_initial_amount<0 THEN
    RAISE EXCEPTION 'Dados de investimento invalidos';
  END IF;
  SELECT * INTO old_row FROM public.investments WHERE id=p_investment_id AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Investimento nao encontrado'; END IF;
  UPDATE public.investments SET name=trim(p_name),inv_type=p_inv_type,institution=p_institution,
    invested_amount=p_invested_amount,current_amount=p_current_amount,initial_amount=p_initial_amount,
    applied_at=p_applied_at,maturity_date=p_maturity_date,liquidity=p_liquidity,risk=p_risk,
    objective=p_objective,notes=p_notes,status=p_status,is_emergency_reserve=p_is_emergency_reserve,color=p_color
  WHERE id=p_investment_id AND user_id=uid;
  IF (old_row.invested_amount,old_row.current_amount,old_row.initial_amount)
     IS DISTINCT FROM (p_invested_amount,p_current_amount,p_initial_amount) THEN
    INSERT INTO public.investment_events(user_id,investment_id,event_type,amount,previous_amount,new_amount,notes)
    VALUES(uid,p_investment_id,'alteracao',p_current_amount-old_row.current_amount,
      old_row.current_amount,p_current_amount,'Cadastro atualizado');
  END IF;
END $$;

-- Salvar uma leitura OCR nao pode criar duplicata se a segunda etapa falhar/repetir.
CREATE FUNCTION public.save_ocr_detected_transaction(
  p_detected_id uuid,p_occurred_at date,p_amount numeric,p_type text,p_description text,
  p_category_id uuid,p_account_id uuid,p_payment_method text,p_credit_card_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE uid uuid:=auth.uid(); detected record; tx_id uuid;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
  SELECT id,review_status,saved_transaction_id INTO detected
  FROM public.ocr_detected_transactions WHERE id=p_detected_id AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leitura nao encontrada'; END IF;
  IF detected.review_status='saved' AND detected.saved_transaction_id IS NOT NULL THEN RETURN detected.saved_transaction_id; END IF;
  IF detected.review_status NOT IN ('pending','needs_review') THEN RAISE EXCEPTION 'Leitura ja processada'; END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_type NOT IN ('income','expense') THEN RAISE EXCEPTION 'Data, valor ou tipo invalido'; END IF;
  IF p_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=p_account_id AND user_id=uid) THEN
    RAISE EXCEPTION 'Conta nao encontrada'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id=p_category_id AND user_id=uid) THEN
    RAISE EXCEPTION 'Categoria nao encontrada'; END IF;
  IF p_credit_card_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.credit_cards WHERE id=p_credit_card_id AND user_id=uid) THEN
    RAISE EXCEPTION 'Cartao nao encontrado'; END IF;
  IF p_payment_method='credito' AND (p_type<>'expense' OR p_credit_card_id IS NULL) THEN
    RAISE EXCEPTION 'Compra no credito exige cartao'; END IF;
  INSERT INTO public.transactions(user_id,occurred_at,amount,type,flow,description,category_id,account_id,payment_method,credit_card_id)
  VALUES(uid,p_occurred_at,p_amount,p_type,'real',NULLIF(trim(p_description),''),p_category_id,
    CASE WHEN p_payment_method='credito' THEN NULL ELSE p_account_id END,p_payment_method,
    CASE WHEN p_payment_method='credito' THEN p_credit_card_id ELSE NULL END)
  RETURNING id INTO tx_id;
  UPDATE public.ocr_detected_transactions SET review_status='saved',saved_transaction_id=tx_id WHERE id=p_detected_id;
  RETURN tx_id;
END $$;

-- Um administrador apenas convida; a conta-alvo decide se quer virar espectador.
CREATE TABLE public.viewer_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'),
  responded_at timestamptz,
  CHECK (owner_id<>target_user_id)
);
CREATE UNIQUE INDEX viewer_invitations_one_pending ON public.viewer_invitations(owner_id,target_user_id)
  WHERE status='pending';
CREATE INDEX viewer_invitations_target_pending ON public.viewer_invitations(target_user_id,created_at DESC)
  WHERE status='pending';
ALTER TABLE public.viewer_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.viewer_invitations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.viewer_invitations TO authenticated;
GRANT ALL ON public.viewer_invitations TO service_role;
CREATE POLICY viewer_invitations_participant_read ON public.viewer_invitations FOR SELECT TO authenticated
  USING (owner_id=auth.uid() OR target_user_id=auth.uid());

ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_owner_valid CHECK (
  (role='admin' AND owner_id IS NULL) OR (role='viewer' AND owner_id IS NOT NULL AND owner_id<>user_id)
);
CREATE UNIQUE INDEX user_roles_one_role_per_user ON public.user_roles(user_id);

CREATE OR REPLACE FUNCTION private.grant_viewer_access(p_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); target uuid;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RETURN 'forbidden'; END IF;
  SELECT id INTO target FROM auth.users WHERE lower(email)=lower(trim(p_email)) LIMIT 1;
  IF target IS NULL THEN RETURN 'not_found'; END IF;
  IF target=uid THEN RETURN 'self'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=target AND role='viewer') THEN RETURN 'already_viewer'; END IF;
  IF EXISTS (SELECT 1 FROM public.viewer_invitations WHERE owner_id=uid AND target_user_id=target AND status='pending' AND expires_at>now()) THEN
    RETURN 'pending';
  END IF;
  UPDATE public.viewer_invitations SET status='expired',responded_at=now()
  WHERE owner_id=uid AND target_user_id=target AND status='pending';
  INSERT INTO public.viewer_invitations(owner_id,target_user_id) VALUES(uid,target);
  RETURN 'pending';
END $$;

CREATE OR REPLACE FUNCTION private.revoke_viewer_access(p_user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); changed boolean:=false;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RETURN 'forbidden'; END IF;
  UPDATE public.viewer_invitations SET status='revoked',responded_at=now()
  WHERE owner_id=uid AND target_user_id=p_user_id AND status IN ('pending','accepted');
  changed:=FOUND;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_user_id AND role='viewer' AND owner_id=uid) THEN
    DELETE FROM public.user_roles WHERE user_id=p_user_id AND role='viewer' AND owner_id=uid;
    INSERT INTO public.user_roles(user_id,role,owner_id) VALUES(p_user_id,'admin',NULL);
    changed:=true;
  END IF;
  RETURN CASE WHEN changed THEN 'ok' ELSE 'not_found' END;
END $$;

CREATE FUNCTION private.accept_viewer_access(p_invitation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); invitation public.viewer_invitations%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RETURN 'forbidden'; END IF;
  SELECT * INTO invitation FROM public.viewer_invitations
  WHERE id=p_invitation_id AND target_user_id=uid AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF invitation.expires_at<=now() THEN
    UPDATE public.viewer_invitations SET status='expired',responded_at=now() WHERE id=invitation.id;
    RETURN 'expired';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=uid AND role='viewer') THEN RETURN 'already_viewer'; END IF;
  DELETE FROM public.user_roles WHERE user_id=uid;
  INSERT INTO public.user_roles(user_id,role,owner_id) VALUES(uid,'viewer',invitation.owner_id);
  UPDATE public.viewer_invitations SET status='accepted',responded_at=now() WHERE id=invitation.id;
  UPDATE public.viewer_invitations SET status='declined',responded_at=now()
  WHERE target_user_id=uid AND status='pending' AND id<>invitation.id;
  RETURN 'ok';
END $$;

CREATE FUNCTION private.decline_viewer_access(p_invitation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN 'forbidden'; END IF;
  UPDATE public.viewer_invitations SET status='declined',responded_at=now()
  WHERE id=p_invitation_id AND target_user_id=uid AND status='pending';
  RETURN CASE WHEN FOUND THEN 'ok' ELSE 'not_found' END;
END $$;

CREATE FUNCTION private.leave_viewer_access()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid:=auth.uid(); owner uuid;
BEGIN
  IF uid IS NULL THEN RETURN 'forbidden'; END IF;
  SELECT owner_id INTO owner FROM public.user_roles WHERE user_id=uid AND role='viewer' FOR UPDATE;
  IF owner IS NULL THEN RETURN 'not_viewer'; END IF;
  DELETE FROM public.user_roles WHERE user_id=uid;
  INSERT INTO public.user_roles(user_id,role,owner_id) VALUES(uid,'admin',NULL);
  UPDATE public.viewer_invitations SET status='revoked',responded_at=now()
  WHERE owner_id=owner AND target_user_id=uid AND status='accepted';
  RETURN 'ok';
END $$;

DROP FUNCTION public.list_my_viewers();
DROP FUNCTION private.list_my_viewers();
CREATE FUNCTION private.list_my_viewers()
RETURNS TABLE(user_id uuid,email text,created_at timestamptz,status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT r.user_id,u.email::text,r.created_at,'accepted'::text
  FROM public.user_roles r JOIN auth.users u ON u.id=r.user_id
  WHERE r.role='viewer' AND r.owner_id=auth.uid()
  UNION ALL
  SELECT i.target_user_id,u.email::text,i.created_at,'pending'::text
  FROM public.viewer_invitations i JOIN auth.users u ON u.id=i.target_user_id
  WHERE i.owner_id=auth.uid() AND i.status='pending' AND i.expires_at>now();
$$;
CREATE FUNCTION public.list_my_viewers()
RETURNS TABLE(user_id uuid,email text,created_at timestamptz,status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT * FROM private.list_my_viewers(); $$;
CREATE FUNCTION public.accept_viewer_access(p_invitation_id uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.accept_viewer_access(p_invitation_id); $$;
CREATE FUNCTION public.decline_viewer_access(p_invitation_id uuid)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.decline_viewer_access(p_invitation_id); $$;
CREATE FUNCTION public.leave_viewer_access()
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.leave_viewer_access(); $$;
CREATE FUNCTION public.list_my_viewer_invitations()
RETURNS TABLE(id uuid,owner_email text,created_at timestamptz,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT i.id,u.email::text,i.created_at,i.expires_at
  FROM public.viewer_invitations i JOIN auth.users u ON u.id=i.owner_id
  WHERE i.target_user_id=auth.uid() AND i.status='pending' AND i.expires_at>now()
  ORDER BY i.created_at DESC;
$$;

-- Fecha execucao anonima herdada do privilegio padrao de funcoes.
REVOKE ALL ON FUNCTION public.apply_card_purchase(),public.update_updated_at_column(),
  public.generate_recurring_recharges(),public.mark_overdue_recharges() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_recharge_as_income(uuid),public.get_dashboard_snapshot(),
  public.is_admin(uuid),public.space_owner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_recharge_as_income(uuid),public.get_dashboard_snapshot(),
  public.is_admin(uuid),public.space_owner(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.update_investment_details(uuid,text,text,text,numeric,numeric,numeric,date,date,text,text,text,text,text,boolean,text),
  public.save_ocr_detected_transaction(uuid,date,numeric,text,text,uuid,uuid,text,uuid),
  public.list_my_viewers(),public.accept_viewer_access(uuid),public.decline_viewer_access(uuid),
  public.leave_viewer_access(),public.list_my_viewer_invitations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_investment_details(uuid,text,text,text,numeric,numeric,numeric,date,date,text,text,text,text,text,boolean,text),
  public.save_ocr_detected_transaction(uuid,date,numeric,text,text,uuid,uuid,text,uuid),
  public.list_my_viewers(),public.accept_viewer_access(uuid),public.decline_viewer_access(uuid),
  public.leave_viewer_access(),public.list_my_viewer_invitations() TO authenticated,service_role;
REVOKE ALL ON FUNCTION private.grant_viewer_access(text),private.revoke_viewer_access(uuid),private.list_my_viewers(),
  private.accept_viewer_access(uuid),private.decline_viewer_access(uuid),private.leave_viewer_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.grant_viewer_access(text),private.revoke_viewer_access(uuid),private.list_my_viewers(),
  private.accept_viewer_access(uuid),private.decline_viewer_access(uuid),private.leave_viewer_access() TO authenticated,service_role;