
CREATE OR REPLACE VIEW public.v_admin_intake_console AS
SELECT
  c.id,
  c.source_key,
  c.category,
  c.canonical_title,
  c.title_raw,
  c.provider_name,
  c.url,
  c.intake_status,
  c.rejection_reason,
  c.discovered_at,
  c.last_seen_at,
  (SELECT j.last_error FROM public.curriculum_intake_jobs j
    WHERE j.candidate_id = c.id AND j.last_error IS NOT NULL
    ORDER BY j.updated_at DESC NULLS LAST LIMIT 1) AS last_error,
  (SELECT j.status FROM public.curriculum_intake_jobs j
    WHERE j.candidate_id = c.id
    ORDER BY j.updated_at DESC NULLS LAST LIMIT 1) AS last_job_status,
  (SELECT j.job_type FROM public.curriculum_intake_jobs j
    WHERE j.candidate_id = c.id
    ORDER BY j.updated_at DESC NULLS LAST LIMIT 1) AS last_job_type,
  (SELECT j.updated_at FROM public.curriculum_intake_jobs j
    WHERE j.candidate_id = c.id
    ORDER BY j.updated_at DESC NULLS LAST LIMIT 1) AS last_job_at,
  (SELECT COUNT(*) FROM public.curriculum_intake_jobs j
    WHERE j.candidate_id = c.id AND j.status = 'failed') AS failed_jobs,
  EXTRACT(EPOCH FROM (now() - c.last_seen_at))/60 AS minutes_since_last_seen
FROM public.curriculum_intake_candidates c;

GRANT SELECT ON public.v_admin_intake_console TO authenticated;
GRANT SELECT ON public.v_admin_intake_console TO service_role;

CREATE OR REPLACE VIEW public.v_admin_fanout_progress AS
SELECT
  ps.id AS step_id,
  ps.package_id,
  ps.step_key,
  ps.status::text AS step_status,
  ps.job_id,
  ps.started_at,
  ps.last_heartbeat_at,
  ps.last_error,
  ps.attempts,
  ps.max_attempts,
  COALESCE(child.total, 0) AS children_total,
  COALESCE(child.done, 0) AS children_done,
  COALESCE(child.failed, 0) AS children_failed,
  COALESCE(child.running, 0) AS children_running,
  COALESCE(child.queued, 0) AS children_queued,
  CASE WHEN COALESCE(child.total, 0) > 0
       THEN ROUND((COALESCE(child.done, 0)::numeric / child.total::numeric) * 100, 1)
       ELSE NULL END AS progress_pct,
  CASE WHEN COALESCE(child.done, 0) > 0 AND ps.started_at IS NOT NULL
       THEN (EXTRACT(EPOCH FROM (now() - ps.started_at))
             / GREATEST(child.done, 1)
             * GREATEST(child.total - child.done, 0))::int
       ELSE NULL END AS eta_seconds,
  EXTRACT(EPOCH FROM (now() - COALESCE(ps.last_heartbeat_at, ps.started_at)))/60 AS stale_minutes
FROM public.package_steps ps
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'completed') AS done,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
    COUNT(*) FILTER (WHERE status = 'running') AS running,
    COUNT(*) FILTER (WHERE status IN ('queued','pending','retry')) AS queued
  FROM public.job_queue jq
  WHERE jq.parent_job_id = ps.job_id
) child ON TRUE
WHERE ps.status IN ('running','queued','enqueued','pending_enqueue')
   OR ps.last_heartbeat_at > now() - interval '2 hours';

GRANT SELECT ON public.v_admin_fanout_progress TO authenticated;
GRANT SELECT ON public.v_admin_fanout_progress TO service_role;

CREATE OR REPLACE VIEW public.v_admin_pool_health AS
WITH base AS (
  SELECT
    COALESCE(worker_pool, 'default') AS pool,
    status, created_at, started_at, completed_at
  FROM public.job_queue
  WHERE created_at > now() - interval '24 hours'
     OR status IN ('queued','pending','running','retry','enqueued')
)
SELECT
  pool,
  COUNT(*) FILTER (WHERE status IN ('queued','pending','retry','enqueued')) AS queued,
  COUNT(*) FILTER (WHERE status = 'running') AS processing,
  COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '1 hour') AS throughput_1h,
  COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > now() - interval '1 hour') AS failed_1h,
  COALESCE((
    SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))/60
    FROM public.job_queue jq2
    WHERE COALESCE(jq2.worker_pool, 'default') = base.pool
      AND jq2.status IN ('queued','pending','retry','enqueued')
  ), 0)::int AS oldest_queued_min,
  CASE
    WHEN COUNT(*) FILTER (WHERE status IN ('queued','pending','retry','enqueued')) > 0
     AND COUNT(*) FILTER (WHERE status = 'running') = 0
     AND COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '15 minutes') = 0
    THEN true ELSE false
  END AS starvation
FROM base
GROUP BY pool
ORDER BY pool;

GRANT SELECT ON public.v_admin_pool_health TO authenticated;
GRANT SELECT ON public.v_admin_pool_health TO service_role;
