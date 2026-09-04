-- Objetivo: remover o hub pessoal (agenda, rotinas, tarefas, anotacoes, alertas,
--           integracao Google Calendar) e evoluir o modelo financeiro para
--           diferenciar receita, despesa, compra no cartao, transferencia entre
--           contas e pagamento de fatura sem duplicar registros.
-- Tabelas afetadas: DROP calendar_events, calendar_integrations, routines,
--           routine_occurrences, tasks, notes, alerts; ALTER transactions;
--           funcoes get_account_balances, get_financial_overview, pay_credit_card_bill.
-- Impacto de dados: tabelas removidas estavam vazias (auditado); transactions
--           apenas ganha colunas nullable. Nenhum dado financeiro e perdido.
-- RLS: policies das tabelas removidas caem junto; transactions mantem policies atuais.
-- Indices/FKs: novos indices parciais em transactions(credit_card_id),
--           transactions(destination_account_id), transactions(bill_id).
-- Rollback: recriar as tabelas do hub por migration nova; nas transacoes,
--           DROP das colunas credit_card_id/destination_account_id/bill_id e
--           restaurar o CHECK antigo de type.

-- 1) Hub pessoal descartado -------------------------------------------------
DROP FUNCTION IF EXISTS public.materialize_routine_events(integer);
DROP FUNCTION IF EXISTS public.complete_routine_occurrence(uuid, date, text);

DROP TABLE IF EXISTS public.alerts CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;
DROP TABLE IF EXISTS public.routine_occurrences CASCADE;
DROP TABLE IF EXISTS public.routines CASCADE;
DROP TABLE IF EXISTS public.calendar_events CASCADE;
DROP TABLE IF EXISTS public.calendar_integrations CASCADE;
DROP TABLE IF EXISTS public.notes CASCADE;

-- 2) Modelo financeiro unico ------------------------------------------------
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_type_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type = ANY (ARRAY['income'::text, 'expense'::text, 'transfer'::text]));

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS credit_card_id uuid REFERENCES public.credit_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.credit_card_bills(id) ON DELETE SET NULL;

-- Transferencia sempre tem origem e destino distintos.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_transfer_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_transfer_check CHECK (
    type <> 'transfer'
    OR (account_id IS NOT NULL AND destination_account_id IS NOT NULL
        AND destination_account_id <> account_id)
  );

CREATE INDEX IF NOT EXISTS idx_transactions_credit_card
  ON public.transactions (credit_card_id, occurred_at DESC)
  WHERE credit_card_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_destination_account
  ON public.transactions (destination_account_id)
  WHERE destination_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_bill
  ON public.transactions (bill_id)
  WHERE bill_id IS NOT NULL;

-- 3) Compra no cartao alimenta limite e fatura (nunca o saldo da conta) ------
CREATE OR REPLACE FUNCTION public.apply_card_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_apply_card_purchase ON public.transactions;
CREATE TRIGGER trg_apply_card_purchase
AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.apply_card_purchase();

-- 4) Pagamento de fatura: debita a conta pagadora sem virar despesa do mes ---
CREATE OR REPLACE FUNCTION public.pay_credit_card_bill(p_bill_id uuid, p_account_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
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
$$;

DROP FUNCTION IF EXISTS public.pay_credit_card_bill(uuid);

-- 5) Saldos por conta cientes de cartao, transferencia e pagamento de fatura -
CREATE OR REPLACE FUNCTION public.get_account_balances()
RETURNS TABLE(id uuid, name text, type text, color text, initial_balance numeric, balance numeric)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
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
$$;

-- 6) Visao geral: saldo disponivel usa as mesmas regras -----------------------
CREATE OR REPLACE FUNCTION public.get_financial_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
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
$$;