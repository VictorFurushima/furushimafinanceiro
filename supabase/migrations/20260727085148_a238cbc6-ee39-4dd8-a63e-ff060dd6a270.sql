-- Clean up any orphan references first so the FK can be added
UPDATE public.recurring_expenses r
   SET category_id = NULL
 WHERE category_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = r.category_id);

UPDATE public.recurring_expenses r
   SET account_id = NULL
 WHERE account_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = r.account_id);

ALTER TABLE public.recurring_expenses
  ADD CONSTRAINT recurring_expenses_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE public.recurring_expenses
  ADD CONSTRAINT recurring_expenses_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';