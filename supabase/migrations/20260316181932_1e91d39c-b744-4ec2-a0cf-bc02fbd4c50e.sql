
-- Drop G1 view first to allow column rename, then recreate
DROP VIEW IF EXISTS public.v_ops_package_progress_guard;

CREATE VIEW public.v_ops_package_progress_guard AS
WITH building_pkgs AS (
  SELECT cp.id AS package_id, cp.title, cp.priority, cp.status
  FROM course_packages cp
  WHERE cp.status = 'building'
),
active_jobs AS (
  SELECT
    jq.package_id,
    COUNT(*) FILTER (WHERE jq.status IN ('pending','processing')) AS active_job_count,
    COUNT(*) FILTER (WHERE jq.status = 'completed' AND jq.completed_at > now() - interval '30 minutes') AS completed_30m,
    COUNT(*) FILTER (WHERE jq.status = 'completed' AND jq.completed_at > now() - interval '60 minutes') AS completed_60m,
    COUNT(*) FILTER (WHERE jq.status = 'failed' AND jq.completed_at > now() - interval '60 minutes') AS failed_60m,
    MAX(jq.completed_at) FILTER (WHERE jq.status = 'completed') AS last_completion_at
  FROM job_queue jq
  WHERE jq.package_id IS NOT NULL
  GROUP BY jq.package_id
),
active_leases AS (
  SELECT package_id, COUNT(*) AS lease_count
  FROM package_leases WHERE lease_until > now()
  GROUP BY package_id
),
step_progress AS (
  SELECT
    ps.package_id,
    COUNT(*) FILTER (WHERE ps.status = 'done') AS done_steps,
    COUNT(*) FILTER (WHERE ps.status IN ('queued','enqueued','running')) AS active_steps,
    MAX(ps.updated_at) FILTER (WHERE ps.status = 'done') AS last_step_done_at
  FROM package_steps ps
  GROUP BY ps.package_id
)
SELECT
  bp.package_id, bp.title, bp.priority,
  COALESCE(aj.active_job_count, 0) AS active_jobs,
  COALESCE(al.lease_count, 0) AS active_leases,
  COALESCE(aj.completed_30m, 0) AS completed_jobs_30m,
  COALESCE(aj.completed_60m, 0) AS completed_jobs_60m,
  COALESCE(aj.failed_60m, 0) AS failed_jobs_60m,
  aj.last_completion_at,
  COALESCE(sp.done_steps, 0) AS done_steps,
  COALESCE(sp.active_steps, 0) AS active_steps,
  sp.last_step_done_at,
  EXTRACT(EPOCH FROM (now() - GREATEST(
    COALESCE(aj.last_completion_at, '2000-01-01'::timestamptz),
    COALESCE(sp.last_step_done_at, '2000-01-01'::timestamptz)
  ))) / 60 AS minutes_since_real_progress,
  CASE
    WHEN COALESCE(aj.active_job_count, 0) > 0
      AND COALESCE(aj.completed_30m, 0) = 0
      AND COALESCE(aj.completed_60m, 0) = 0
      AND EXTRACT(EPOCH FROM (now() - GREATEST(
        COALESCE(aj.last_completion_at, '2000-01-01'::timestamptz),
        COALESCE(sp.last_step_done_at, '2000-01-01'::timestamptz)
      ))) / 60 > 30
    THEN 'SHADOW_STALLED'
    WHEN COALESCE(aj.active_job_count, 0) > 0
      AND COALESCE(aj.completed_30m, 0) = 0
      AND COALESCE(aj.completed_60m, 0) > 0
    THEN 'SLOWING'
    WHEN COALESCE(aj.active_job_count, 0) = 0
      AND COALESCE(al.lease_count, 0) > 0
    THEN 'IDLE_WITH_LEASE'
    WHEN COALESCE(aj.active_job_count, 0) > 0
      AND COALESCE(aj.completed_30m, 0) > 0
    THEN 'HEALTHY'
    ELSE 'UNKNOWN'
  END AS progress_state,
  now() AS checked_at
FROM building_pkgs bp
LEFT JOIN active_jobs aj ON aj.package_id = bp.package_id
LEFT JOIN active_leases al ON al.package_id = bp.package_id
LEFT JOIN step_progress sp ON sp.package_id = bp.package_id;

-- ═══════════════════════════════════════════════════════════
-- HARDENED G2: v_ops_batch_submit_health (unchanged structure, safe to replace)
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_ops_batch_submit_health AS
WITH windows AS (
  SELECT
    provider, model, job_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
    COUNT(*) FILTER (WHERE status NOT IN ('failed','cancelled')) AS ok,
    MIN(error_summary::text) FILTER (WHERE status = 'failed') AS sample_error,
    MIN(created_at) AS window_start,
    MAX(created_at) AS window_end
  FROM llm_batches
  WHERE created_at > now() - interval '30 minutes'
  GROUP BY provider, model, job_type
)
SELECT
  provider, model, job_type, total, failed, ok,
  CASE WHEN total > 0 THEN ROUND((failed::numeric / total) * 100, 1) ELSE 0 END AS failure_pct,
  CASE
    WHEN total < 5 THEN 'LOW_VOLUME'
    WHEN total > 0 AND (failed::numeric / total) > 0.8 THEN 'CRITICAL'
    WHEN total > 0 AND (failed::numeric / total) > 0.5 THEN 'DEGRADED'
    WHEN total > 0 AND (failed::numeric / total) > 0.3 THEN 'WARNING'
    ELSE 'HEALTHY'
  END AS submit_health,
  sample_error, window_start, window_end,
  now() AS checked_at
FROM windows
WHERE total >= 3;

-- ═══════════════════════════════════════════════════════════
-- HARDENED G4: v_ops_shadow_zombies — CASE order fixed
-- ═══════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.v_ops_shadow_zombies;

CREATE VIEW public.v_ops_shadow_zombies AS
WITH pkg_jobs AS (
  SELECT
    package_id,
    COUNT(*) FILTER (WHERE status IN ('pending','processing')) AS active_jobs,
    COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '60 minutes') AS completed_1h,
    COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > now() - interval '60 minutes') AS failed_1h,
    COALESCE(SUM(attempts) FILTER (WHERE status IN ('pending','processing')), 0) AS total_attempts
  FROM job_queue
  WHERE package_id IS NOT NULL
  GROUP BY package_id
),
pkg_batches AS (
  SELECT
    jq.package_id,
    COUNT(*) FILTER (WHERE lb.status = 'failed') AS batch_fails_1h,
    COUNT(*) FILTER (WHERE lb.status NOT IN ('failed','cancelled')) AS batch_ok_1h
  FROM job_queue jq
  JOIN llm_batch_requests lbr ON lbr.source_job_id = jq.id
  JOIN llm_batches lb ON lb.id = lbr.batch_id
  WHERE lb.created_at > now() - interval '1 hour'
    AND jq.package_id IS NOT NULL
  GROUP BY jq.package_id
),
pkg_leases AS (
  SELECT package_id, COUNT(*) AS lease_count
  FROM package_leases WHERE lease_until > now()
  GROUP BY package_id
)
SELECT
  cp.id AS package_id, cp.title, cp.priority, cp.status,
  COALESCE(pj.active_jobs, 0) AS active_jobs,
  COALESCE(pl.lease_count, 0) AS active_leases,
  COALESCE(pj.completed_1h, 0) AS completed_jobs_1h,
  COALESCE(pj.failed_1h, 0) AS failed_jobs_1h,
  COALESCE(pj.total_attempts, 0) AS total_retry_attempts,
  COALESCE(pb.batch_fails_1h, 0) AS batch_submit_fails_1h,
  COALESCE(pb.batch_ok_1h, 0) AS batch_submit_ok_1h,
  CASE
    WHEN COALESCE(pj.active_jobs, 0) > 0
      AND COALESCE(pj.completed_1h, 0) > 0
      AND COALESCE(pj.failed_1h, 0) > COALESCE(pj.completed_1h, 0)
    THEN 'RETRYING'
    WHEN COALESCE(pj.active_jobs, 0) > 0
      AND COALESCE(pj.completed_1h, 0) > 0
    THEN 'HEALTHY_ACTIVE'
    WHEN COALESCE(pj.active_jobs, 0) > 0
      AND COALESCE(pj.completed_1h, 0) = 0
      AND COALESCE(pb.batch_ok_1h, 0) = 0
      AND COALESCE(pb.batch_fails_1h, 0) > 0
    THEN 'SHADOW_ZOMBIE'
    WHEN COALESCE(pj.active_jobs, 0) > 0
      AND COALESCE(pj.completed_1h, 0) = 0
      AND COALESCE(pj.total_attempts, 0) > 20
    THEN 'POISONED_LOOP'
    WHEN COALESCE(pj.active_jobs, 0) = 0
      AND cp.status = 'building'
    THEN 'HARD_STALLED'
    ELSE 'UNKNOWN'
  END AS zombie_class,
  now() AS checked_at
FROM course_packages cp
LEFT JOIN pkg_jobs pj ON pj.package_id = cp.id
LEFT JOIN pkg_batches pb ON pb.package_id = cp.id
LEFT JOIN pkg_leases pl ON pl.package_id = cp.id
WHERE cp.status IN ('building', 'queued')
  AND (COALESCE(pj.active_jobs, 0) > 0 OR cp.status = 'building');
