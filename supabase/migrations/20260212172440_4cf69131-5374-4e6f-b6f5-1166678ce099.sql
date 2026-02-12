-- Remove the deny_all policy that may be interfering with admin access
DROP POLICY IF EXISTS "deny_all_course_packages" ON public.course_packages;
