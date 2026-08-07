-- Migration: add_missing_foreign_keys
-- Objetivo: garantir integridade referencial nas colunas *_id sem risco de perda de dados.
-- Pre-checagem executada: 0 registros orfaos em todas as relacoes abaixo.
-- Impacto: nenhuma linha alterada; apenas constraints (e indices implicitos ja criados).
-- Rollback sugerido: ALTER TABLE ... DROP CONSTRAINT <nome>;

-- vinculos de usuario (donos) -> CASCADE apenas ao excluir a conta de autenticacao
ALTER TABLE public.credit_cards
  ADD CONSTRAINT credit_cards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.credit_card_bills
  ADD CONSTRAINT credit_card_bills_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.category_limits
  ADD CONSTRAINT category_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.uploaded_transaction_images
  ADD CONSTRAINT uploaded_transaction_images_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.balance_recharges
  ADD CONSTRAINT balance_recharges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.ocr_detected_transactions
  ADD CONSTRAINT ocr_detected_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.recurring_expenses
  ADD CONSTRAINT recurring_expenses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- recargas
ALTER TABLE public.balance_recharges
  ADD CONSTRAINT balance_recharges_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.balance_recharges
  ADD CONSTRAINT balance_recharges_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.credit_cards(id) ON DELETE SET NULL;
ALTER TABLE public.balance_recharges
  ADD CONSTRAINT balance_recharges_source_recharge_id_fkey FOREIGN KEY (source_recharge_id) REFERENCES public.balance_recharges(id) ON DELETE SET NULL;

-- cartoes e faturas: fatura nao existe sem o cartao
ALTER TABLE public.credit_card_bills
  ADD CONSTRAINT credit_card_bills_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.credit_cards(id) ON DELETE CASCADE;

-- metas e limites
ALTER TABLE public.goals
  ADD CONSTRAINT goals_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
ALTER TABLE public.category_limits
  ADD CONSTRAINT category_limits_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;

-- leitura de prints
ALTER TABLE public.ocr_detected_transactions
  ADD CONSTRAINT ocr_detected_transactions_suggested_category_id_fkey FOREIGN KEY (suggested_category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
ALTER TABLE public.ocr_detected_transactions
  ADD CONSTRAINT ocr_detected_transactions_saved_transaction_id_fkey FOREIGN KEY (saved_transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;

-- transacoes derivadas
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_recurring_id_fkey FOREIGN KEY (recurring_id) REFERENCES public.recurring_expenses(id) ON DELETE SET NULL;
ALTER TABLE public.investment_events
  ADD CONSTRAINT investment_events_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;
ALTER TABLE public.shopping_items
  ADD CONSTRAINT shopping_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;

-- indices de suporte para as novas FKs sem indice proprio
CREATE INDEX IF NOT EXISTS idx_recharges_account          ON public.balance_recharges (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recharges_card             ON public.balance_recharges (card_id) WHERE card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ccbills_card               ON public.credit_card_bills (card_id);
CREATE INDEX IF NOT EXISTS idx_goals_category             ON public.goals (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_category_limits_category   ON public.category_limits (category_id);
CREATE INDEX IF NOT EXISTS idx_ocr_saved_tx               ON public.ocr_detected_transactions (saved_transaction_id) WHERE saved_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_events_tx              ON public.investment_events (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shopping_tx                ON public.shopping_items (transaction_id) WHERE transaction_id IS NOT NULL;
