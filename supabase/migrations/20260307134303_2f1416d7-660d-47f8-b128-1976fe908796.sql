
-- Direct sync: copy content from content_versions to lessons (bypass guard)
-- MFA lesson
DO $$
BEGIN
  PERFORM set_config('council.publish_bypass', 'true', true);
  
  UPDATE public.lessons
  SET content = cv.content_json,
      qc_status = 'approved'
  FROM (
    SELECT content_json, lesson_id
    FROM public.content_versions
    WHERE lesson_id = '049eeb27-72d8-44b4-80a9-cbc4846f81e6'
      AND status = 'approved'
    ORDER BY created_at DESC
    LIMIT 1
  ) cv
  WHERE lessons.id = cv.lesson_id;

  -- Pharma lesson
  UPDATE public.lessons
  SET content = cv.content_json,
      qc_status = 'approved'
  FROM (
    SELECT content_json, lesson_id
    FROM public.content_versions
    WHERE lesson_id = '0135f02c-f71e-486f-9e85-455b1b4cd2b6'
      AND status = 'approved'
    ORDER BY created_at DESC
    LIMIT 1
  ) cv
  WHERE lessons.id = cv.lesson_id;
  
  PERFORM set_config('council.publish_bypass', 'false', true);
END $$;

-- Also: run a broader backfill for any other lessons stuck in the same timing gap
DO $$
DECLARE
  v_fixed int := 0;
BEGIN
  PERFORM set_config('council.publish_bypass', 'true', true);
  
  WITH needs_sync AS (
    SELECT DISTINCT ON (cv.lesson_id)
      cv.lesson_id,
      cv.content_json
    FROM public.content_versions cv
    JOIN public.lessons l ON l.id = cv.lesson_id
    WHERE cv.status = 'approved'
      AND cv.content_json IS NOT NULL
      AND length(cv.content_json::text) >= 200
      AND l.content IS NULL
    ORDER BY cv.lesson_id, cv.created_at DESC
  )
  UPDATE public.lessons l
  SET content = ns.content_json,
      qc_status = 'approved'
  FROM needs_sync ns
  WHERE l.id = ns.lesson_id;
  
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  RAISE NOTICE 'Backfilled % lessons from content_versions', v_fixed;
  
  PERFORM set_config('council.publish_bypass', 'false', true);
END $$;
