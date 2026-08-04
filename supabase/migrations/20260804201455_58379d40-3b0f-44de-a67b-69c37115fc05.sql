-- Downgrade role helpers to SECURITY INVOKER: they only ever read the caller's own
-- user_roles rows, which the "roles self read" policy already allows.
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.space_owner(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT owner_id FROM public.user_roles
      WHERE user_id = _user_id AND role = 'viewer' AND owner_id IS NOT NULL LIMIT 1),
    _user_id
  );
$function$;

-- grant_viewer_access must inspect the TARGET user's roles, which the invoker
-- helper can no longer see; check it inline inside this SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.grant_viewer_access(p_email text)
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

CREATE OR REPLACE FUNCTION public.revoke_viewer_access(p_user_id uuid)
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

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.space_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_viewer_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_viewer_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.space_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_viewer_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_viewer_access(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';