
-- G1: v_ops_package_progress_guard
CREATE OR REPLACE VIEW public.v_ops_package_progress_guard AS
WITH building_pkgs AS (
  SELECT cp.id AS package_id, cp.title, cp.priority,
    cp.updated_at AS pkg_updated_at
  FROM course_packages cp WHERE cp.status = 'building'
),
active_jobs AS (
  SELECT jq.package_id,
    COUNT(*) FILTER (WHERE jq.status IN ('pending','processing')) AS active_job_count,
    COUNT(*) FILTER (WHERE jq.status = 'completed' AND jq.completed_at > now() - interval '30 minutes') AS completed_30m,
    COUNT(*) FILTER (WHERE jq.status = 'completed' AND jq.completed_at > now() - interval '60 minutes') AS completed_60m,
    COUNT(*) FILTER (WHERE jq.status = 'failed' AND jq.completed_at > now() - interval '60 minutes') AS failed_60m,
    MAX(jq.completed_at) FILTER (WHERE jq.status = 'completed') AS last_completion_at
  FROM job_queue jq WHERE jq.package_id IS NOT NULL GROUP BY jq.package_id
),
active_leases AS (
  SELECT package_id, COUNT(*) AS lease_count
  FROM package_leases WHERE lease_until > now() GROUP BY package_id
),
step_progress AS (
  SELECT ps.package_id,
    COUNT(*) FILTER (WHERE ps.status = 'done') AS done_steps,
    COUNT(*) FILTER (WHERE ps.status IN ('queued','enqueued','running')) AS active_steps,
    MAX(ps.updated_at) FILTER (WHERE ps.status = 'done') AS last_step_done_at
  FROM package_steps ps GROUP BY ps.package_id
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
    COALESCE(sp.last_step_done_at, '2000-01-01'::timestamptz),
    bp.pkg_updated_at
  ))) / 60 AS minutes_since_progress,
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

-- G2: v_ops_batch_submit_health
CREATE OR REPLACE VIEW public.v_ops_batch_submit_health AS
WITH windows AS (
  SELECT provider, model, job_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
    COUNT(*) FILTER (WHERE status NOT IN ('failed','cancelled')) AS ok,
    MIN(error_summary::text) FILTER (WHERE status = 'failed') AS sample_error,
    MIN(created_at) AS window_start, MAX(created_at) AS window_end
  FROM llm_batches
  WHERE created_at > now() - interval '30 minutes'
  GROUP BY provider, model, job_type
)
SELECT provider, model, job_type, total, failed, ok,
  CASE WHEN total > 0 THEN ROUND((failed::numeric / total) * 100, 1) ELSE 0 END AS failure_pct,
  CASE
    WHEN total < 5 THEN 'LOW_VOLUME'
    WHEN total > 0 AND (failed::numeric / total) > 0.8 THEN 'CRITICAL'
    WHEN total > 0 AND (failed::numeric / total) > 0.5 THEN 'DEGRADED'
    WHEN total > 0 AND (failed::numeric / total) > 0.3 THEN 'WARNING'
    ELSE 'HEALTHY'
  END AS submit_health,
  sample_error, window_start, window_end, now() AS checked_at
FROM windows WHERE total >= 3;
