-- Migration: validate_recurring_conflict_targets
-- Objetivo: garantir que os alvos ON CONFLICT parciais sao inferiveis (plan-time check).
-- Impacto: nenhum - toda escrita e revertida pelo bloco EXCEPTION.
-- Rollback: nao aplicavel.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.transactions (user_id, amount, type, description, occurred_at, recurring_id)
    SELECT r.user_id, r.amount, 'expense', r.name, CURRENT_DATE, r.id
    FROM public.recurring_expenses r
    ON CONFLICT (user_id, recurring_id, occurred_at) WHERE recurring_id IS NOT NULL DO NOTHING;

    INSERT INTO public.balance_recharges
      (user_id, name, recharge_type, expected_amount, expected_date, status, source_recharge_id)
    SELECT r.user_id, r.name, r.recharge_type, r.expected_amount, CURRENT_DATE, 'prevista', r.id
    FROM public.balance_recharges r
    WHERE r.source_recharge_id IS NULL
    ON CONFLICT (user_id, source_recharge_id, expected_date) WHERE source_recharge_id IS NOT NULL DO NOTHING;

    RAISE EXCEPTION 'validation_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'validation_rollback' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ON CONFLICT targets OK';
END $$;
