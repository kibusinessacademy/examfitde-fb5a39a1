
-- Temporarily disable the guard trigger
ALTER TABLE package_steps DISABLE TRIGGER trg_guard_package_step_meta_contract;

-- Reset all 19 failed validate_exam_pool steps (excluding NO_CURRICULUM)
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
    'healed_by', 'admin_mass_heal_validate_exam_pool_timing',
    'consecutive_no_progress', 0
  )
WHERE step_key = 'validate_exam_pool'
  AND status = 'failed'
  AND (
    meta->>'stall_reason_code' = 'HARD_FAIL_GENERATION_NEVER_RAN'
    OR meta->>'stall_reason_code' = 'HARD_FAIL_REPAIR_EXHAUSTED'
  );

-- Re-enable the guard trigger
ALTER TABLE package_steps ENABLE TRIGGER trg_guard_package_step_meta_contract;
