
-- ================================================================
-- P0 Fix: Zombie Reaper v2 + False-Liveness Guard + Re-dispatch
-- ================================================================

-- 1) ZOMBIE REAPER: Hard age-based kill (ignores heartbeat refresh)
CREATE OR REPLACE FUNCTION public.reap_zombie_processing_jobs_v2(
  p_max_age_hours integer DEFAULT 24,
  p_reason text DEFAULT 'ZOMBIE_PROCESSING_TIMEOUT'
)
RETURNS TABLE (
  job_id uuid,
  package_id uuid,
  job_type text,
  age_hours numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH zombies AS (
    SELECT
      jq.id,
      jq.package_id,
      jq.job_type,
      ROUND(EXTRACT(EPOCH FROM (now() - jq.created_at)) / 3600.0, 1) AS age_h
    FROM public.job_queue jq
    WHERE jq.status = 'processing'
      AND jq.created_at < now() - make_interval(hours => p_max_age_hours)
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET
      status = 'failed',
      liveness_status = 'zombie_reaped',
      last_error = left(COALESCE(jq.last_error, '') || ' | ' || p_reason, 1000),
      last_error_code = 'ZOMBIE_REAPER_V2',
      completed_at = now(),
      updated_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
        'zombie_reaped_at', now(),
        'zombie_age_hours', z.age_h,
        'zombie_reason', p_reason
      )
    FROM zombies z
    WHERE jq.id = z.id
    RETURNING jq.id, jq.package_id, jq.job_type, z.age_h
  )
  SELECT * FROM upd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reap_zombie_processing_jobs_v2(integer, text) TO service_role;

-- 2) Also reap stale PENDING jobs that are ancient (>48h pending = abandoned)
CREATE OR REPLACE FUNCTION public.reap_ancient_pending_jobs(
  p_max_age_hours integer DEFAULT 48,
  p_reason text DEFAULT 'ANCIENT_PENDING_TIMEOUT'
)
RETURNS TABLE (
  job_id uuid,
  package_id uuid,
  job_type text,
  age_hours numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ancient AS (
    SELECT
      jq.id,
      jq.package_id,
      jq.job_type,
      ROUND(EXTRACT(EPOCH FROM (now() - jq.created_at)) / 3600.0, 1) AS age_h
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.created_at < now() - make_interval(hours => p_max_age_hours)
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET
      status = 'cancelled',
      liveness_status = 'ancient_reaped',
      last_error = left(COALESCE(jq.last_error, '') || ' | ' || p_reason, 1000),
      last_error_code = 'ANCIENT_PENDING_REAPER',
      completed_at = now(),
      updated_at = now(),
      meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
        'ancient_reaped_at', now(),
        'ancient_age_hours', a.age_h
      )
    FROM ancient a
    WHERE jq.id = a.id
    RETURNING jq.id, jq.package_id, jq.job_type, a.age_h
  )
  SELECT * FROM upd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reap_ancient_pending_jobs(integer, text) TO service_role;

-- 3) FALSE-LIVENESS TRUTH VIEW
CREATE OR REPLACE VIEW public.ops_build_activity_truth AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.build_progress,
  cp.track,
  -- Active jobs (fresh, not zombie)
  (SELECT COUNT(*) FROM job_queue jq
   WHERE jq.package_id = cp.id
     AND jq.status IN ('processing','pending')
     AND jq.created_at > now() - interval '24 hours'
  ) AS fresh_active_jobs,
  -- Zombie jobs (processing but old)
  (SELECT COUNT(*) FROM job_queue jq
   WHERE jq.package_id = cp.id
     AND jq.status = 'processing'
     AND jq.created_at < now() - interval '24 hours'
  ) AS zombie_jobs,
  -- Running steps
  (SELECT COUNT(*) FROM package_steps ps
   WHERE ps.package_id = cp.id AND ps.status = 'running'
  ) AS running_steps,
  -- Has active lease
  EXISTS (SELECT 1 FROM package_leases pl
          WHERE pl.package_id = cp.id AND pl.lease_until > now()
  ) AS has_lease,
  -- Last real pipeline event
  (SELECT MAX(cpe.created_at) FROM course_pipeline_events cpe
   WHERE cpe.package_id = cp.id
  ) AS last_pipeline_event_at,
  -- Last step transition
  (SELECT MAX(ps.updated_at) FROM package_steps ps
   WHERE ps.package_id = cp.id
  ) AS last_step_transition_at,
  -- Verdict: is this package truly alive?
  CASE
    WHEN EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.status IN ('processing','pending')
        AND jq.created_at > now() - interval '24 hours'
    ) THEN 'alive'
    WHEN EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = cp.id AND ps.status = 'running'
    ) THEN 'alive'
    WHEN EXISTS (
      SELECT 1 FROM course_pipeline_events cpe
      WHERE cpe.package_id = cp.id
        AND cpe.created_at > now() - interval '2 hours'
    ) THEN 'alive'
    ELSE 'false_active'
  END AS liveness_verdict
FROM course_packages cp
WHERE cp.status = 'building';
