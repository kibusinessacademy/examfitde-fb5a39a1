-- Drift audit view: detect orchestration misalignments
CREATE OR REPLACE VIEW public.ops_pipeline_step_drift AS
WITH functional_steps AS (
  SELECT ps.package_id, ps.step_key, ps.status, ps.updated_at,
    cp.status as pkg_status, cp.build_progress
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE ps.status != 'skipped'
    AND cp.status IN ('building', 'blocked', 'council_review', 'quality_gate_failed')
),
step_mapping AS (
  SELECT step_key, job_type FROM ops_jobtype_step_map
)
SELECT 
  fs.package_id,
  fs.pkg_status,
  fs.build_progress,
  fs.step_key,
  fs.status as step_status,
  fs.updated_at as step_updated_at,
  sm.job_type,
  CASE
    -- Step exists but has no job mapping → phantom dispatch risk
    WHEN sm.job_type IS NULL THEN 'UNMAPPED_STEP'
    -- Step queued for >2h while predecessor is done → stall candidate
    WHEN fs.status = 'queued' AND fs.updated_at < now() - interval '2 hours' THEN 'STALE_QUEUED'
    -- Step enqueued for >1h → possible job loss
    WHEN fs.status = 'enqueued' AND fs.updated_at < now() - interval '1 hour' THEN 'STALE_ENQUEUED'
    -- Step running for >30min → possible zombie
    WHEN fs.status = 'running' AND fs.updated_at < now() - interval '30 minutes' THEN 'ZOMBIE_RUNNING'
    -- Step blocked → needs attention
    WHEN fs.status = 'blocked' THEN 'BLOCKED'
    ELSE 'OK'
  END as drift_signal,
  EXTRACT(EPOCH FROM (now() - fs.updated_at)) / 60.0 as age_minutes
FROM functional_steps fs
LEFT JOIN step_mapping sm ON sm.step_key = fs.step_key
WHERE fs.status NOT IN ('done')
ORDER BY 
  CASE 
    WHEN sm.job_type IS NULL THEN 0
    WHEN fs.status = 'blocked' THEN 1
    WHEN fs.status = 'running' AND fs.updated_at < now() - interval '30 minutes' THEN 2
    ELSE 10
  END,
  fs.updated_at ASC;

NOTIFY pgrst, 'reload schema';