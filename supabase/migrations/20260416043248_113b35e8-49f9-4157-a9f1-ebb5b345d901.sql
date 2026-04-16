
-- ══════════════════════════════════════════════════════════
-- RESET ALL HARD_FAIL MARKERS IN package_steps.meta
-- ══════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count int;
BEGIN
  -- Reset all HARD_FAIL markers
  UPDATE package_steps
  SET 
    meta = (COALESCE(meta, '{}'::jsonb) 
      - 'stall_reason_code' 
      - 'terminal_escalation' 
      - 'hard_fail_reason'
    ) || jsonb_build_object(
      'healed_at', now()::text,
      'healed_by', 'admin_reset_hard_fail_markers',
      'consecutive_no_progress', 0
    ),
    last_error = NULL,
    status = CASE WHEN status = 'failed' THEN 'queued' ELSE status END,
    updated_at = now()
  WHERE 
    meta->>'stall_reason_code' ILIKE '%HARD_FAIL%'
    OR (meta->>'terminal_escalation')::boolean = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Audit log
  INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'reset_hard_fail_markers',
    'admin_manual_migration',
    'package_steps',
    'system_wide',
    'healed',
    format('Reset %s steps with HARD_FAIL markers', v_count),
    jsonb_build_object('affected_count', v_count, 'healed_at', now()::text)
  );
END $$;
