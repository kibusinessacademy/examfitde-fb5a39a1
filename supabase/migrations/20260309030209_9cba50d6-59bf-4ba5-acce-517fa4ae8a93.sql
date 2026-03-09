
-- 1. Queue Latency View
CREATE OR REPLACE VIEW public.v_pipeline_queue_latency AS
SELECT
  job_type,
  count(*) AS pending_jobs,
  round(avg(extract(epoch from (now() - created_at)))::numeric, 1) AS avg_wait_seconds,
  round(max(extract(epoch from (now() - created_at)))::numeric, 1) AS max_wait_seconds,
  round(
    percentile_cont(0.5) within group (order by extract(epoch from (now() - created_at)))::numeric, 1
  ) AS p50_wait_seconds,
  round(
    percentile_cont(0.9) within group (order by extract(epoch from (now() - created_at)))::numeric, 1
  ) AS p90_wait_seconds
FROM job_queue
WHERE status = 'pending'
GROUP BY job_type;

-- 2. Stuck Processing Jobs View
CREATE OR REPLACE VIEW public.v_pipeline_stuck_processing AS
SELECT
  job_type,
  count(*) AS stuck_jobs,
  round(avg(extract(epoch from (now() - updated_at)))::numeric, 1) AS avg_stale_seconds,
  round(max(extract(epoch from (now() - updated_at)))::numeric, 1) AS max_stale_seconds
FROM job_queue
WHERE status = 'processing'
  AND updated_at < now() - interval '10 minutes'
GROUP BY job_type;

-- 3. Real vs Hollow Content View
CREATE OR REPLACE VIEW public.v_pipeline_content_integrity AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.priority,
  cp.status,
  count(l.id) AS total_lessons,
  count(l.id) FILTER (
    WHERE length(coalesce(l.content::text, '')) > 600
      AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
  ) AS real_lessons,
  count(l.id) FILTER (
    WHERE l.content IS NULL
       OR length(coalesce(l.content::text, '')) <= 600
       OR (l.content->>'_placeholder')::text = 'true'
  ) AS hollow_lessons,
  round(
    100.0 * count(l.id) FILTER (
      WHERE length(coalesce(l.content::text, '')) > 600
        AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
    ) / nullif(count(l.id), 0),
    1
  ) AS real_pct
FROM course_packages cp
JOIN courses c ON c.id = cp.course_id
JOIN modules m ON m.course_id = c.id
JOIN lessons l ON l.module_id = m.id
WHERE cp.status IN ('building', 'quality_gate_failed', 'ready')
GROUP BY cp.id, cp.title, cp.priority, cp.status;

-- 5. Error Class Mix View (last 6h)
CREATE OR REPLACE VIEW public.v_pipeline_error_class AS
SELECT
  job_type,
  CASE
    WHEN last_error ILIKE '%503%' THEN 'provider_503'
    WHEN last_error ILIKE '%429%' THEN 'provider_429'
    WHEN last_error ILIKE '%timeout%' THEN 'timeout'
    WHEN last_error ILIKE '%No parseable tool response%' THEN 'tool_parse'
    WHEN last_error ILIKE '%All providers failed%' THEN 'provider_rotation'
    WHEN last_error ILIKE '%permission denied%' THEN 'permission'
    WHEN last_error ILIKE '%column%' THEN 'schema'
    WHEN last_error ILIKE '%relation%' THEN 'schema'
    WHEN last_error ILIKE '%invalid input syntax%' THEN 'data_shape'
    ELSE 'other'
  END AS error_class,
  count(*) AS failed_cnt
FROM job_queue
WHERE status = 'failed'
  AND updated_at > now() - interval '6 hours'
GROUP BY job_type, error_class;
