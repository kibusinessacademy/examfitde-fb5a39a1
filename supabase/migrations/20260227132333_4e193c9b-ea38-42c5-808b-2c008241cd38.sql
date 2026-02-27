-- Lease-Self-Healing: claim_pending_jobs_v4
-- Auto-creates temporary leases for orphaned package-bound jobs
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_limit integer DEFAULT 5,
  p_worker_id text DEFAULT 'default',
  p_lock_timeout_minutes integer DEFAULT 10,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Stale lock recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- 2. Ghost recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = 'Ghost recovery: processing without lock'
  WHERE status = 'processing'
    AND locked_at IS NULL
    AND updated_at < now() - interval '5 minutes'
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- 3. AUTO-LEASE HEALING: Create temporary leases for orphaned package-bound jobs
  INSERT INTO public.package_leases (package_id, runner_id, acquired_at, lease_until, renewed_at)
  SELECT DISTINCT jq.package_id,
         'auto-heal-' || p_worker_id,
         now(),
         now() + interval '30 minutes',
         now()
  FROM public.job_queue jq
  WHERE jq.status = 'pending'
    AND jq.package_id IS NOT NULL
    AND (jq.run_after IS NULL OR jq.run_after <= now())
    AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
    AND NOT EXISTS (
      SELECT 1 FROM public.package_leases pl
      WHERE pl.package_id = jq.package_id
        AND pl.lease_until > now()
    )
  ON CONFLICT (package_id) DO UPDATE
    SET lease_until = GREATEST(package_leases.lease_until, now() + interval '30 minutes'),
        renewed_at = now(),
        runner_id = 'auto-heal-' || p_worker_id;

  -- 4. Claim jobs (same logic as v3, but now all orphaned packages have leases)
  RETURN QUERY
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      AND (
        jq.package_id IS NULL
        OR
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

-- Lock down permissions (service_role only)
REVOKE ALL ON FUNCTION public.claim_pending_jobs_v4 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs_v4 TO service_role;