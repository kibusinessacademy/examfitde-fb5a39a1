-- Admin Role Management RPCs (SSOT: user_roles + has_role)

-- 1) List users with roles (admin only). Joins auth.users, profiles for display.
CREATE OR REPLACE FUNCTION public.admin_list_users_with_roles(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  user_id uuid,
  email text,
  display_name text,
  roles app_role[],
  last_sign_in_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.email::text,
    COALESCE(p.display_name, p.full_name, NULLIF(split_part(u.email, '@', 1), ''))::text AS display_name,
    COALESCE(
      (SELECT array_agg(ur.role ORDER BY ur.role) FROM public.user_roles ur WHERE ur.user_id = u.id),
      ARRAY[]::app_role[]
    ) AS roles,
    u.last_sign_in_at,
    u.created_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE p_search IS NULL
     OR u.email ILIKE '%' || p_search || '%'
     OR COALESCE(p.display_name, '') ILIKE '%' || p_search || '%'
     OR COALESCE(p.full_name, '') ILIKE '%' || p_search || '%'
  ORDER BY u.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 500));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users_with_roles(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_roles(text, int) TO authenticated;

-- 2) Grant a role (idempotent + audit)
CREATE OR REPLACE FUNCTION public.admin_grant_role(
  p_user_id uuid,
  p_role app_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted boolean := false;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, p_role)
  ON CONFLICT (user_id, role) DO NOTHING
  RETURNING true INTO v_inserted;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'admin_role_change', 'user', p_user_id::text,
    CASE WHEN v_inserted IS TRUE THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'op', 'grant',
      'role', p_role::text,
      'actor', auth.uid(),
      'idempotent', v_inserted IS NOT TRUE
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'op', 'grant',
    'role', p_role::text,
    'idempotent', v_inserted IS NOT TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_role(uuid, app_role) TO authenticated;

-- 3) Revoke a role (idempotent + audit, refuse to remove last admin)
CREATE OR REPLACE FUNCTION public.admin_revoke_role(
  p_user_id uuid,
  p_role app_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_count int;
  v_deleted int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id required';
  END IF;

  -- Safety: never remove the last admin
  IF p_role = 'admin'::app_role THEN
    SELECT COUNT(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin'::app_role;
    IF v_admin_count <= 1 AND EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin'::app_role
    ) THEN
      RAISE EXCEPTION 'cannot remove the last admin user';
    END IF;
  END IF;

  DELETE FROM public.user_roles
  WHERE user_id = p_user_id AND role = p_role;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'admin_role_change', 'user', p_user_id::text,
    CASE WHEN v_deleted > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'op', 'revoke',
      'role', p_role::text,
      'actor', auth.uid(),
      'rows', v_deleted
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'op', 'revoke',
    'role', p_role::text,
    'rows', v_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, app_role) TO authenticated;

-- Smoke
DO $$
BEGIN
  PERFORM 1 FROM pg_proc WHERE proname IN ('admin_list_users_with_roles','admin_grant_role','admin_revoke_role') AND pronamespace='public'::regnamespace;
  IF (SELECT COUNT(*) FROM pg_proc WHERE proname IN ('admin_list_users_with_roles','admin_grant_role','admin_revoke_role') AND pronamespace='public'::regnamespace) <> 3 THEN
    RAISE EXCEPTION 'admin role RPCs not all created';
  END IF;
END $$;