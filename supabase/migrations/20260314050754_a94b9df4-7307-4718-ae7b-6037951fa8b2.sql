
UPDATE package_steps 
SET status = 'done', 
    started_at = COALESCE(started_at, now() - interval '1 minute'),
    finished_at = now(),
    meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb), 
      '{manually_completed}', 
      'true'::jsonb
    )
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_lesson_minichecks';
