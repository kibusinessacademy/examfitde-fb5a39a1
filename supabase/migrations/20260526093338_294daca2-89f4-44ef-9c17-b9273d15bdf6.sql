CREATE OR REPLACE FUNCTION public._debug_whoami_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'current_user', current_user::text,
    'session_user', session_user::text,
    'auth_uid', auth.uid()::text,
    'auth_role', auth.role()
  )
$$;
GRANT EXECUTE ON FUNCTION public._debug_whoami_v1() TO anon, authenticated;