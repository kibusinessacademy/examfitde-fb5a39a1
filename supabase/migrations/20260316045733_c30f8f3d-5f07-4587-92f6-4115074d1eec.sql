
-- Fix: Add grace period to zombie detection view
-- Packages must be building for at least 10 minutes without any job/lease
-- before being considered zombies. This prevents race conditions with
-- fresh re-entries that haven't had time to enqueue jobs yet.
DROP VIEW IF EXISTS public.ops_building_without_job_or_lease;

CREATE VIEW public.ops_building_without_job_or_lease AS
WITH active_pkg AS (
  SELECT DISTINCT (job_queue.payload ->> 'package_id') AS package_id
  FROM job_queue
  WHERE job_queue.status IN ('pending', 'processing', 'running', 'batch_pending', 'queued')
    AND job_queue.payload ? 'package_id'
),
leased_pkg AS (
  SELECT DISTINCT package_id::text AS package_id
  FROM package_leases
  WHERE lease_until > now()
),
recent_recovery AS (
  SELECT DISTINCT target_id AS package_id
  FROM auto_heal_log
  WHERE action_type = 'recover_and_reenter_package'
    AND result_status = 'success'
    AND created_at > now() - interval '15 minutes'
)
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.build_progress,
  cp.updated_at,
  cp.last_progress_at
FROM course_packages cp
LEFT JOIN active_pkg a ON a.package_id = cp.id::text
LEFT JOIN leased_pkg l ON l.package_id = cp.id::text
LEFT JOIN recent_recovery rr ON rr.package_id = cp.id::text
WHERE cp.status = 'building'
  AND a.package_id IS NULL
  AND l.package_id IS NULL
  AND rr.package_id IS NULL
  AND cp.updated_at < now() - interval '10 minutes'
