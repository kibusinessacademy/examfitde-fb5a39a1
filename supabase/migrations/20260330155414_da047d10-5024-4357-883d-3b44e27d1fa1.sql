
-- Heal all 4 blocked packages back to building
UPDATE course_packages
SET status = 'building', blocked_reason = NULL, stuck_reason = NULL, updated_at = now()
WHERE id IN (
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
  '570ccb3e-2937-4d81-b3d8-624b9be84737',
  '335decc8-9f68-4784-b318-a68f620bf77e'
);

-- Re-queue validate_exam_pool, run_integrity_check, auto_publish for all 4
UPDATE package_steps
SET status = 'queued', last_error = NULL, started_at = NULL, finished_at = NULL, updated_at = now()
WHERE package_id IN (
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
  '570ccb3e-2937-4d81-b3d8-624b9be84737',
  '335decc8-9f68-4784-b318-a68f620bf77e'
)
AND step_key IN ('validate_exam_pool', 'run_integrity_check', 'auto_publish')
AND status IN ('failed', 'queued', 'blocked');
