
-- One-time cleanup: cancel duplicate exam pool jobs, keep only the oldest per package
WITH ranked AS (
  SELECT id, package_id,
    ROW_NUMBER() OVER (PARTITION BY package_id ORDER BY created_at ASC) as rn
  FROM job_queue
  WHERE job_type = 'package_generate_exam_pool'
    AND status IN ('pending', 'processing')
)
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'DEDUP_CLEANUP: duplicate job cancelled by pipeline fix 2026-04-05',
    updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
