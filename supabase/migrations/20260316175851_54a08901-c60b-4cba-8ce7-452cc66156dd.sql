
-- G4: v_ops_shadow_zombies (fixed join types)
CREATE OR REPLACE VIEW public.v_ops_shadow_zombies AS
WITH pkg_jobs AS (
  SELECT package_id,
    COUNT(*) FILTER (WHERE status IN ('pending','processing')) AS active_jobs,
    COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '60 minutes') AS completed_1h,
    COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > now() - interval '60 minutes') AS failed_1h,
    SUM(attempts) FILTER (WHERE status IN ('pending','processing')) AS total_attempts
  FROM job_queue WHERE package_id IS NOT NULL GROUP BY package_id
),
pkg_batches AS (
  SELECT jq.package_id,
    COUNT(*) FILTER (WHERE lb.status = 'failed') AS batch_fails_1h,
    COUNT(*) FILTER (WHERE lb.status NOT IN ('failed','cancelled')) AS batch_ok_1h
  FROM job_queue jq
  JOIN llm_batch_requests lbr ON lbr.source_job_id = jq.id
  JOIN llm_batches lb ON lb.id = lbr.batch_id
  WHERE lb.created_at > now() - interval '1 hour'
    AND jq.package_id IS NOT NULL
  GROUP BY jq.package_id
),
pkg_leases AS (
  SELECT package_id, COUNT(*) AS lease_count
  FROM package_leases WHERE lease_until > now() GROUP BY package_id
)
SELECT cp.id AS package_id, cp.title, cp.priority, cp.status,
  COALESCE(pj.active_jobs, 0) AS active_jobs,
  COALESCE(pl.lease_count, 0) AS active_leases,
  COALESCE(pj.completed_1h, 0) AS completed_jobs_1h,
  COALESCE(pj.failed_1h, 0) AS failed_jobs_1h,
  COALESCE(pj.total_attempts, 0) AS total_retry_attempts,
  COALESCE(pb.batch_fails_1h, 0) AS batch_submit_fails_1h,
  COALESCE(pb.batch_ok_1h, 0) AS batch_submit_ok_1h,
  CASE
    WHEN COALESCE(pj.active_jobs, 0) > 0 AND COALESCE(pj.completed_1h, 0) > 0 
    THEN 'HEALTHY_ACTIVE'
    WHEN COALESCE(pj.active_jobs, 0) > 0 AND COALESCE(pj.completed_1h, 0) = 0 
      AND COALESCE(pb.batch_ok_1h, 0) = 0 
    THEN 'SHADOW_ZOMBIE'
    WHEN COALESCE(pj.active_jobs, 0) > 0 AND COALESCE(pj.completed_1h, 0) = 0 
      AND COALESCE(pj.total_attempts, 0) > 20 
    THEN 'POISONED_LOOP'
    WHEN COALESCE(pj.active_jobs, 0) = 0 AND cp.status = 'building' 
    THEN 'HARD_STALLED'
    ELSE 'UNKNOWN'
  END AS zombie_class,
  now() AS checked_at
FROM course_packages cp
LEFT JOIN pkg_jobs pj ON pj.package_id = cp.id
LEFT JOIN pkg_batches pb ON pb.package_id = cp.id
LEFT JOIN pkg_leases pl ON pl.package_id = cp.id
WHERE cp.status IN ('building', 'queued')
  AND (COALESCE(pj.active_jobs, 0) > 0 OR cp.status = 'building');
