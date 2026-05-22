
-- =========================================================================
-- P1: v_building_package_blockers SSOT
-- =========================================================================

CREATE OR REPLACE VIEW public.v_building_package_blockers AS
WITH
tail_steps AS (
  SELECT unnest(ARRAY['elite_harden','run_integrity_check','quality_council','auto_publish']) AS step_key
),
building_pkgs AS (
  SELECT id AS package_id, title, status, feature_flags, updated_at, last_progress_at, started_at
  FROM course_packages
  WHERE status = 'building'
),
step_agg AS (
  SELECT
    ps.package_id,
    COUNT(*) FILTER (WHERE ps.status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE ps.status = 'failed'
                       AND ps.step_key = 'elite_harden'
                       AND ps.last_error ILIKE '%markStepDone verify MISMATCH%') AS elite_mismatch_count,
    COUNT(*) FILTER (WHERE ps.step_key NOT IN (SELECT step_key FROM tail_steps)
                       AND ps.status NOT IN ('done','skipped')) AS non_tail_open,
    COUNT(*) FILTER (WHERE ps.step_key IN (SELECT step_key FROM tail_steps)
                       AND ps.status IN ('queued','running')) AS tail_open,
    COUNT(*) FILTER (WHERE ps.status = 'queued' AND ps.job_id IS NULL) AS queued_no_job,
    MAX(ps.last_error) FILTER (WHERE ps.status = 'failed') AS last_error_text,
    MAX(ps.updated_at) FILTER (WHERE ps.status = 'failed') AS last_failed_at
  FROM package_steps ps
  WHERE ps.package_id IN (SELECT package_id FROM building_pkgs)
  GROUP BY ps.package_id
),
job_agg AS (
  SELECT
    (j.payload->>'package_id')::uuid AS package_id,
    COUNT(*) FILTER (WHERE j.status IN ('pending','processing')) AS active_jobs,
    COUNT(*) FILTER (WHERE j.status = 'processing') AS processing_jobs
  FROM job_queue j
  WHERE (j.payload->>'package_id') IS NOT NULL
    AND (j.payload->>'package_id')::uuid IN (SELECT package_id FROM building_pkgs)
  GROUP BY (j.payload->>'package_id')::uuid
)
SELECT
  bp.package_id,
  bp.title,
  bp.status AS package_status,
  COALESCE(bp.last_progress_at, bp.updated_at, bp.started_at) AS last_activity_at,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(bp.last_progress_at, bp.updated_at, bp.started_at)))/3600.0)::numeric(10,2) AS age_hours,
  COALESCE(sa.failed_count, 0) AS failed_step_count,
  COALESCE(sa.elite_mismatch_count, 0) AS elite_mismatch_count,
  COALESCE(sa.non_tail_open, 0) AS non_tail_open_count,
  COALESCE(sa.tail_open, 0) AS tail_open_count,
  COALESCE(sa.queued_no_job, 0) AS queued_no_job_count,
  COALESCE(ja.active_jobs, 0) AS active_jobs,
  COALESCE(ja.processing_jobs, 0) AS processing_jobs,
  (bp.feature_flags->'bronze'->>'requires_review' = 'true') AS bronze_requires_review,
  (bp.feature_flags ? 'admin_force_building_at') AS admin_force_building,
  sa.last_error_text,
  sa.last_failed_at,
  CASE
    WHEN COALESCE(sa.elite_mismatch_count,0) > 0
      THEN 'ELITE_HARDEN_MISMATCH'
    WHEN (bp.feature_flags->'bronze'->>'requires_review' = 'true')
         AND COALESCE(sa.non_tail_open,0) = 0
      THEN 'BRONZE_LOCKED'
    WHEN COALESCE(sa.failed_count,0) > 0
      THEN 'HAS_FAILED_STEP'
    WHEN COALESCE(ja.processing_jobs,0) > 0
      THEN 'PROCESSING'
    WHEN COALESCE(ja.active_jobs,0) > 0
      THEN 'ACTIVE_JOBS'
    WHEN COALESCE(sa.non_tail_open,0) = 0 AND COALESCE(sa.tail_open,0) > 0
      THEN 'TAIL_ONLY_WAITING'
    WHEN COALESCE(sa.queued_no_job,0) > 0
      THEN 'QUEUED_NO_JOB'
    ELSE 'OTHER'
  END AS blocker_class,
  CASE
    WHEN COALESCE(sa.elite_mismatch_count,0) > 0 THEN 'P1'
    WHEN COALESCE(sa.failed_count,0) > 0 THEN 'P1'
    WHEN COALESCE(sa.queued_no_job,0) > 0 THEN 'P2'
    ELSE 'P2'
  END AS severity
FROM building_pkgs bp
LEFT JOIN step_agg sa ON sa.package_id = bp.package_id
LEFT JOIN job_agg  ja ON ja.package_id = bp.package_id;

REVOKE ALL ON public.v_building_package_blockers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_building_package_blockers TO service_role;

-- =========================================================================
-- P1: Admin RPC — Summary
-- =========================================================================

CREATE OR REPLACE FUNCTION public.admin_get_building_blockers_summary()
RETURNS TABLE (
  blocker_class text,
  severity text,
  package_count bigint,
  oldest_age_hours numeric,
  total_failed_steps bigint,
  total_active_jobs bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    blocker_class,
    MIN(severity) AS severity,
    COUNT(*) AS package_count,
    MAX(age_hours)::numeric(10,2) AS oldest_age_hours,
    SUM(failed_step_count) AS total_failed_steps,
    SUM(active_jobs) AS total_active_jobs
  FROM public.v_building_package_blockers
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY blocker_class
  ORDER BY package_count DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_building_blockers_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_building_blockers_summary() TO authenticated, service_role;

-- =========================================================================
-- P1: Admin RPC — Detail
-- =========================================================================

CREATE OR REPLACE FUNCTION public.admin_get_building_blockers_detail(
  p_blocker_class text DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS SETOF public.v_building_package_blockers
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.v_building_package_blockers
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
    AND (p_blocker_class IS NULL OR blocker_class = p_blocker_class)
  ORDER BY
    CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
    age_hours DESC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;

REVOKE ALL ON FUNCTION public.admin_get_building_blockers_detail(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_building_blockers_detail(text, int) TO authenticated, service_role;

-- =========================================================================
-- P3: Elite-Harden Mismatch Repair — Re-Enqueue der 4 Pakete
-- =========================================================================

WITH targets AS (
  SELECT ps.id AS step_id, ps.package_id, ps.last_error
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE cp.status = 'building'
    AND ps.step_key = 'elite_harden'
    AND ps.status = 'failed'
    AND ps.last_error ILIKE '%markStepDone verify MISMATCH%'
),
audit AS (
  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  SELECT
    'elite_harden_mismatch_reenqueue',
    'package',
    t.package_id,
    'attempted',
    jsonb_build_object(
      'step_id', t.step_id,
      'previous_error', t.last_error,
      'reason', 'P3: ghost_completion guard rolled back markStepDone(elite_harden) — re-enqueue without status demotion',
      'triggered_at', now()
    )
  FROM targets t
  RETURNING target_id
)
UPDATE package_steps ps
SET
  status = 'queued',
  attempts = 0,
  last_error = NULL,
  meta = (COALESCE(ps.meta, '{}'::jsonb) - 'ok' - 'executed') || jsonb_build_object(
    'p3_reenqueue_at', now(),
    'p3_reason', 'elite_harden_mismatch_repair'
  ),
  updated_at = now()
WHERE ps.id IN (SELECT step_id FROM targets);
