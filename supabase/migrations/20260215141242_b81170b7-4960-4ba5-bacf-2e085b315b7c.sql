
-- Recreate claim index
DROP INDEX IF EXISTS idx_job_queue_claim;
DROP INDEX IF EXISTS idx_job_queue_claim_v2;
CREATE INDEX idx_job_queue_claim_v2 ON public.job_queue (priority ASC NULLS LAST, run_after ASC NULLS FIRST)
  WHERE status = 'pending';

-- Failed-Job-Cluster-View
CREATE OR REPLACE VIEW public.v_failed_job_clusters AS
SELECT 
  job_type,
  CASE 
    WHEN error LIKE '%PREREQ_NOT_DONE%' THEN 'prereq_not_done'
    WHEN error LIKE '%timeout%' OR error LIKE '%abort%' THEN 'timeout'
    WHEN error LIKE '%429%' OR error LIKE '%rate%' THEN 'rate_limited'
    WHEN error LIKE '%500%' OR error LIKE '%502%' OR error LIKE '%503%' THEN 'server_error'
    WHEN error LIKE '%Guardian%' THEN 'guardian_kill'
    WHEN error LIKE '%cap reached%' THEN 'retry_exhausted'
    ELSE 'other'
  END AS error_cluster,
  count(*) AS failure_count,
  min(created_at) AS first_seen,
  max(completed_at) AS last_seen,
  count(DISTINCT (payload->>'package_id')) AS affected_packages
FROM job_queue
WHERE status = 'failed'
  AND created_at > now() - interval '7 days'
GROUP BY job_type, error_cluster
ORDER BY failure_count DESC;

-- Pipeline Alerts View (all entity_id as text)
CREATE OR REPLACE VIEW public.v_pipeline_alerts AS
SELECT 
  'stale_processing' AS alert_type,
  id::text AS entity_id,
  job_type,
  created_at,
  'Job in processing > 5min without completion' AS message
FROM job_queue
WHERE status = 'processing'
  AND created_at < now() - interval '5 minutes'
  AND completed_at IS NULL

UNION ALL

SELECT 
  'high_error_rate' AS alert_type,
  job_type AS entity_id,
  job_type,
  now() AS created_at,
  format('Error rate > 30%% for %s', job_type) AS message
FROM job_queue
WHERE created_at > now() - interval '1 hour'
GROUP BY job_type
HAVING count(*) FILTER (WHERE status = 'failed')::numeric / NULLIF(count(*), 0) > 0.3
  AND count(*) > 5

UNION ALL

SELECT 
  'queue_backlog' AS alert_type,
  NULL::text AS entity_id,
  'all' AS job_type,
  now() AS created_at,
  format('%s jobs pending', count(*)) AS message
FROM job_queue
WHERE status = 'pending'
HAVING count(*) > 50;
