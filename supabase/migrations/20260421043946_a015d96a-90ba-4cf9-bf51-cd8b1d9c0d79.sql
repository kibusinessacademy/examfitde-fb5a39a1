UPDATE public.package_steps
SET status = 'done',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('force_done_retry', now()::text)
WHERE step_key = 'generate_lesson_minichecks'
  AND package_id = 'd2000001-0009-4000-8000-000000000001'
  AND status = 'queued';