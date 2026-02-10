
-- ============================================================
-- profiles RLS Guard + Email Column Removal
-- ============================================================

-- 1) Guard function: assert profiles RLS is secure
CREATE OR REPLACE FUNCTION public.assert_profiles_rls_secure()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  unsafe_count int;
  rls_enabled boolean;
BEGIN
  -- RLS must be enabled
  SELECT relrowsecurity INTO rls_enabled
  FROM pg_class WHERE relname = 'profiles';

  IF rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SECURITY VIOLATION: RLS is not enabled on public.profiles';
  END IF;

  -- No anon or public SELECT policies allowed
  SELECT count(*) INTO unsafe_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'profiles'
    AND cmd = 'SELECT'
    AND (roles @> array['anon']::name[] OR roles @> array['public']::name[]);

  IF unsafe_count > 0 THEN
    RAISE EXCEPTION 'SECURITY VIOLATION: public/anon SELECT policy detected on public.profiles';
  END IF;
END;
$$;

-- Run guard immediately to verify current state
SELECT public.assert_profiles_rls_secure();

-- 2) Admin runtime check function
CREATE OR REPLACE FUNCTION public.get_profiles_security_status()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'rls_enabled', (
      SELECT relrowsecurity FROM pg_class WHERE relname = 'profiles'
    ),
    'unsafe_policies', (
      SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'profiles'
        AND cmd = 'SELECT'
        AND (roles @> array['anon']::name[] OR roles @> array['public']::name[])
    )
  );
$$;

-- 3) Data minimization: drop email column from profiles
-- Email lives in auth.users, no need to duplicate it
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;
