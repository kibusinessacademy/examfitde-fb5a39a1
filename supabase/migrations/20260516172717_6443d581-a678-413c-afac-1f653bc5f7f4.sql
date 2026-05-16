UPDATE job_type_policies
SET can_run_when_not_building = true,
    exempt_from_auto_cancel   = true,
    updated_at = now()
WHERE job_type IN (
  'package_scaffold_learning_course',
  'package_repair_failed_lessons',
  'package_generate_learning_content'
);

INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'm9_content_repair_policy_whitelist',
  'system',
  'success',
  jsonb_build_object(
    'job_types', ARRAY['package_scaffold_learning_course','package_repair_failed_lessons','package_generate_learning_content'],
    'reason', 'M9 first backfill: all 17 jobs cancelled within 38s by OPS_GUARD (Welle 2 Loop 2 pattern)',
    'flags', jsonb_build_object('can_run_when_not_building', true, 'exempt_from_auto_cancel', true)
  )
);