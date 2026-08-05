CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- internal SECURITY DEFINER implementations (not exposed via the Data API)
CREATE OR REPLACE FUNCTION private.grant_viewer_access(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_target uuid; v_is_admin boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN 'forbidden';
  END IF;
  SELECT id INTO v_target FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF v_target IS NULL THEN RETURN 'not_found'; END IF;
  IF v_target = v_uid THEN RETURN 'self'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_target AND role = 'admin')
    INTO v_is_admin;
  IF v_is_admin THEN
    DELETE FROM public.user_roles WHERE user_id = v_target AND role = 'admin';
  END IF;
  INSERT INTO public.user_roles (user_id, role, owner_id) VALUES (v_target, 'viewer', v_uid)
  ON CONFLICT (user_id, role) DO UPDATE SET owner_id = EXCLUDED.owner_id;
  RETURN 'ok';
END; $function$;

CREATE OR REPLACE FUNCTION private.revoke_viewer_access(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin') THEN
    RETURN 'forbidden';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = 'viewer' AND owner_id = v_uid;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN 'ok';
END; $function$;

CREATE OR REPLACE FUNCTION private.list_my_viewers()
RETURNS TABLE(user_id uuid, email text, created_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.user_id, u.email::text, r.created_at
  FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
  WHERE r.role = 'viewer' AND r.owner_id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION private.grant_viewer_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.revoke_viewer_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.list_my_viewers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.grant_viewer_access(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.revoke_viewer_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.list_my_viewers() TO authenticated, service_role;

-- public API wrappers now run as the caller (SECURITY INVOKER)
DROP FUNCTION IF EXISTS public.grant_viewer_access(text);
DROP FUNCTION IF EXISTS public.revoke_viewer_access(uuid);
DROP FUNCTION IF EXISTS public.list_my_viewers();

CREATE FUNCTION public.grant_viewer_access(p_email text)
RETURNS text
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$ SELECT private.grant_viewer_access(p_email); $function$;

CREATE FUNCTION public.revoke_viewer_access(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$ SELECT private.revoke_viewer_access(p_user_id); $function$;

CREATE FUNCTION public.list_my_viewers()
RETURNS TABLE(user_id uuid, email text, created_at timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$ SELECT * FROM private.list_my_viewers(); $function$;

REVOKE ALL ON FUNCTION public.grant_viewer_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_viewer_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_viewers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_viewer_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_viewer_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_viewers() TO authenticated;