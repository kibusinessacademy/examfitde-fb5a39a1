-- Reset 9 stuck processing Jobs damit sie mit der frisch deployed Edge-Function neu starten
UPDATE job_queue 
SET status='pending', 
    started_at=NULL, 
    locked_by=NULL, 
    locked_at=NULL,
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'reset_reason','post_heartbeat_deploy_fresh_pickup',
      'reset_at', now()::text,
      'previous_recoveries', COALESCE(meta->>'stale_lock_recoveries','0')
    )
WHERE job_type='package_run_integrity_check' 
  AND status='processing';

-- Audit
INSERT INTO admin_actions(action, scope, payload)
VALUES (
  'integrity_check_post_deploy_reset',
  'job_queue',
  jsonb_build_object(
    'reason','Edge-Function package-run-integrity-check freshly deployed with heartbeat instrumentation; old in-flight jobs reset to pending so they pick up the new code path',
    'timestamp', now()
  )
);