UPDATE public.track_step_applicability
SET should_run = true,
    updated_at = now()
WHERE step_key IN ('fanout_learning_content','finalize_learning_content','validate_learning_content')
  AND track::text IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS');