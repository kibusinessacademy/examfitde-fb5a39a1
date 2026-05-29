INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module)
VALUES ('pre_heartbeat_kill_heartbeat_wrap_cut', ARRAY['fix','cut']::text[], 'pipeline_audit_failed_jobs_72h_ssot')
ON CONFLICT (action_type) DO NOTHING;

UPDATE public.job_queue
SET status = 'pending',
    attempts = GREATEST(0, attempts - 2),
    started_at = NULL,
    locked_at = NULL,
    locked_by = NULL,
    last_heartbeat_at = NULL,
    completed_at = NULL,
    last_error = COALESCE(last_error,'') || ' | requeued by heartbeat-wrap cut 2026-05-29',
    run_after = now()
WHERE job_type = 'package_post_publish_audit_snapshot'
  AND status = 'failed'
  AND last_error ILIKE '%PRE_HEARTBEAT_KILL_TERMINAL%';

SELECT public.fn_emit_audit(
  _action_type    => 'pre_heartbeat_kill_heartbeat_wrap_cut',
  _target_type    => 'job_type',
  _target_id      => 'package_post_publish_audit_snapshot',
  _result_status  => 'success',
  _payload        => jsonb_build_object(
    'fix','post-publish-growth-worker stamps last_heartbeat_at on claim + per-job',
    'cut','P0 cut 1'
  ),
  _trigger_source => 'manual_cut',
  _error_message  => NULL
);