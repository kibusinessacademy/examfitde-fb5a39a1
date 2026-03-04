
-- 1) RPC: Batch-Repriorisierung (gestaffelter Rollout)
CREATE OR REPLACE FUNCTION public.reprioritize_queued_exam_first(
  p_batch_size int DEFAULT 20,
  p_new_priority int DEFAULT 8
)
RETURNS TABLE (package_id uuid, old_priority int, applied_priority int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH next_batch AS (
    SELECT id, priority AS old_prio
    FROM public.course_packages
    WHERE status = 'queued'
      AND track = 'EXAM_FIRST'
      AND priority > 10
    ORDER BY created_at ASC
    LIMIT p_batch_size
  ),
  updated AS (
    UPDATE public.course_packages cp
    SET priority = p_new_priority,
        updated_at = now()
    FROM next_batch nb
    WHERE cp.id = nb.id
    RETURNING cp.id, nb.old_prio, cp.priority
  )
  SELECT u.id AS package_id, u.old_prio AS old_priority, u.priority AS applied_priority
  FROM updated u;
END;
$$;

REVOKE ALL ON FUNCTION public.reprioritize_queued_exam_first(int,int) FROM PUBLIC;

-- 2) DB-Backstop: Neue EXAM_FIRST Pakete bekommen automatisch priority=8
CREATE OR REPLACE FUNCTION public.tg_default_priority_for_exam_first()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'queued'
     AND NEW.track = 'EXAM_FIRST'
     AND (NEW.priority IS NULL OR NEW.priority >= 100) THEN
    NEW.priority := 8;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_priority_exam_first ON public.course_packages;

CREATE TRIGGER trg_default_priority_exam_first
BEFORE INSERT ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.tg_default_priority_for_exam_first();
