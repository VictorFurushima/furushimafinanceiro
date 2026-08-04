-- Helper not used by the app or by any RLS policy: remove client-callable EXECUTE.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;

-- Never callable by unauthenticated visitors.
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.space_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_viewer_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_viewer_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_viewers() FROM PUBLIC, anon;

-- Required by RLS policies (evaluated as the calling role) and by admin-only features
-- that re-check public.is_admin(auth.uid()) inside the function body.
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.space_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_viewer_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_viewer_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_viewers() TO authenticated;

NOTIFY pgrst, 'reload schema';