
-- 1. Create the pipeline_write_lesson_content RPC (was missing)
CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content(p_lesson_id uuid, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('council.publish_bypass', 'true', true);
  UPDATE lessons
  SET content = p_content,
      status = CASE WHEN status = 'placeholder' THEN 'draft' ELSE status END
  WHERE id = p_lesson_id;
END;
$$;

-- 2. Create bulk sync function for content_versions -> lessons
CREATE OR REPLACE FUNCTION public.bulk_sync_content_versions_to_lessons()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  synced integer := 0;
  rec record;
BEGIN
  PERFORM set_config('council.publish_bypass', 'true', true);
  
  FOR rec IN
    SELECT cv.lesson_id, cv.content_json
    FROM content_versions cv
    JOIN lessons l ON l.id = cv.lesson_id
    WHERE length(cv.content_json::text) > 300
      AND (l.content IS NULL OR l.content::text LIKE '%_placeholder%')
  LOOP
    UPDATE lessons
    SET content = rec.content_json,
        status = CASE WHEN status = 'placeholder' THEN 'draft' ELSE status END
    WHERE id = rec.lesson_id;
    synced := synced + 1;
  END LOOP;
  
  RETURN synced;
END;
$$;
