-- One-time global reset of all stale processing jobs (incident cleanup)
UPDATE job_queue
SET status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now(),
    last_error = format('GLOBAL_INCIDENT_RESET: was processing since %s by %s — reset during v4.2 deploy. Previous: %s',
      locked_at, coalesce(locked_by, 'unknown'), coalesce(last_error, 'none'))
WHERE status = 'processing'
  AND locked_at < now() - interval '5 minutes';

-- Log the incident reset in auto_heal_log
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
SELECT 
  'global_incident_reset',
  'migration_v4.2_deploy',
  'job',
  id,
  'success',
  format('Reset zombie %s for package %s (locked %s ago by %s)', job_type, package_id, age(now(), locked_at), coalesce(locked_by, 'unknown')),
  jsonb_build_object('job_type', job_type, 'package_id', package_id, 'locked_at', locked_at, 'locked_by', locked_by, 'previous_error', last_error)
FROM job_queue
WHERE status = 'processing'
  AND locked_at < now() - interval '5 minutes';