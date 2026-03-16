
-- Fix claim_lessons_for_shard: use lesson_ids array instead of limit-based claiming
CREATE OR REPLACE FUNCTION public.claim_lessons_for_shard(
  p_lesson_ids uuid[],
  p_job_id uuid
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT l.id
    FROM public.lessons l
    WHERE l.id = ANY(p_lesson_ids)
      AND COALESCE(l.generation_status, 'pending') IN ('pending', 'failed')
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.lessons l
    SET
      generation_status = 'claimed',
      generation_job_id = p_job_id,
      generation_claimed_at = now()
    FROM candidate c
    WHERE l.id = c.id
    RETURNING l.id
  )
  SELECT upd.id FROM upd;
END;
$$;
