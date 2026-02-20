
-- =============================================================
-- 1) DRIFT VIEW: Only return real drift rows (alarm-feed)
-- =============================================================
DROP VIEW IF EXISTS public.ops_step_job_drift;

CREATE VIEW public.ops_step_job_drift
WITH (security_invoker = on) AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status::text        AS step_status,
  ps.job_id,
  jq.status::text        AS job_status,
  jq.error               AS job_error,
  jq.updated_at          AS job_updated_at,
  ps.updated_at          AS step_updated_at,
  CASE
    WHEN ps.job_id IS NULL
     AND ps.status::text IN ('enqueued','running')
      THEN 'MISSING_JOB'
    WHEN ps.job_id IS NOT NULL
     AND jq.status::text IN ('completed','failed','cancelled')
     AND ps.status::text IN ('enqueued','running')
      THEN 'JOB_DONE_STEP_STUCK'
  END AS drift_type
FROM public.package_steps ps
LEFT JOIN public.job_queue jq ON jq.id = ps.job_id
WHERE
  (ps.job_id IS NULL AND ps.status::text IN ('enqueued','running'))
  OR
  (ps.job_id IS NOT NULL
   AND jq.status::text IN ('completed','failed','cancelled')
   AND ps.status::text IN ('enqueued','running'));

-- =============================================================
-- 2) PERFORMANCE INDEXES
-- =============================================================
CREATE INDEX IF NOT EXISTS package_steps_status_idx
  ON public.package_steps(status);

CREATE INDEX IF NOT EXISTS package_steps_job_id_idx
  ON public.package_steps(job_id);

CREATE INDEX IF NOT EXISTS job_queue_status_idx
  ON public.job_queue(status);

CREATE INDEX IF NOT EXISTS job_queue_job_type_created_at_idx
  ON public.job_queue(job_type, created_at DESC);

CREATE INDEX IF NOT EXISTS job_queue_status_created_at_idx
  ON public.job_queue(status, created_at DESC);

CREATE INDEX IF NOT EXISTS job_queue_locked_at_idx
  ON public.job_queue(locked_at);

CREATE INDEX IF NOT EXISTS job_queue_completed_at_idx
  ON public.job_queue(completed_at);

-- =============================================================
-- 3) STEP-DURATION VIEWS
-- =============================================================

-- 3.1 Mapping: job_type → step_key
CREATE OR REPLACE VIEW public.ops_jobtype_step_map
WITH (security_invoker = on) AS
SELECT * FROM (
  VALUES
    ('package_generate_handbook',        'generate_handbook'),
    ('package_validate_handbook',        'validate_handbook'),
    ('package_generate_exam_pool',       'generate_exam_pool'),
    ('package_validate_exam_pool',       'validate_exam_pool'),
    ('package_generate_oral_exam',       'generate_oral_exam'),
    ('package_validate_oral_exam',       'validate_oral_exam'),
    ('package_generate_learning_content','generate_learning_content'),
    ('package_validate_learning_content','validate_learning_content'),
    ('package_build_ai_tutor_index',     'build_ai_tutor_index'),
    ('package_validate_tutor_index',     'validate_tutor_index'),
    ('package_auto_seed_exam_blueprints','auto_seed_exam_blueprints'),
    ('package_validate_blueprints',      'validate_blueprints'),
    ('package_scaffold_learning_course', 'scaffold_learning_course'),
    ('package_run_integrity_check',      'run_integrity_check'),
    ('package_quality_council',          'quality_council'),
    ('package_auto_publish',             'auto_publish')
) AS t(job_type, step_key);

-- 3.2 Raw events: per-job duration + queue wait
CREATE OR REPLACE VIEW public.ops_step_duration_events
WITH (security_invoker = on) AS
SELECT
  jq.id AS job_id,
  jq.job_type,
  m.step_key,
  (jq.payload->>'package_id') AS package_id,
  jq.status::text AS status,
  jq.attempts,
  jq.created_at,
  jq.locked_at,
  jq.completed_at,
  jq.updated_at,
  CASE
    WHEN jq.locked_at IS NOT NULL THEN
      greatest(0, extract(epoch FROM (jq.locked_at - jq.created_at)) * 1000)::bigint
    ELSE NULL
  END AS queue_wait_ms,
  CASE
    WHEN jq.locked_at IS NOT NULL AND jq.completed_at IS NOT NULL THEN
      greatest(0, extract(epoch FROM (jq.completed_at - jq.locked_at)) * 1000)::bigint
    ELSE NULL
  END AS run_ms,
  left(coalesce(jq.error,''), 500) AS error_snip
FROM public.job_queue jq
JOIN public.ops_jobtype_step_map m ON m.job_type = jq.job_type
WHERE jq.payload ? 'package_id';

-- 3.3 Aggregation: 7d bottleneck ranking with percentiles
CREATE OR REPLACE VIEW public.ops_step_duration_7d
WITH (security_invoker = on) AS
WITH base AS (
  SELECT *
  FROM public.ops_step_duration_events
  WHERE created_at > now() - interval '7 days'
)
SELECT
  step_key,
  job_type,
  count(*) FILTER (WHERE status = 'completed') AS completed,
  count(*) FILTER (WHERE status IN ('failed','cancelled')) AS failed_or_cancelled,
  count(*) FILTER (WHERE status = 'processing') AS processing,
  count(*) FILTER (WHERE status = 'pending') AS pending,

  percentile_cont(0.50) WITHIN GROUP (ORDER BY queue_wait_ms) FILTER (WHERE status='completed' AND queue_wait_ms IS NOT NULL) AS qwait_p50_ms,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY queue_wait_ms) FILTER (WHERE status='completed' AND queue_wait_ms IS NOT NULL) AS qwait_p90_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY queue_wait_ms) FILTER (WHERE status='completed' AND queue_wait_ms IS NOT NULL) AS qwait_p95_ms,

  percentile_cont(0.50) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_p50_ms,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_p90_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_p95_ms,

  avg(run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_avg_ms,
  max(run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_max_ms,

  avg(attempts) FILTER (WHERE status='completed') AS attempts_avg
FROM base
GROUP BY step_key, job_type
ORDER BY run_p95_ms DESC NULLS LAST;

-- 3.4 Drilldown: slowest completed jobs (7d)
CREATE OR REPLACE VIEW public.ops_step_duration_slowest_7d
WITH (security_invoker = on) AS
SELECT *
FROM public.ops_step_duration_events
WHERE created_at > now() - interval '7 days'
  AND status = 'completed'
ORDER BY run_ms DESC NULLS LAST;

NOTIFY pgrst, 'reload schema';
