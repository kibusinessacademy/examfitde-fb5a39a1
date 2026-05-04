CREATE OR REPLACE VIEW public.v_ops_shadow_zombies AS
WITH pkg_jobs AS (
  SELECT job_queue.package_id,
    count(*) FILTER (WHERE job_queue.status = ANY (ARRAY['pending'::text, 'processing'::text])) AS active_jobs,
    count(*) FILTER (WHERE job_queue.status = 'completed' AND job_queue.completed_at > (now() - '01:00:00'::interval)) AS completed_1h,
    count(*) FILTER (WHERE job_queue.status = 'failed' AND job_queue.completed_at > (now() - '01:00:00'::interval)) AS failed_1h,
    COALESCE(sum(job_queue.attempts) FILTER (WHERE job_queue.status = ANY (ARRAY['pending'::text, 'processing'::text])), 0::bigint) AS total_attempts
  FROM job_queue
  WHERE job_queue.package_id IS NOT NULL
  GROUP BY job_queue.package_id
), pkg_batches AS (
  SELECT jq.package_id,
    count(*) FILTER (WHERE lb.status = 'failed') AS batch_fails_1h,
    count(*) FILTER (WHERE lb.status <> ALL (ARRAY['failed'::text, 'cancelled'::text])) AS batch_ok_1h
  FROM job_queue jq
    JOIN llm_batch_requests lbr ON lbr.source_job_id = jq.id
    JOIN llm_batches lb ON lb.id = lbr.batch_id
  WHERE lb.created_at > (now() - '01:00:00'::interval) AND jq.package_id IS NOT NULL
  GROUP BY jq.package_id
), pkg_leases AS (
  SELECT package_leases.package_id, count(*) AS lease_count
  FROM package_leases
  WHERE package_leases.lease_until > now()
  GROUP BY package_leases.package_id
), pkg_open_steps AS (
  SELECT ps.package_id, count(*) AS open_steps
  FROM package_steps ps
  WHERE ps.status NOT IN ('done','skipped')
  GROUP BY ps.package_id
)
SELECT cp.id AS package_id,
    cp.title, cp.priority, cp.status,
    COALESCE(pj.active_jobs, 0) AS active_jobs,
    COALESCE(pl.lease_count, 0) AS active_leases,
    COALESCE(pj.completed_1h, 0) AS completed_jobs_1h,
    COALESCE(pj.failed_1h, 0) AS failed_jobs_1h,
    COALESCE(pj.total_attempts, 0) AS total_retry_attempts,
    COALESCE(pb.batch_fails_1h, 0) AS batch_submit_fails_1h,
    COALESCE(pb.batch_ok_1h, 0) AS batch_submit_ok_1h,
    CASE
        WHEN COALESCE(pj.active_jobs,0) > 0 AND COALESCE(pj.completed_1h,0) > 0 AND COALESCE(pj.failed_1h,0) > COALESCE(pj.completed_1h,0) THEN 'RETRYING'
        WHEN COALESCE(pj.active_jobs,0) > 0 AND COALESCE(pj.completed_1h,0) > 0 THEN 'HEALTHY_ACTIVE'
        WHEN COALESCE(pj.active_jobs,0) > 0 AND COALESCE(pj.completed_1h,0) = 0 AND COALESCE(pj.total_attempts,0) > 20 THEN 'POISONED_LOOP'
        WHEN COALESCE(pj.active_jobs,0) > 0 AND COALESCE(pj.completed_1h,0) = 0 AND COALESCE(pb.batch_ok_1h,0) = 0 AND COALESCE(pb.batch_fails_1h,0) > 0 THEN 'SHADOW_ZOMBIE'
        WHEN COALESCE(pj.active_jobs,0) = 0 AND cp.status = 'building'
             -- F1 exclusions: bronze-locked OR no open steps (handled by F3)
             AND COALESCE((cp.feature_flags->'bronze'->>'requires_review')::boolean, false) = false
             AND COALESCE(cp.feature_flags->'bronze'->>'final_state','') NOT IN ('requires_review','manual_approved')
             AND COALESCE(pos.open_steps, 0) > 0
        THEN 'HARD_STALLED'
        ELSE 'UNKNOWN'
    END AS zombie_class,
    now() AS checked_at
FROM course_packages cp
LEFT JOIN pkg_jobs pj ON pj.package_id = cp.id
LEFT JOIN pkg_batches pb ON pb.package_id = cp.id
LEFT JOIN pkg_leases pl ON pl.package_id = cp.id
LEFT JOIN pkg_open_steps pos ON pos.package_id = cp.id
WHERE cp.status = ANY (ARRAY['building'::text, 'queued'::text])
  AND (COALESCE(pj.active_jobs,0) > 0 OR cp.status = 'building');