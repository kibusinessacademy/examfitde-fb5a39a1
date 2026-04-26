CREATE OR REPLACE FUNCTION public.admin_minicheck_backfill_chunk(
  p_curriculum_id uuid,
  p_package_id uuid,
  p_limit int DEFAULT 500
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  upd int := 0;
BEGIN
  -- Pause non-essential triggers (autofill not needed: we set package_id explicitly; quality_guard not needed: we don't change content)
  PERFORM set_config('session_replication_role', 'replica', true);

  WITH batch AS (
    SELECT ctid
    FROM public.minicheck_questions
    WHERE curriculum_id = p_curriculum_id
      AND package_id IS NULL
    LIMIT GREATEST(50, LEAST(p_limit, 2000))
  )
  UPDATE public.minicheck_questions mq
  SET package_id = p_package_id
  FROM batch
  WHERE mq.ctid = batch.ctid;

  GET DIAGNOSTICS upd = ROW_COUNT;

  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN upd;
END $$;