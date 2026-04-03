
-- 1. Kfz-Mechatroniker: Reset stale-lock job (attempt 4/5 → 0, unlock)
UPDATE job_queue SET
  status = 'pending',
  attempts = 0,
  locked_at = NULL,
  locked_by = NULL,
  run_after = NULL,
  last_error = 'ADMIN_RESET: stale-lock loop cleared by operator',
  meta = jsonb_set(
    COALESCE(meta, '{}'::jsonb),
    '{admin_reset_at}',
    to_jsonb(now()::text)
  ),
  updated_at = now()
WHERE id = '164c7ae6-d924-4db7-80ac-f6594494cc04';

-- 2a. Verwaltungsfachangestellte: Reset exam_pool job
UPDATE job_queue SET
  status = 'pending',
  attempts = 0,
  locked_at = NULL,
  locked_by = NULL,
  run_after = NULL,
  last_error = 'ADMIN_RESET: stale-lock loop cleared by operator',
  meta = jsonb_set(
    COALESCE(meta, '{}'::jsonb),
    '{admin_reset_at}',
    to_jsonb(now()::text)
  ),
  updated_at = now()
WHERE id = 'cefb4062-b6b0-49d9-8149-9fcdd7db7dc7';

-- 2b. Verwaltungsfachangestellte: Clear stuck_reason on package
UPDATE course_packages SET
  stuck_reason = NULL,
  updated_at = now()
WHERE id = 'be7aa766-af51-445d-83d5-100a54007b39';

-- 3. Industriekaufmann: Reset handbook job transient counter
UPDATE job_queue SET
  status = 'pending',
  attempts = 0,
  run_after = NULL,
  last_error = 'ADMIN_RESET: transient EMPTY_RESULT counter cleared',
  meta = jsonb_build_object(
    'admin_reset_at', now()::text,
    'previous_transient_attempts', COALESCE(meta->>'transient_attempts', '0')
  ),
  updated_at = now()
WHERE id = 'aed3c461-b920-4a9a-81f0-f6501b9a9470';

-- Log admin actions
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata) VALUES
  ('admin_manual_reset', 'lovable_operator', 'job_queue', '164c7ae6-d924-4db7-80ac-f6594494cc04', 'applied', 'Stale-lock loop reset for Kfz-Mechatroniker generate_lesson_minichecks', '{"package_id":"047bc325-5244-4f21-affd-5395bf62bcff","reason":"stale_lock_loop_4_of_5"}'::jsonb),
  ('admin_manual_reset', 'lovable_operator', 'job_queue', 'cefb4062-b6b0-49d9-8149-9fcdd7db7dc7', 'applied', 'Stale-lock loop reset for Verwaltungsfachangestellte generate_exam_pool', '{"package_id":"be7aa766-af51-445d-83d5-100a54007b39","reason":"stale_lock_loop_stuck_reason_cleared"}'::jsonb),
  ('admin_manual_reset', 'lovable_operator', 'job_queue', 'aed3c461-b920-4a9a-81f0-f6501b9a9470', 'applied', 'Transient EMPTY_RESULT reset for Industriekaufmann generate_handbook', '{"package_id":"f5e3403b-1fc6-46b3-a275-8420287f351e","reason":"empty_result_4x_transient"}'::jsonb);
