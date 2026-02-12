
-- Remove duplicate/redundant policies on profiles
DROP POLICY IF EXISTS "users_read_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "admin_churn_predictions" ON public.churn_predictions;
