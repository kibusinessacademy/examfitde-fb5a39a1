
-- ═══════════════════════════════════════════════════════
-- SECURITY HARDENING: churn_predictions + profiles
-- ═══════════════════════════════════════════════════════

-- 1. churn_predictions: Strict admin-only RLS
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'churn_predictions' AND schemaname = 'public'
    AND policyname = 'admin_only_churn_predictions'
  ) THEN
    -- Revoke all from non-admin roles
    REVOKE ALL ON public.churn_predictions FROM anon;
    REVOKE ALL ON public.churn_predictions FROM authenticated;

    -- Enable RLS if not already
    ALTER TABLE public.churn_predictions ENABLE ROW LEVEL SECURITY;

    -- Drop any existing permissive policies
    DROP POLICY IF EXISTS "Allow all" ON public.churn_predictions;
    DROP POLICY IF EXISTS "Enable read access for all users" ON public.churn_predictions;
    DROP POLICY IF EXISTS "churn_predictions_select" ON public.churn_predictions;

    -- Admin-only policy using has_role function
    CREATE POLICY "admin_only_churn_predictions"
      ON public.churn_predictions
      FOR ALL
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 2. profiles: Minimal projection for regular users, full access for admins
DO $$ BEGIN
  -- Drop overly permissive policies
  DROP POLICY IF EXISTS "Allow all" ON public.profiles;
  DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
  DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
  DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

  -- Revoke anon access
  REVOKE ALL ON public.profiles FROM anon;

  -- Enable RLS
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
END $$;

-- Users can read their own profile
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'users_read_own_profile'
  ) THEN
    CREATE POLICY "users_read_own_profile"
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Users can update their own profile
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'users_update_own_profile'
  ) THEN
    CREATE POLICY "users_update_own_profile"
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Admins can read all profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'admins_read_all_profiles'
  ) THEN
    CREATE POLICY "admins_read_all_profiles"
      ON public.profiles
      FOR ALL
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 3. Admin-only RPC to read churn data
CREATE OR REPLACE FUNCTION public.get_churn_predictions_admin()
RETURNS SETOF public.churn_predictions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.churn_predictions
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY risk_score DESC NULLS LAST
  LIMIT 200;
$$;

-- 4. Security health check function
CREATE OR REPLACE FUNCTION public.security_health_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_tables_no_rls integer;
  v_permissive_count integer;
BEGIN
  -- Count tables without RLS in public schema
  SELECT count(*) INTO v_tables_no_rls
  FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = t.tablename AND n.nspname = 'public' AND c.relrowsecurity = true
    );

  -- Count permissive policies referencing 'true' or 'anon'
  SELECT count(*) INTO v_permissive_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (qual ILIKE '%true%' OR roles::text ILIKE '%anon%');

  v_result := jsonb_build_object(
    'tables_without_rls', v_tables_no_rls,
    'permissive_policies', v_permissive_count,
    'checked_at', now()
  );

  RETURN v_result;
END;
$$;

-- 5. Add performance indexes for common admin queries
CREATE INDEX IF NOT EXISTS idx_job_queue_status_created ON public.job_queue (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_packages_status ON public.course_packages (status);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created ON public.ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_questions_curriculum ON public.exam_questions (curriculum_id, difficulty);
