
-- Drop dependent views first (order matters)
DROP VIEW IF EXISTS public.ops_step_duration_slowest_7d;
DROP VIEW IF EXISTS public.ops_step_duration_7d;
DROP VIEW IF EXISTS public.ops_step_duration_events;
DROP VIEW IF EXISTS public.ops_jobtype_step_map;

-- 1.1 Mapping
CREATE VIEW public.ops_jobtype_step_map
WITH (security_invoker = on) AS
SELECT * FROM (VALUES
  ('package_generate_handbook','generate_handbook'),
  ('package_validate_handbook','validate_handbook'),
  ('package_generate_exam_pool','generate_exam_pool'),
  ('package_validate_exam_pool','validate_exam_pool'),
  ('package_generate_oral_exam','generate_oral_exam'),
  ('package_validate_oral_exam','validate_oral_exam'),
  ('package_generate_learning_content','generate_learning_content'),
  ('package_validate_learning_content','validate_learning_content'),
  ('package_build_ai_tutor_index','build_ai_tutor_index'),
  ('package_validate_tutor_index','validate_tutor_index'),
  ('package_auto_seed_exam_blueprints','auto_seed_exam_blueprints'),
  ('package_validate_blueprints','validate_blueprints'),
  ('package_scaffold_learning_course','scaffold_learning_course'),
  ('package_run_integrity_check','run_integrity_check'),
  ('package_quality_council','quality_council'),
  ('package_auto_publish','auto_publish')
) AS t(job_type, step_key);

-- 1.2 Events with robust started_at/locked_at fallback
CREATE VIEW public.ops_step_duration_events
WITH (security_invoker = on) AS
SELECT
  jq.id AS job_id,
  (jq.payload->>'package_id') AS package_id,
  m.step_key,
  jq.job_type,
  jq.status::text AS status,
  jq.attempts,
  jq.created_at,
  jq.started_at,
  jq.locked_at,
  jq.completed_at,
  jq.updated_at,
  COALESCE(jq.started_at, jq.locked_at) AS start_ts,
  CASE
    WHEN COALESCE(jq.started_at, jq.locked_at) IS NOT NULL THEN
      GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(jq.started_at, jq.locked_at) - jq.created_at)) * 1000)::bigint
    ELSE NULL
  END AS queue_wait_ms,
  CASE
    WHEN COALESCE(jq.started_at, jq.locked_at) IS NOT NULL AND jq.completed_at IS NOT NULL THEN
      GREATEST(0, EXTRACT(EPOCH FROM (jq.completed_at - COALESCE(jq.started_at, jq.locked_at))) * 1000)::bigint
    WHEN jq.status::text = 'processing' AND COALESCE(jq.started_at, jq.locked_at) IS NOT NULL THEN
      GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(jq.started_at, jq.locked_at))) * 1000)::bigint
    ELSE NULL
  END AS run_ms,
  LEFT(COALESCE(jq.error,''), 500) AS error_snip
FROM public.job_queue jq
JOIN public.ops_jobtype_step_map m ON m.job_type = jq.job_type
WHERE jq.payload ? 'package_id';

-- 1.3 7d aggregation
CREATE VIEW public.ops_step_duration_7d
WITH (security_invoker = on) AS
WITH base AS (
  SELECT * FROM public.ops_step_duration_events
  WHERE created_at > now() - interval '7 days'
)
SELECT
  step_key, job_type,
  COUNT(*) FILTER (WHERE status='completed') AS completed,
  COUNT(*) FILTER (WHERE status IN ('failed','cancelled')) AS failed_or_cancelled,
  COUNT(*) FILTER (WHERE status='processing') AS processing,
  COUNT(*) FILTER (WHERE status='pending') AS pending,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY queue_wait_ms) FILTER (WHERE status='completed' AND queue_wait_ms IS NOT NULL) AS qwait_p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY queue_wait_ms) FILTER (WHERE status='completed' AND queue_wait_ms IS NOT NULL) AS qwait_p95_ms,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_p95_ms,
  AVG(run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_avg_ms,
  MAX(run_ms) FILTER (WHERE status='completed' AND run_ms IS NOT NULL) AS run_max_ms,
  AVG(attempts) FILTER (WHERE status='completed') AS attempts_avg
FROM base
GROUP BY step_key, job_type
ORDER BY run_p95_ms DESC NULLS LAST;

-- 1.4 Drilldown
CREATE VIEW public.ops_step_duration_slowest_7d
WITH (security_invoker = on) AS
SELECT * FROM public.ops_step_duration_events
WHERE created_at > now() - interval '7 days'
  AND status = 'completed'
ORDER BY run_ms DESC NULLS LAST;

-- 2) Indexes
CREATE INDEX IF NOT EXISTS job_queue_job_type_created_at_idx ON public.job_queue(job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS job_queue_status_created_at_idx ON public.job_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS job_queue_started_at_idx ON public.job_queue(started_at);
CREATE INDEX IF NOT EXISTS job_queue_completed_at_idx ON public.job_queue(completed_at);
CREATE INDEX IF NOT EXISTS job_queue_payload_package_id_idx ON public.job_queue ((payload->>'package_id'));

NOTIFY pgrst, 'reload schema';
