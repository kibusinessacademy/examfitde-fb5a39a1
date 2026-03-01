-- Bug 3 FIX: Backfill content_versions for lessons that have content but no version entry
INSERT INTO public.content_versions (lesson_id, course_id, step_key, content_json, created_by_agent, status, council_round, entity_type)
SELECT
  l.id AS lesson_id,
  m.course_id AS course_id,
  COALESCE(l.step::text, 'einstieg') AS step_key,
  l.content AS content_json,
  'backfill-bug3-fix' AS created_by_agent,
  'proposed'::content_version_status AS status,
  1 AS council_round,
  'lesson_step' AS entity_type
FROM public.lessons l
JOIN public.modules m ON m.id = l.module_id
WHERE l.content IS NOT NULL
  AND jsonb_typeof(l.content) = 'object'
  AND (l.content->>'_placeholder')::text IS DISTINCT FROM 'true'
  AND length(l.content::text) > 100
  AND NOT EXISTS (
    SELECT 1 FROM public.content_versions cv WHERE cv.lesson_id = l.id
  );