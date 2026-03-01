
-- FIX: Auto-sync approved content_versions → lessons.content
-- Corrected: lessons table has no updated_at column

-- 1) Helper view
CREATE OR REPLACE VIEW public.v_latest_lesson_content AS
SELECT DISTINCT ON (cv.lesson_id)
  cv.lesson_id,
  cv.id AS content_version_id,
  cv.status,
  cv.content_json,
  cv.quality_score,
  cv.created_at
FROM public.content_versions cv
WHERE cv.lesson_id IS NOT NULL
ORDER BY cv.lesson_id, cv.created_at DESC;

-- 2) Sync function
CREATE OR REPLACE FUNCTION public.sync_lesson_content_on_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' 
     AND NEW.lesson_id IS NOT NULL 
     AND NEW.content_json IS NOT NULL 
     AND length(NEW.content_json::text) > 200 
  THEN
    PERFORM set_config('council.publish_bypass', 'true', true);

    UPDATE public.lessons
    SET content = NEW.content_json,
        qc_status = 'approved'
    WHERE id = NEW.lesson_id;

    UPDATE public.content_versions
    SET status = 'published',
        published_at = now(),
        published_by = 'auto_sync_trigger'
    WHERE id = NEW.id
      AND status = 'approved';

    PERFORM set_config('council.publish_bypass', 'false', true);
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Trigger
DROP TRIGGER IF EXISTS trg_sync_lesson_content_on_approve ON public.content_versions;

CREATE TRIGGER trg_sync_lesson_content_on_approve
AFTER INSERT OR UPDATE OF status
ON public.content_versions
FOR EACH ROW
WHEN (NEW.status = 'approved')
EXECUTE FUNCTION public.sync_lesson_content_on_approve();

-- 4) Backfill existing approved versions
DO $$
DECLARE
  synced_count integer := 0;
BEGIN
  PERFORM set_config('council.publish_bypass', 'true', true);
  
  WITH latest_approved AS (
    SELECT DISTINCT ON (cv.lesson_id)
      cv.lesson_id,
      cv.id AS version_id,
      cv.content_json
    FROM public.content_versions cv
    WHERE cv.status IN ('approved', 'published')
      AND cv.lesson_id IS NOT NULL
      AND cv.content_json IS NOT NULL
      AND length(cv.content_json::text) > 200
    ORDER BY cv.lesson_id, cv.created_at DESC
  )
  UPDATE public.lessons l
  SET content = la.content_json,
      qc_status = 'approved'
  FROM latest_approved la
  WHERE l.id = la.lesson_id
    AND (l.content IS NULL OR length(l.content::text) < 200);
  
  GET DIAGNOSTICS synced_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled % lessons with approved content', synced_count;
  
  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$$;
