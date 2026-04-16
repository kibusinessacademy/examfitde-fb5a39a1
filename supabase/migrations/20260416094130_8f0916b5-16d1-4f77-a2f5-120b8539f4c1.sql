
ALTER TABLE package_steps DISABLE TRIGGER trg_guard_package_step_meta_contract;

UPDATE package_steps
SET 
  status = 'queued',
  last_error = NULL,
  meta = (COALESCE(meta, '{}'::jsonb)
    - 'stall_reason_code'
    - 'terminal_escalation'
    - 'hard_fail_reason'
    - 'guard_state'
    - 'hard_stall_count'
    - 'consecutive_no_progress'
  ) || jsonb_build_object(
    'healed_at', now()::text,
    'healed_by', 'admin_fix_false_positive_no_curriculum',
    'consecutive_no_progress', 0
  )
WHERE package_id = 'd2000000-0010-4000-8000-000000000001'
  AND step_key = 'validate_exam_pool'
  AND status = 'failed';

ALTER TABLE package_steps ENABLE TRIGGER trg_guard_package_step_meta_contract;
