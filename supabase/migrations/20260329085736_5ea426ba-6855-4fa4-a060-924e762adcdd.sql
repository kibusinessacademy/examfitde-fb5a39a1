
-- Fix ops_build_activity_truth: add explicit 'no_activity' verdict
-- no_activity = building but no lease, no fresh jobs, no running steps, no zombie jobs
-- false_active = has zombie jobs or lease but no real work
-- alive = fresh jobs, running steps, or recent pipeline events
CREATE OR REPLACE VIEW public.ops_build_activity_truth AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.build_progress,
  cp.track,
  (SELECT count(*) FROM job_queue jq
   WHERE jq.package_id = cp.id
     AND jq.status IN ('processing','pending')
     AND jq.created_at > now() - interval '24 hours') AS fresh_active_jobs,
  (SELECT count(*) FROM job_queue jq
   WHERE jq.package_id = cp.id
     AND jq.status = 'processing'
     AND jq.created_at < now() - interval '24 hours') AS zombie_jobs,
  (SELECT count(*) FROM package_steps ps
   WHERE ps.package_id = cp.id
     AND ps.status = 'running') AS running_steps,
  EXISTS (SELECT 1 FROM package_leases pl
          WHERE pl.package_id = cp.id AND pl.lease_until > now()) AS has_lease,
  (SELECT max(cpe.created_at) FROM course_pipeline_events cpe
   WHERE cpe.package_id = cp.id) AS last_pipeline_event_at,
  (SELECT max(ps.updated_at) FROM package_steps ps
   WHERE ps.package_id = cp.id) AS last_step_transition_at,
  CASE
    -- alive: fresh jobs OR running steps OR recent pipeline events
    WHEN EXISTS (SELECT 1 FROM job_queue jq
                 WHERE jq.package_id = cp.id
                   AND jq.status IN ('processing','pending')
                   AND jq.created_at > now() - interval '24 hours')
      THEN 'alive'
    WHEN EXISTS (SELECT 1 FROM package_steps ps
                 WHERE ps.package_id = cp.id AND ps.status = 'running')
      THEN 'alive'
    WHEN EXISTS (SELECT 1 FROM course_pipeline_events cpe
                 WHERE cpe.package_id = cp.id
                   AND cpe.created_at > now() - interval '2 hours')
      THEN 'alive'
    -- false_active: has zombie jobs or active lease but no real work
    WHEN EXISTS (SELECT 1 FROM job_queue jq
                 WHERE jq.package_id = cp.id
                   AND jq.status = 'processing'
                   AND jq.created_at < now() - interval '24 hours')
      THEN 'false_active'
    WHEN EXISTS (SELECT 1 FROM package_leases pl
                 WHERE pl.package_id = cp.id AND pl.lease_until > now())
      THEN 'false_active'
    -- no_activity: nothing at all
    ELSE 'no_activity'
  END AS liveness_verdict
FROM course_packages cp
WHERE cp.status = 'building';

NOTIFY pgrst, 'reload schema';
