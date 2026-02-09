
-- ============================================
-- FIX 1: profiles – prevent email harvesting
-- ============================================

-- Drop existing overly-permissive policies
DROP POLICY IF EXISTS "Users can view own profile or admins all" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- User can read ONLY own profile
CREATE POLICY "profiles_select_own"
ON public.profiles FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- User can insert own profile
CREATE POLICY "profiles_insert_own"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- User can update ONLY own profile
CREATE POLICY "profiles_update_own"
ON public.profiles FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Admin can read all profiles (separate policy)
CREATE POLICY "profiles_admin_select_all"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can update all profiles
CREATE POLICY "profiles_admin_update_all"
ON public.profiles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- FIX 2: ai_tutor_logs – strict RLS
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own tutor logs" ON public.ai_tutor_logs;
DROP POLICY IF EXISTS "Users can insert their own tutor logs" ON public.ai_tutor_logs;
DROP POLICY IF EXISTS "Admins can view all tutor logs" ON public.ai_tutor_logs;

-- Users read ONLY own logs
CREATE POLICY "ai_tutor_logs_select_own"
ON public.ai_tutor_logs FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- No direct client inserts (Edge Function uses service role)
CREATE POLICY "ai_tutor_logs_no_client_insert"
ON public.ai_tutor_logs FOR INSERT TO authenticated
WITH CHECK (false);

-- Admin select (separate)
CREATE POLICY "ai_tutor_logs_admin_select"
ON public.ai_tutor_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Metadata minimization comment
COMMENT ON COLUMN public.ai_tutor_logs.metadata IS 'Must NOT contain raw user text. Telemetry only.';
