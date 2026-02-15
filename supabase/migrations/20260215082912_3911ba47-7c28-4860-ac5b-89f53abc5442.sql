
-- 1) Ensure job_queue has meta column (SSOT)
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2) Replace claim_pending_jobs to respect run_after and order fairly
DROP FUNCTION IF EXISTS public.claim_pending_jobs(integer);

CREATE OR REPLACE FUNCTION public.claim_pending_jobs(p_limit integer DEFAULT 5)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'pending'
      AND (run_after IS NULL OR run_after <= now())
    ORDER BY
      priority DESC,
      run_after ASC NULLS FIRST,
      created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue jq
  SET
    status = 'processing',
    started_at = now(),
    attempts = COALESCE(jq.attempts, 0) + 1
  WHERE jq.id IN (SELECT id FROM picked)
  RETURNING jq.*;
END;
$$;
