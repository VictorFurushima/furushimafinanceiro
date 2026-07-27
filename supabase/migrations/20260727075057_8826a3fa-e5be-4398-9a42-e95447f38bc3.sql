-- Convert user-callable RPCs from SECURITY DEFINER to SECURITY INVOKER so they
-- run under the caller's RLS instead of bypassing it. All target rows are
-- user-scoped (auth.uid() = user_id) and already covered by INSERT/UPDATE
-- policies, so authenticated users can still perform the same actions.
ALTER FUNCTION public.generate_recurring_transactions() SECURITY INVOKER;
ALTER FUNCTION public.generate_recurring_recharges() SECURITY INVOKER;
ALTER FUNCTION public.mark_overdue_recharges() SECURITY INVOKER;
ALTER FUNCTION public.confirm_recharge_as_income(uuid) SECURITY INVOKER;
ALTER FUNCTION public.pay_credit_card_bill(uuid) SECURITY INVOKER;

-- handle_new_user is a SECURITY DEFINER trigger executed by the auth system on
-- signup. Nobody should call it as an RPC; revoke execute from PUBLIC/anon/
-- authenticated. The trigger still fires because it runs as the function owner.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;