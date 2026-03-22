-- Grant SELECT on admin SSOT views to authenticated role
-- These views are read-only and underlying tables have RLS.
-- Admin access is enforced at the application level via user_roles.

GRANT SELECT ON public.v_admin_packages_ssot TO authenticated;
GRANT SELECT ON public.v_admin_queue_ssot TO authenticated;