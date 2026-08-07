-- Migration: optimize_rls_initplans
-- Objetivo: substituir chamadas por linha de auth.uid(), space_owner() e is_admin()
--           por subqueries escalares (InitPlan), avaliadas 1x por statement.
-- Impacto: mesma semântica de segurança, menos chamadas repetidas a user_roles.
-- Rollback sugerido: recriar as policies com as expressões diretas
--   (user_id = auth.uid() AND is_admin(auth.uid())) / (user_id = space_owner(auth.uid())).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'accounts','balance_recharges','budgets','categories','category_limits',
    'credit_card_bills','credit_cards','goals','investments','investment_events',
    'notes','ocr_detected_transactions','recurring_expenses','shopping_items',
    'transactions','uploaded_transaction_images','user_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_space_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_write', t);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR SELECT TO authenticated
      USING (user_id = (SELECT public.space_owner((SELECT auth.uid()))))
    $f$, t || '_space_read', t);

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR ALL TO authenticated
      USING (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
      WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_admin((SELECT auth.uid()))))
    $f$, t || '_admin_write', t);
  END LOOP;
END $$;

-- user_roles: mesma regra, avaliada uma vez
DROP POLICY IF EXISTS "roles self read" ON public.user_roles;
CREATE POLICY "roles self read" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR owner_id = (SELECT auth.uid()));

-- profiles: mesma regra, avaliada uma vez
DROP POLICY IF EXISTS "Profiles self select" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self update" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self insert" ON public.profiles;
CREATE POLICY "Profiles self select" ON public.profiles
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
CREATE POLICY "Profiles self update" ON public.profiles
  FOR UPDATE TO authenticated USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY "Profiles self insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));
