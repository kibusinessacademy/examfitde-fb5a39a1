
-- Reset phantom-finalized governance steps with proper regression meta
UPDATE package_steps
SET status = 'queued',
    meta = jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by', 'ops_force_reset',
      'reset_reason', 'PHANTOM_FINALIZATION_ROLLBACK',
      'reset_at', now()::text,
      'previous_status', status,
      'previous_meta', meta
    )
WHERE package_id IN ('4866a5b0-1430-4ab3-825b-141605d99612', '5db3e206-5484-4ac3-b146-feab268176dd')
  AND step_key IN ('run_integrity_check', 'quality_council')
  AND status = 'done';

UPDATE package_steps
SET status = 'queued',
    meta = jsonb_build_object(
      'allow_regression', true,
      'allow_regression_by', 'ops_force_reset',
      'reset_reason', 'PHANTOM_FINALIZATION_ROLLBACK_CASCADE',
      'reset_at', now()::text,
      'previous_status', status
    )
WHERE package_id IN ('4866a5b0-1430-4ab3-825b-141605d99612', '5db3e206-5484-4ac3-b146-feab268176dd')
  AND step_key = 'auto_publish'
  AND status IN ('skipped', 'failed');
