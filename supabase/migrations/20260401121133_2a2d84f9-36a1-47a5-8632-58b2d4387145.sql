
-- Fix WIP config: reduce from 24 to 7
UPDATE ops_pipeline_config SET value = '7' WHERE key = 'max_concurrent_packages';

-- Cold-pause excess building packages that have no active jobs and aren't priority 1
-- Keep the 7 highest-priority packages in building, move rest to queued
WITH ranked AS (
  SELECT id, priority,
    ROW_NUMBER() OVER (ORDER BY priority ASC, updated_at DESC) as rn,
    (SELECT COUNT(*) FROM job_queue jq WHERE jq.package_id = cp.id AND jq.status IN ('processing')) as proc_jobs
  FROM course_packages cp
  WHERE status = 'building'
),
to_pause AS (
  SELECT id FROM ranked WHERE rn > 7 AND proc_jobs = 0
)
UPDATE course_packages 
SET status = 'queued', 
    priority = 99,
    last_error = 'WIP_REDUCTION: cold-paused to enforce 7-package WIP cap'
WHERE id IN (SELECT id FROM to_pause);
