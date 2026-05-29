WITH targets AS (
  SELECT DISTINCT j.package_id
  FROM public.job_queue j
  WHERE j.job_type = 'package_post_publish_audit_snapshot'
    AND j.status = 'failed'
    AND j.last_error ILIKE '%PRE_HEARTBEAT_KILL_TERMINAL%'
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue k
      WHERE k.job_type = 'package_post_publish_audit_snapshot'
        AND k.package_id = j.package_id
        AND k.status IN ('pending','processing')
    )
), inserted AS (
  INSERT INTO public.job_queue (
    job_type, job_name, lane, worker_pool, priority,
    status, package_id, payload, idempotency_key, max_attempts, run_after
  )
  SELECT
    'package_post_publish_audit_snapshot',
    'package_post_publish_audit_snapshot',
    'growth', 'core', 50,
    'pending',
    t.package_id,
    jsonb_build_object('package_id', t.package_id, 'requeue_origin','heartbeat_wrap_cut_2026_05_29'),
    'audit_snapshot:heartbeat_wrap_2026_05_29:'||t.package_id::text,
    25,
    now()
  FROM targets t
  RETURNING id, package_id
)
SELECT public.fn_emit_audit(
  _action_type    => 'pre_heartbeat_kill_heartbeat_wrap_cut',
  _target_type    => 'job_type',
  _target_id      => 'package_post_publish_audit_snapshot',
  _result_status  => 'success',
  _payload        => jsonb_build_object(
    'fix','re-enqueue new pending jobs (terminal rows untouched, guard respected)',
    'enqueued_count', (SELECT count(*) FROM inserted),
    'cut','P0 cut 1 step 2'
  ),
  _trigger_source => 'manual_cut',
  _error_message  => NULL
);