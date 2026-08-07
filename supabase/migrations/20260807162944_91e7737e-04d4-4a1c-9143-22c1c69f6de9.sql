-- Migration: harden_financial_functions
-- Objetivo: escopo explicito por usuario + idempotencia (row lock) nas funcoes de escrita.
-- Impacto: mesma semantica; bloqueia acesso cruzado mesmo se uma policy for afrouxada.
-- Rollback sugerido: restaurar versoes anteriores sem "AND user_id = v_uid" / FOR UPDATE.

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
END; $function$;

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
END; $function$;

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
END; $function$;

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
END; $function$;

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
END; $function$;

CREATE OR REPLACE FUNCTION public.pay_credit_card_bill(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE b RECORD; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO b FROM public.credit_card_bills
  WHERE id = p_bill_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill not found'; END IF;

  IF b.status = 'paga' THEN RETURN; END IF;

  UPDATE public.credit_card_bills
  SET status = 'paga', payment_date = CURRENT_DATE
  WHERE id = p_bill_id AND user_id = v_uid;

  UPDATE public.credit_cards
  SET used_limit = GREATEST(0, used_limit - b.amount)
  WHERE id = b.card_id AND user_id = v_uid;
END; $function$;
