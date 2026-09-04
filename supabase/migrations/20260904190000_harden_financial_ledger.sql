-- Objetivo: garantir ciclo, parcelas, reversao e pagamento atomico do cartao.
-- Tabelas afetadas: transactions, credit_card_bills, credit_cards, credit_card_bill_items.
-- Impacto de dados: exige reconciliacao previa se houver compras/faturas legadas;
--   nao apaga registros. Auditoria de 2026-09-04 confirmou essas tabelas vazias.
-- RLS: preserva admin/viewer; parcelas somente leitura ao authenticated.
-- Indices/FKs: parcelas por transacao/fatura; pagamento unico por fatura;
--   vinculos financeiros passam a RESTRICT para preservar historico.
-- Rollback: preferir correcao incremental; exportar ledger antes de reverter.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.transactions WHERE credit_card_id IS NOT NULL OR bill_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.credit_card_bills)
     OR EXISTS (SELECT 1 FROM public.credit_cards WHERE used_limit <> 0) THEN
    RAISE EXCEPTION 'Reconciliar compras, faturas e limite legado antes desta migration';
  END IF;
END $$;

ALTER TABLE public.transactions ADD COLUMN installment_count integer NOT NULL DEFAULT 1
  CHECK (installment_count BETWEEN 1 AND 120);
ALTER TABLE public.transactions ADD CONSTRAINT transactions_positive_amount CHECK (amount > 0);
ALTER TABLE public.credit_cards ADD CONSTRAINT credit_cards_valid_days
  CHECK (closing_day BETWEEN 1 AND 31 AND due_day BETWEEN 1 AND 31);
ALTER TABLE public.credit_card_bills ADD COLUMN manual_amount numeric NOT NULL DEFAULT 0
  CHECK (manual_amount >= 0);
ALTER TABLE public.credit_card_bills ADD CONSTRAINT bills_valid_values
  CHECK (amount >= 0 AND month BETWEEN 1 AND 12);

ALTER TABLE public.transactions DROP CONSTRAINT transactions_credit_card_id_fkey,
  DROP CONSTRAINT transactions_bill_id_fkey,
  DROP CONSTRAINT transactions_account_id_fkey,
  DROP CONSTRAINT transactions_destination_account_id_fkey;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_credit_card_id_fkey FOREIGN KEY (credit_card_id) REFERENCES public.credit_cards(id) ON DELETE RESTRICT,
  ADD CONSTRAINT transactions_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES public.credit_card_bills(id) ON DELETE RESTRICT,
  ADD CONSTRAINT transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT transactions_destination_account_id_fkey FOREIGN KEY (destination_account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;
ALTER TABLE public.credit_card_bills DROP CONSTRAINT credit_card_bills_card_id_fkey;
ALTER TABLE public.credit_card_bills ADD CONSTRAINT credit_card_bills_card_id_fkey
  FOREIGN KEY (card_id) REFERENCES public.credit_cards(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_transactions_bill_payment ON public.transactions(bill_id)
  WHERE flow = 'bill_payment';

CREATE TABLE public.credit_card_bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.credit_card_bills(id) ON DELETE RESTRICT,
  installment_number integer NOT NULL CHECK (installment_number > 0),
  amount numeric NOT NULL CHECK (amount > 0),
  UNIQUE (transaction_id, installment_number)
);
CREATE INDEX idx_bill_items_bill ON public.credit_card_bill_items(bill_id);
ALTER TABLE public.credit_card_bill_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.credit_card_bill_items TO authenticated;
GRANT ALL ON public.credit_card_bill_items TO service_role;
CREATE POLICY bill_items_space_read ON public.credit_card_bill_items FOR SELECT TO authenticated
  USING (user_id = (SELECT public.space_owner((SELECT auth.uid()))));

-- Fechamento inclui o proprio dia; vencimento e sempre posterior ao fechamento.
CREATE FUNCTION public.card_cycle_due(p_date date, p_closing integer, p_due integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE m date := date_trunc('month',p_date)::date; closing date; due date;
BEGIN
  IF p_date IS NULL OR p_closing NOT BETWEEN 1 AND 31 OR p_due NOT BETWEEN 1 AND 31 THEN
    RAISE EXCEPTION 'Data ou dias do cartao invalidos';
  END IF;
  closing := m + (LEAST(p_closing, EXTRACT(DAY FROM m + interval '1 month - 1 day')::int)-1);
  IF p_date > closing THEN m := (m + interval '1 month')::date; END IF;
  closing := m + (LEAST(p_closing, EXTRACT(DAY FROM m + interval '1 month - 1 day')::int)-1);
  due := m + (LEAST(p_due, EXTRACT(DAY FROM m + interval '1 month - 1 day')::int)-1);
  IF due <= closing THEN
    m := (m + interval '1 month')::date;
    due := m + (LEAST(p_due, EXTRACT(DAY FROM m + interval '1 month - 1 day')::int)-1);
  END IF;
  RETURN due;
END $$;

CREATE FUNCTION public.validate_financial_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    -- Serializa alteracoes/pagamentos por cartao antes de tocar nas faturas.
    PERFORM 1 FROM public.credit_cards WHERE id IN
      (OLD.credit_card_id, (SELECT card_id FROM public.credit_card_bills WHERE id=OLD.bill_id))
      ORDER BY id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.credit_card_bill_items i JOIN public.credit_card_bills b ON b.id=i.bill_id
               WHERE i.transaction_id=OLD.id AND b.status='paga') THEN
      RAISE EXCEPTION 'Estorne o pagamento da fatura antes de alterar ou excluir esta compra';
    END IF;
    IF TG_OP='UPDATE' AND OLD.flow='bill_payment' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Para corrigir pagamento, exclua o pagamento e quite novamente';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.user_id <> OLD.user_id THEN RAISE EXCEPTION 'Titular imutavel'; END IF;
  IF NEW.account_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM public.accounts WHERE id=NEW.account_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'Conta de origem de outro titular'; END IF;
  IF NEW.destination_account_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM public.accounts WHERE id=NEW.destination_account_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'Conta de destino de outro titular'; END IF;
  IF NEW.category_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM public.categories WHERE id=NEW.category_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'Categoria de outro titular'; END IF;
  IF NEW.type='transfer' AND (NEW.credit_card_id IS NOT NULL OR NEW.bill_id IS NOT NULL OR NEW.flow <> 'real') THEN
    RAISE EXCEPTION 'Transferencia deve mover apenas contas'; END IF;
  IF NEW.type <> 'transfer' AND NEW.destination_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'Destino somente para transferencia'; END IF;
  IF NEW.credit_card_id IS NOT NULL THEN
    PERFORM 1 FROM public.credit_cards WHERE id=NEW.credit_card_id AND user_id=NEW.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cartao de outro titular'; END IF;
    IF NEW.type <> 'expense' OR NEW.flow <> 'real' OR NEW.bill_id IS NOT NULL THEN
      RAISE EXCEPTION 'Compra de cartao deve ser despesa real'; END IF;
    NEW.account_id := NULL;
    NEW.payment_method := 'credito';
  ELSIF NEW.payment_method='credito' AND NEW.type='expense' AND NEW.flow='real' THEN
    RAISE EXCEPTION 'Compra no credito exige cartao';
  ELSIF NEW.installment_count <> 1 THEN RAISE EXCEPTION 'Parcelas exigem cartao';
  END IF;
  IF NEW.flow='bill_payment' THEN
    IF NEW.bill_id IS NULL OR NEW.account_id IS NULL OR NEW.type <> 'expense' OR NEW.credit_card_id IS NOT NULL THEN
      RAISE EXCEPTION 'Pagamento exige fatura e conta pagadora'; END IF;
    PERFORM 1 FROM public.credit_cards WHERE id=(SELECT card_id FROM public.credit_card_bills WHERE id=NEW.bill_id)
      AND user_id=NEW.user_id FOR UPDATE;
    PERFORM 1 FROM public.credit_card_bills WHERE id=NEW.bill_id AND user_id=NEW.user_id
      AND status <> 'paga' AND amount=NEW.amount FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fatura invalida, paga ou valor divergente'; END IF;
  ELSIF NEW.bill_id IS NOT NULL THEN RAISE EXCEPTION 'Vinculo de fatura reservado ao pagamento';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_financial_transaction BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_financial_transaction();

-- Trigger interno: parcelas nao aceitam escrita direta pelo cliente.
CREATE FUNCTION public.refresh_bill_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE bid uuid := CASE WHEN TG_OP='DELETE' THEN OLD.bill_id ELSE NEW.bill_id END;
BEGIN
  UPDATE public.credit_card_bills b SET amount = manual_amount +
    COALESCE((SELECT sum(i.amount) FROM public.credit_card_bill_items i WHERE i.bill_id=b.id),0)
    WHERE b.id=bid;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_refresh_bill_totals AFTER INSERT OR DELETE ON public.credit_card_bill_items
  FOR EACH ROW EXECUTE FUNCTION public.refresh_bill_totals();

CREATE FUNCTION public.validate_bill()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status='paga' THEN RAISE EXCEPTION 'Fatura paga possui historico financeiro'; END IF;
    RETURN OLD;
  END IF;
  PERFORM 1 FROM public.credit_cards WHERE id=NEW.card_id AND user_id=NEW.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cartao da fatura de outro titular'; END IF;
  -- Compatibilidade com formularios anteriores que enviam amount na inclusao.
  IF TG_OP='INSERT' AND NEW.manual_amount=0 AND NEW.amount>0 THEN NEW.manual_amount:=NEW.amount; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.card_id,NEW.user_id,NEW.month,NEW.year) IS DISTINCT FROM (OLD.card_id,OLD.user_id,OLD.month,OLD.year) THEN
      RAISE EXCEPTION 'Ciclo e titular da fatura sao imutaveis'; END IF;
    IF OLD.status='paga' AND (NEW.amount,NEW.manual_amount,NEW.due_date) IS DISTINCT FROM (OLD.amount,OLD.manual_amount,OLD.due_date) THEN
      RAISE EXCEPTION 'Fatura paga nao pode receber alteracoes'; END IF;
  END IF;
  NEW.amount := NEW.manual_amount + COALESCE((SELECT sum(amount) FROM public.credit_card_bill_items WHERE bill_id=NEW.id),0);
  -- Estado derivado do pagamento; cliente nao pode marcar como paga sem debito.
  SELECT occurred_at INTO NEW.payment_date FROM public.transactions WHERE bill_id=NEW.id AND flow='bill_payment';
  NEW.status := CASE WHEN NEW.payment_date IS NOT NULL THEN 'paga'
    WHEN NEW.due_date < CURRENT_DATE THEN 'atrasada' ELSE 'aberta' END;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_bill BEFORE INSERT OR UPDATE OR DELETE ON public.credit_card_bills
  FOR EACH ROW EXECUTE FUNCTION public.validate_bill();

CREATE FUNCTION public.refresh_card_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid := CASE WHEN TG_OP='DELETE' THEN OLD.card_id ELSE NEW.card_id END;
BEGIN
  UPDATE public.credit_cards c SET used_limit=COALESCE((SELECT sum(amount)
    FROM public.credit_card_bills WHERE card_id=c.id AND status <> 'paga'),0) WHERE c.id=cid;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_refresh_card_limit AFTER INSERT OR UPDATE OR DELETE ON public.credit_card_bills
  FOR EACH ROW EXECUTE FUNCTION public.refresh_card_limit();

CREATE FUNCTION public.guard_card_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.user_id <> OLD.user_id THEN RAISE EXCEPTION 'Titular imutavel'; END IF;
  NEW.used_limit := COALESCE((SELECT sum(amount) FROM public.credit_card_bills
    WHERE card_id=NEW.id AND status <> 'paga'),0);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_card_limit BEFORE INSERT OR UPDATE ON public.credit_cards
  FOR EACH ROW EXECUTE FUNCTION public.guard_card_limit();

DROP TRIGGER trg_apply_card_purchase ON public.transactions;
CREATE OR REPLACE FUNCTION public.apply_card_purchase()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; due date; m date; bid uuid; part numeric; cents bigint;
BEGIN
  -- Recorrencias executadas pelo cron continuam sob o controle de acesso original.
  IF (TG_OP='INSERT' AND NEW.credit_card_id IS NULL AND NEW.flow <> 'bill_payment')
     OR (TG_OP='DELETE' AND OLD.credit_card_id IS NULL AND OLD.flow <> 'bill_payment')
     OR (TG_OP='UPDATE' AND OLD.credit_card_id IS NULL AND NEW.credit_card_id IS NULL
       AND OLD.flow <> 'bill_payment' AND NEW.flow <> 'bill_payment') THEN RETURN NULL; END IF;
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) OR
     (CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END) <> auth.uid() THEN
    RAISE EXCEPTION 'Operacao financeira exige administrador titular'; END IF;
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
CREATE TRIGGER trg_apply_card_purchase AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_card_purchase();

CREATE OR REPLACE FUNCTION public.pay_credit_card_bill(p_bill_id uuid,p_account_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE b record; cid uuid; uid uuid:=auth.uid(); card_name text;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
  IF p_account_id IS NULL THEN RAISE EXCEPTION 'Selecione a conta pagadora'; END IF;
  SELECT card_id INTO cid FROM public.credit_card_bills WHERE id=p_bill_id AND user_id=uid;
  SELECT name INTO card_name FROM public.credit_cards WHERE id=cid AND user_id=uid FOR UPDATE;
  SELECT id,amount,status INTO b FROM public.credit_card_bills WHERE id=p_bill_id AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fatura nao encontrada'; END IF;
  IF b.status='paga' THEN RETURN; END IF;
  IF b.amount <= 0 THEN RAISE EXCEPTION 'Fatura sem valor a pagar'; END IF;
  INSERT INTO public.transactions(user_id,amount,type,flow,description,occurred_at,account_id,bill_id,payment_method)
    VALUES(uid,b.amount,'expense','bill_payment','Pagamento de fatura '||card_name,CURRENT_DATE,p_account_id,b.id,'transferencia');
END $$;

DROP FUNCTION IF EXISTS public.complete_shopping_item(uuid,boolean);
CREATE FUNCTION public.complete_shopping_item(
  p_item_id uuid,
  p_create_transaction boolean,
  p_purchase_date date DEFAULT CURRENT_DATE
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE uid uuid:=auth.uid(); it record; tx uuid; total numeric; credit boolean;
BEGIN
  IF uid IS NULL OR NOT public.is_admin(uid) THEN RAISE EXCEPTION 'Administrador obrigatorio'; END IF;
  SELECT * INTO it FROM public.shopping_items WHERE id=p_item_id AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compra nao encontrada'; END IF;
  IF it.transaction_id IS NOT NULL THEN RETURN it.transaction_id; END IF;
  total := round(it.price+it.shipping+it.interest-it.discount,2);
  credit := it.payment_method IN ('credito_vista','credito_parcelado');
  IF p_create_transaction THEN
    IF credit AND it.card_id IS NULL THEN RAISE EXCEPTION 'Selecione o cartao da compra'; END IF;
    IF credit AND it.down_payment > 0 THEN
      RAISE EXCEPTION 'Registre a entrada separadamente e planeje somente o valor financiado no cartao';
    END IF;
    INSERT INTO public.transactions(user_id,amount,type,flow,description,occurred_at,account_id,category_id,payment_method,notes,credit_card_id,installment_count)
      VALUES(uid,total,'expense','real',it.item,COALESCE(p_purchase_date,CURRENT_DATE),
        CASE WHEN credit THEN NULL ELSE it.account_id END,it.category_id,
        CASE WHEN credit THEN 'credito' WHEN it.payment_method='dinheiro' THEN 'dinheiro' ELSE 'pix' END,
        it.notes,CASE WHEN credit THEN it.card_id ELSE NULL END,
        CASE WHEN credit THEN GREATEST(COALESCE(it.installments,1),1) ELSE 1 END) RETURNING id INTO tx;
  END IF;
  UPDATE public.shopping_items SET status='comprado',transaction_id=tx WHERE id=p_item_id;
  RETURN tx;
END $$;

REVOKE ALL ON FUNCTION public.apply_card_purchase(),public.refresh_bill_totals(),public.refresh_card_limit(),
  public.validate_financial_transaction(),public.validate_bill() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_card_limit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pay_credit_card_bill(uuid,uuid),public.card_cycle_due(date,integer,integer),
  public.complete_shopping_item(uuid,boolean,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pay_credit_card_bill(uuid,uuid),public.card_cycle_due(date,integer,integer),
  public.complete_shopping_item(uuid,boolean,date) TO authenticated,service_role;
