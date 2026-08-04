GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.space_owner(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.grant_viewer_access(text) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.revoke_viewer_access(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.list_my_viewers() TO service_role, postgres;

NOTIFY pgrst, 'reload schema';