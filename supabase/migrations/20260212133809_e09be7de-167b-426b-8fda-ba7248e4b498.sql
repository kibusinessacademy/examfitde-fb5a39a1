
-- Explicitly revoke grants as defense-in-depth (idempotent)
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.churn_predictions FROM anon;
REVOKE ALL ON public.churn_predictions FROM authenticated;

-- Re-grant minimal access for profiles (RLS enforces row-level)
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
