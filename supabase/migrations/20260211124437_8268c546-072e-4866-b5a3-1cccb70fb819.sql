
-- ============================================================
-- 1. DROP initial_password_hash from profiles (no data exists)
-- ============================================================
ALTER TABLE public.profiles DROP COLUMN IF EXISTS initial_password_hash;

-- ============================================================
-- 2. Explicit DENY for anon on profiles
-- ============================================================
CREATE POLICY "deny_anon_profiles"
ON public.profiles
FOR ALL
TO anon
USING (false);

-- ============================================================
-- 3. Fix companies RLS: change roles from PUBLIC to authenticated
--    and add explicit anon deny
-- ============================================================
DROP POLICY IF EXISTS "Company admins can view their company" ON public.companies;
DROP POLICY IF EXISTS "Company admins can update their company" ON public.companies;

CREATE POLICY "company_admin_select"
ON public.companies
FOR SELECT
TO authenticated
USING (admin_user_id = auth.uid());

CREATE POLICY "company_admin_update"
ON public.companies
FOR UPDATE
TO authenticated
USING (admin_user_id = auth.uid())
WITH CHECK (admin_user_id = auth.uid());

CREATE POLICY "company_admin_full_access"
ON public.companies
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "deny_anon_companies"
ON public.companies
FOR ALL
TO anon
USING (false);

-- ============================================================
-- 4. Create get_my_profile RPC (returns only safe fields)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  full_name text,
  avatar_url text,
  login_username text,
  company_id uuid,
  managed_account boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.user_id, p.full_name, p.avatar_url,
    p.login_username, p.company_id, p.managed_account,
    p.created_at, p.updated_at
  FROM public.profiles p
  WHERE p.user_id = auth.uid();
$$;
