
-- First: Set allow_regression on ALL downstream steps that might be cascade-reset
UPDATE package_steps
SET meta = jsonb_set(
      jsonb_set(COALESCE(meta, '{}'::jsonb), '{allow_regression}', 'true'),
      '{allow_regression_by}', '"admin_manual"'
    )
WHERE package_id = 'c5000000-0004-4000-8000-000000000001'
  AND status = 'done';

-- Now reset the learning content pipeline + downstream validation
UPDATE package_steps
SET status = 'queued',
    meta = meta || jsonb_build_object(
      'lesson_gap_heal_reason', '15_competencies_in_LF06-LF10_missing_lessons',
      'consecutive_no_progress', 0
    ),
    updated_at = now()
WHERE package_id = 'c5000000-0004-4000-8000-000000000001'
  AND step_key IN (
    'generate_learning_content',
    'fanout_learning_content',
    'finalize_learning_content',
    'validate_learning_content',
    'generate_lesson_minichecks',
    'validate_lesson_minichecks',
    'validate_exam_pool',
    'run_integrity_check',
    'build_ai_tutor_index',
    'validate_tutor_index'
  );

-- Lift terminal status
UPDATE course_packages
SET gate_class = NULL,
    blocked_reason = NULL,
    status = 'building',
    updated_at = now()
WHERE id = 'c5000000-0004-4000-8000-000000000001';
