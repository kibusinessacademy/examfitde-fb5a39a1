
CREATE OR REPLACE VIEW public.v_ops_resilience_dashboard AS
WITH stale_recoveries AS (
  SELECT
    job_type,
    status,
    (meta->>'stale_lock_recoveries')::int AS recovery_count,
    updated_at::date AS day,
    count(*) AS cnt
  FROM job_queue
  WHERE meta->>'stale_lock_recoveries' IS NOT NULL
    AND (meta->>'stale_lock_recoveries')::int > 0
  GROUP BY 1, 2, 3, 4
),
reaped_jobs AS (
  SELECT
    job_type,
    updated_at::date AS day,
    count(*) AS cnt
  FROM job_queue
  WHERE last_error LIKE '%REAPED_NON_BUILDING%'
  GROUP BY 1, 2
),
fanout_share AS (
  SELECT
    CASE WHEN job_type = 'package_generate_blueprint_variants'
         THEN 'blueprint_variants' ELSE 'other' END AS category,
    status,
    count(*) AS cnt
  FROM job_queue
  WHERE status IN ('pending', 'processing')
  GROUP BY 1, 2
)
SELECT 'stale_recovery' AS section, 
       json_agg(json_build_object(
         'job_type', job_type, 'status', status,
         'recovery_count', recovery_count, 'day', day, 'cnt', cnt
       )) AS data
FROM stale_recoveries
UNION ALL
SELECT 'reaped_non_building',
       json_agg(json_build_object(
         'job_type', job_type, 'day', day, 'cnt', cnt
       ))
FROM reaped_jobs
UNION ALL
SELECT 'fanout_share',
       json_agg(json_build_object(
         'category', category, 'status', status, 'cnt', cnt
       ))
FROM fanout_share;
