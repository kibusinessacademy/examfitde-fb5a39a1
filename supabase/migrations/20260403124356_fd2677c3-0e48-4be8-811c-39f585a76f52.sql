-- 1. Reset handbook step with proper regression authorization
UPDATE package_steps SET
  status = 'queued',
  started_at = NULL,
  updated_at = now(),
  meta = jsonb_build_object(
    'allow_regression', true,
    'allow_regression_by', 'admin_manual',
    'admin_reset_reason', 'p1_5_full_reseed'
  )
WHERE package_id = 'a0b0c0d0-0010-4000-8000-000000000001'
  AND step_key = 'generate_handbook';

-- 2. Insert all 24 SSOT-registered steps (ON CONFLICT DO NOTHING)
INSERT INTO package_steps (package_id, step_key, status) VALUES
  ('a0b0c0d0-0010-4000-8000-000000000001', 'scaffold_learning_course', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'generate_glossary', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'fanout_learning_content', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'generate_learning_content', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'finalize_learning_content', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_learning_content', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'auto_seed_exam_blueprints', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_blueprints', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'generate_exam_pool', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_exam_pool', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'build_ai_tutor_index', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_tutor_index', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'generate_oral_exam', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_oral_exam', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'generate_lesson_minichecks', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_lesson_minichecks', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_handbook', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'enqueue_handbook_expand', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'expand_handbook', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_handbook_depth', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'elite_harden', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'run_integrity_check', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'quality_council', 'queued'),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'auto_publish', 'queued')
ON CONFLICT (package_id, step_key) DO NOTHING;

-- 3. Set package to building with priority 1
UPDATE course_packages SET
  status = 'building',
  priority = 1,
  build_progress = 0,
  stuck_reason = NULL,
  started_at = now(),
  updated_at = now()
WHERE id = 'a0b0c0d0-0010-4000-8000-000000000001';

-- 4. Log
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata) VALUES
  ('admin_manual_reset', 'lovable_operator', 'course_packages', 'a0b0c0d0-0010-4000-8000-000000000001', 'applied', 'Full pipeline reseed: 25 SSOT steps, handbook regression, status→building prio 1', '{"reason":"p1_5_full_reseed","track":"STUDIUM"}'::jsonb);