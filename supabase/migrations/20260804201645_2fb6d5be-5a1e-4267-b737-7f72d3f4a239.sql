-- Now SECURITY INVOKER: they can only read what the caller can already read under RLS,
-- so restoring the default PUBLIC EXECUTE is safe and keeps RLS policy evaluation working
-- for every role (authenticated, service_role, internal tooling).
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.space_owner(uuid) TO PUBLIC;

NOTIFY pgrst, 'reload schema';