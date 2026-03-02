
-- 1) Add INSERT trigger for sync (existing function, just also fires on INSERT)
DROP TRIGGER IF EXISTS trg_sync_lesson_content_on_approve_insert ON public.content_versions;

CREATE TRIGGER trg_sync_lesson_content_on_approve_insert
  AFTER INSERT ON public.content_versions
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION public.sync_lesson_content_on_approve();

-- 2) Backfill helper: approve existing under_review pipeline versions (service_role only)
CREATE OR REPLACE FUNCTION public.backfill_approve_pipeline_content_versions(p_limit int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH picked AS (
    SELECT id
    FROM public.content_versions
    WHERE status = 'under_review'
      AND created_by_agent IN ('generate-learning-content', 'repair-lessons', 'heal-poison-lessons', 'regenerate-minichecks')
    ORDER BY created_at ASC NULLS LAST
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.content_versions cv
  SET status = 'approved',
      published_at = COALESCE(cv.published_at, NOW()),
      published_by = COALESCE(cv.published_by, 'backfill_auto_approve')
  FROM picked
  WHERE cv.id = picked.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_approve_pipeline_content_versions(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_approve_pipeline_content_versions(int) TO service_role;
