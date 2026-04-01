
-- Cancel orphaned pending jobs for cold-paused packages
UPDATE job_queue SET status = 'cancelled', 
  last_error = 'WIP_REDUCTION: package cold-paused',
  updated_at = now()
WHERE status = 'pending' 
AND package_id IN (SELECT id FROM course_packages WHERE status = 'queued');
