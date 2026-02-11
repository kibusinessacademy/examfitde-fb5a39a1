-- Council 5: tutor_assets RLS FIX (block non-admin access)

-- Remove unsafe policy
DROP POLICY IF EXISTS "Admin full access tutor_assets" ON public.tutor_assets;

-- Deny all by default
DROP POLICY IF EXISTS "deny_all_tutor_assets" ON public.tutor_assets;
CREATE POLICY "deny_all_tutor_assets"
ON public.tutor_assets
FOR ALL
USING (false);

-- Admin-only access
DROP POLICY IF EXISTS "admin_all_tutor_assets" ON public.tutor_assets;
CREATE POLICY "admin_all_tutor_assets"
ON public.tutor_assets
FOR ALL
USING (is_admin_user(auth.uid()));