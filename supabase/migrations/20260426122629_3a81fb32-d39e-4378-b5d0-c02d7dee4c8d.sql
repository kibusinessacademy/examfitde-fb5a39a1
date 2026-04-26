CREATE OR REPLACE FUNCTION public.admin_minicheck_backfill_chunk(
  p_curriculum_id uuid,
  p_package_id uuid,
  p_limit int DEFAULT 1000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  upd int := 0;
BEGIN
  -- Disable expensive triggers for this transaction only
  ALTER TABLE public.minicheck_questions DISABLE TRIGGER trg_auto_promote_minicheck;
  ALTER TABLE public.minicheck_questions DISABLE TRIGGER trg_guard_minicheck_duplicate;
  ALTER TABLE public.minicheck_questions DISABLE TRIGGER trg_validate_minicheck_mode;
  ALTER TABLE public.minicheck_questions DISABLE TRIGGER trg_autofill_package_id;
  ALTER TABLE public.minicheck_questions DISABLE TRIGGER update_minicheck_questions_updated_at;

  BEGIN
    WITH batch AS (
      SELECT ctid
      FROM public.minicheck_questions
      WHERE curriculum_id = p_curriculum_id
        AND package_id IS NULL
      LIMIT GREATEST(50, LEAST(p_limit, 5000))
    )
    UPDATE public.minicheck_questions mq
    SET package_id = p_package_id
    FROM batch
    WHERE mq.ctid = batch.ctid;
    GET DIAGNOSTICS upd = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    -- Re-enable on failure
    ALTER TABLE public.minicheck_questions ENABLE TRIGGER trg_auto_promote_minicheck;
    ALTER TABLE public.minicheck_questions ENABLE TRIGGER trg_guard_minicheck_duplicate;
    ALTER TABLE public.minicheck_questions ENABLE TRIGGER trg_validate_minicheck_mode;
    ALTER TABLE public.minicheck_questions ENABLE TRIGGER trg_autofill_package_id;
    ALTER TABLE public.minicheck_questions ENABLE TRIGGER update_minicheck_questions_updated_at;
    RAISE;
  END;

  ALTER TABLE public.minicheck_questions ENABLE TRIGGER trg_auto_promote_minicheck;
  ALTER TABLE public.minicheck_questions ENABLE TRIGGER trg_guard_minicheck_duplicate;
  ALTER TABLE public.minicheck_questions ENABLE TRIGGER trg_validate_minicheck_mode;
  ALTER TABLE public.minicheck_questions ENABLE TRIGGER trg_autofill_package_id;
  ALTER TABLE public.minicheck_questions ENABLE TRIGGER update_minicheck_questions_updated_at;

  RETURN upd;
END $$;