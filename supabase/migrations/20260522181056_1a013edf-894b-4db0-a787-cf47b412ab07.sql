
REVOKE EXECUTE ON FUNCTION public.generate_recurring_transactions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_recurring_transactions() TO authenticated;
