
-- One-time repair function to sync content_versions into lessons for PKA v2
-- This fixes the sync gap where content was generated but never synced to lessons
CREATE OR REPLACE FUNCTION repair_sync_pka_v2()
RETURNS TABLE(synced_count int) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  rec RECORD;
BEGIN
  -- Set bypass for guard_lesson_content_writes
  PERFORM set_config('council.publish_bypass', 'true', true);

  FOR rec IN
    SELECT cv.lesson_id, cv.content_json
    FROM content_versions cv
    WHERE cv.course_id = 'f639a5cf-78ef-4233-8b56-8c612c556ee6'
      AND cv.status = 'approved'
      AND cv.lesson_id IS NOT NULL
      AND cv.content_json IS NOT NULL
      AND length(cv.content_json::text) >= 200
  LOOP
    UPDATE lessons
    SET content = rec.content_json,
        qc_status = 'approved'
    WHERE id = rec.lesson_id;
    v_count := v_count + 1;
  END LOOP;

  -- Reset bypass
  PERFORM set_config('council.publish_bypass', 'false', true);

  RETURN QUERY SELECT v_count;
END;
$$;

-- Execute the repair
SELECT * FROM repair_sync_pka_v2();

-- Clean up - drop the one-time function
DROP FUNCTION repair_sync_pka_v2();
