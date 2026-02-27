-- Patch 1: Fix claim_pending_jobs_v3 — allow package_id=NULL jobs (e.g. mass_enrich_competencies_v2)
-- Patch 2: Security hardening — REVOKE PUBLIC, GRANT service_role only

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v3(
  p_limit integer,
  p_worker_id text DEFAULT 'legacy_v1',
  p_lock_timeout_minutes integer DEFAULT 10,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Stale lock recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- Ghost recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = 'Ghost recovery: processing without lock'
  WHERE status = 'processing'
    AND locked_at IS NULL
    AND updated_at < now() - interval '5 minutes'
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- Claim with CONDITIONAL lease guard:
  -- Jobs WITH package_id require an active package_lease.
  -- Jobs WITHOUT package_id (global jobs like mass_enrich) are always eligible.
  RETURN QUERY
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      AND (
        -- Global jobs (no package_id) → always claimable
        jq.package_id IS NULL
        OR
        -- Package jobs → require active lease
        EXISTS (
          SELECT 1 FROM public.package_leases pl
          WHERE pl.package_id = jq.package_id
            AND pl.lease_until > now()
        )
      )
    ORDER BY jq.priority DESC, jq.run_after ASC NULLS FIRST, jq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue jq
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = now(),
      updated_at = now()
  WHERE jq.id IN (SELECT id FROM picked)
  RETURNING jq.*;
END;
$$;

-- Security hardening: only service_role can claim jobs
REVOKE ALL ON FUNCTION public.claim_pending_jobs_v3(integer, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_jobs_v3(integer, text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_pending_jobs_v3(integer, text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs_v3(integer, text, integer, text) TO service_role;