-- Migration: add_financial_indexes
-- Objetivo: cobrir os filtros/ordenacoes reais das telas e das policies.
-- Impacto: leituras muito mais rapidas; pequeno custo extra por escrita.
-- Rollback sugerido: DROP INDEX IF EXISTS <nome>;

-- listagens por usuario ordenadas por criacao/nome
CREATE INDEX IF NOT EXISTS idx_accounts_user_created        ON public.accounts (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_categories_user_name         ON public.categories (user_id, name);
CREATE INDEX IF NOT EXISTS idx_goals_user_created           ON public.goals (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_cards_user_created    ON public.credit_cards (user_id, created_at);

-- investimentos e seus eventos
CREATE INDEX IF NOT EXISTS idx_investments_user_status_created ON public.investments (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_events_user_date            ON public.investment_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_events_inv_date             ON public.investment_events (investment_id, occurred_at DESC);

-- anotacoes e carrinho
CREATE INDEX IF NOT EXISTS idx_notes_user_date              ON public.notes (user_id, note_date DESC);
CREATE INDEX IF NOT EXISTS idx_shopping_user_status_created ON public.shopping_items (user_id, status, created_at DESC);

-- calendario financeiro
CREATE INDEX IF NOT EXISTS idx_ccbills_user_due             ON public.credit_card_bills (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_recharges_user_expected      ON public.balance_recharges (user_id, expected_date);
CREATE INDEX IF NOT EXISTS idx_recurring_user_status_day    ON public.recurring_expenses (user_id, status, billing_day);
CREATE INDEX IF NOT EXISTS idx_budgets_user_month           ON public.budgets (user_id, month);
CREATE INDEX IF NOT EXISTS idx_uploaded_images_user_date    ON public.uploaded_transaction_images (user_id, upload_date DESC);

-- lookup de espectadores por dono
CREATE INDEX IF NOT EXISTS idx_user_roles_owner_role        ON public.user_roles (owner_id, role) WHERE owner_id IS NOT NULL;

-- joins de transacoes (accounts/categories) - parciais para ignorar NULLs
CREATE INDEX IF NOT EXISTS idx_transactions_account         ON public.transactions (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_category        ON public.transactions (category_id) WHERE category_id IS NOT NULL;

-- idempotencia de lancamentos recorrentes (nao existem duplicatas hoje: verificado)
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_recurring_period
  ON public.transactions (user_id, recurring_id, occurred_at)
  WHERE recurring_id IS NOT NULL;

-- idempotencia de recargas recorrentes geradas por mes
-- (a data gerada e deterministica por mes/origem)
CREATE UNIQUE INDEX IF NOT EXISTS uq_recharges_source_date
  ON public.balance_recharges (user_id, source_recharge_id, expected_date)
  WHERE source_recharge_id IS NOT NULL;
