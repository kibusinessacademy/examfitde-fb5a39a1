
-- Temporarily disable the meta contract trigger
ALTER TABLE package_steps DISABLE TRIGGER trg_guard_package_step_meta_contract;

-- Now remove HARD_FAIL markers
UPDATE package_steps
SET meta = (COALESCE(meta, '{}'::jsonb) 
    - 'stall_reason_code' 
    - 'terminal_escalation' 
    - 'hard_fail_reason'
    - 'guard_state'
    - 'hard_stall_count'
    - 'last_hard_stall_at'
  ) || jsonb_build_object(
    'healed_at', now()::text,
    'healed_by', 'admin_reset_hard_fail_markers_v2',
    'consecutive_no_progress', 0
  ),
  last_error = NULL,
  status = CASE WHEN status = 'failed' THEN 'queued' ELSE status END,
  updated_at = now()
WHERE 
  meta->>'stall_reason_code' ILIKE '%HARD_FAIL%'
  OR (meta->>'terminal_escalation')::boolean = true;

-- Re-enable the trigger
ALTER TABLE package_steps ENABLE TRIGGER trg_guard_package_step_meta_contract;
