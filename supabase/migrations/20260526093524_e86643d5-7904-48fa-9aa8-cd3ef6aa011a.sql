-- 1) Anon-SELECT-Policy für eigene anonyme Quiz-Attempts (PostgREST braucht SELECT
--    nach INSERT ... RETURNING; ohne Policy gibt es 42501 "violates row-level security").
DROP POLICY IF EXISTS quiz_attempts_anon_select_own ON public.quiz_attempts;
CREATE POLICY quiz_attempts_anon_select_own
ON public.quiz_attempts
FOR SELECT
TO anon
USING (
  auth.uid() IS NULL
  AND user_id IS NULL
  AND anonymous_id IS NOT NULL
);

-- 2) Legacy-Überladung droppen → eindeutige Signatur mit p_lane Default NULL.
DROP FUNCTION IF EXISTS public.admin_reap_stale_processing_now(integer, integer);