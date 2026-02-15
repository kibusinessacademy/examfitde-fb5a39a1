
-- ══════════════════════════════════════════════════════════════
-- Atomic Job Claiming with SKIP LOCKED (prevents race conditions)
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.claim_pending_jobs(p_limit int DEFAULT 5)
RETURNS SETOF public.job_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue j
  SET status = 'processing',
      started_at = now(),
      attempts = coalesce(j.attempts, 0) + 1
  FROM candidates c
  WHERE j.id = c.id
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_jobs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs(int) TO service_role;
