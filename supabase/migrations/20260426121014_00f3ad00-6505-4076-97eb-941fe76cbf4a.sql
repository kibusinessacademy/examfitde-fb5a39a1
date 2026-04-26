-- Helper RPC #1: list curricula with NULL package_id rows + count
CREATE OR REPLACE FUNCTION public.admin_minicheck_pending_curricula()
RETURNS TABLE(curriculum_id uuid, missing bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mq.curriculum_id, COUNT(*)::bigint AS missing
  FROM public.minicheck_questions mq
  WHERE mq.package_id IS NULL
  GROUP BY mq.curriculum_id
  ORDER BY COUNT(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_minicheck_pending_curricula() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_minicheck_pending_curricula() TO service_role;

-- Helper RPC #2: chunked backfill (returns rows updated)
CREATE OR REPLACE FUNCTION public.admin_minicheck_backfill_chunk(
  p_curriculum_id uuid,
  p_package_id uuid,
  p_limit int DEFAULT 2000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  upd int := 0;
BEGIN
  WITH batch AS (
    SELECT ctid
    FROM public.minicheck_questions
    WHERE curriculum_id = p_curriculum_id
      AND package_id IS NULL
    LIMIT GREATEST(100, LEAST(p_limit, 5000))
  )
  UPDATE public.minicheck_questions mq
  SET package_id = p_package_id
  FROM batch
  WHERE mq.ctid = batch.ctid;

  GET DIAGNOSTICS upd = ROW_COUNT;
  RETURN upd;
END $$;

REVOKE ALL ON FUNCTION public.admin_minicheck_backfill_chunk(uuid, uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_minicheck_backfill_chunk(uuid, uuid, int) TO service_role;