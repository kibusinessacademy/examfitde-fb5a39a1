DO $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  WITH candidates AS (
    SELECT l.id
    FROM public.lessons l
    JOIN public.modules m ON m.id = l.module_id
    JOIN public.courses c ON c.id = m.course_id
    WHERE l.content_hash IS NULL
      AND l.content IS NOT NULL
      AND jsonb_typeof(l.content) = 'object'
      AND public.is_real_lesson_content(l.content) = true
      AND COALESCE(c.autopilot_status, '') <> 'sealed'
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type = 'lesson_generate_content'
          AND jq.status IN ('queued', 'processing', 'enqueued', 'running')
          AND (jq.payload->>'lesson_id')::uuid = l.id
      )
  ),
  upd AS (
    UPDATE public.lessons l
    SET
      content_hash = md5(l.content::text),
      generation_status = 'completed',
      status = CASE
        WHEN l.status IN ('published', 'approved') THEN l.status
        ELSE 'approved'
      END
    FROM candidates ca
    WHERE l.id = ca.id
    RETURNING l.id
  )
  SELECT COUNT(*) INTO v_updated FROM upd;

  INSERT INTO public.admin_actions (action, scope, payload, created_at)
  VALUES (
    'lesson_artifact_truth_backfill_sweep_v2',
    'pipeline.lesson.materialization',
    jsonb_build_object(
      'updated_lessons', v_updated,
      'criteria', 'is_real_lesson_content SSOT only, no html_len gate',
      'excluded', jsonb_build_array('sealed_courses', 'active_lesson_generate_content_jobs')
    ),
    now()
  );

  RAISE NOTICE 'Backfill v2: % lessons updated', v_updated;
END $$;