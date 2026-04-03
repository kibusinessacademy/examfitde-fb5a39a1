-- Recover BWL pilot package: quality_gate_failed → building, priority 1
UPDATE course_packages SET
  status = 'building',
  priority = 1,
  stuck_reason = NULL,
  started_at = COALESCE(started_at, now()),
  updated_at = now()
WHERE id = 'a0b0c0d0-0010-4000-8000-000000000001';

-- Reset any failed/stuck jobs for this package to pending
UPDATE job_queue SET
  status = 'pending',
  attempts = 0,
  locked_at = NULL,
  locked_by = NULL,
  run_after = NULL,
  last_error = 'ADMIN_RESET: BWL pilot relaunch after STUDIUM quota integration',
  meta = jsonb_set(
    COALESCE(meta, '{}'::jsonb),
    '{admin_reset_at}',
    to_jsonb(now()::text)
  ),
  updated_at = now()
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND status IN ('failed', 'stuck', 'dead');

-- Log admin action
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata) VALUES
  ('admin_manual_reset', 'lovable_operator', 'course_packages', 'a0b0c0d0-0010-4000-8000-000000000001', 'applied', 'BWL pilot recovered: quality_gate_failed → building prio 1, STUDIUM track quota enabled', '{"reason":"p1_5_studium_pipeline_launch","track":"STUDIUM"}'::jsonb);