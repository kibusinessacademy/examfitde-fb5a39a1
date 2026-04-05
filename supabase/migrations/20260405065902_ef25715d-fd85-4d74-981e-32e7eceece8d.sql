
-- FIX: Lagerlogistik unblock
UPDATE public.course_packages
SET status = 'building', updated_at = now()
WHERE id = 'f2039067-e58a-4e94-9573-b5953d435873' AND status = 'blocked';

-- FIX: Wirtschaftsinformatik — reset exhausted validate_blueprint_variants
UPDATE public.job_queue
SET status = 'pending', attempts = 0, last_error = NULL, locked_by = NULL, locked_at = NULL, updated_at = now()
WHERE id = 'beb18eeb-06ad-4042-80d2-4715a6218c73' AND status = 'failed';

-- FIX: Bilanzbuchhalter — skip EXAM_FIRST_PLUS learning steps
UPDATE public.package_steps
SET status = 'skipped'
WHERE package_id = 'eef4bbe6-6c92-4969-941e-af471e86d67f'
  AND step_key IN (
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'fanout_learning_content','enqueue_handbook_expand','expand_handbook','validate_handbook_depth'
  )
  AND status = 'queued';
