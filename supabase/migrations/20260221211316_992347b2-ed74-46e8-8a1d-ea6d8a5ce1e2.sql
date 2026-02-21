
-- Atomic promotion RPC for quality council
CREATE OR REPLACE FUNCTION public.promote_exam_questions_from_council(
  p_curriculum_id uuid,
  p_limit integer DEFAULT 2000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted int := 0;
  v_already int := 0;
  v_draft_remaining int := 0;
BEGIN
  -- Promote: draft → approved (status enum)
  WITH candidates AS (
    SELECT id
    FROM public.exam_questions
    WHERE curriculum_id = p_curriculum_id
      AND status = 'draft'
    ORDER BY updated_at DESC
    LIMIT p_limit
  ),
  upd AS (
    UPDATE public.exam_questions q
    SET
      status = 'approved',
      qc_status = 'approved',
      updated_at = now()
    FROM candidates c
    WHERE q.id = c.id
    RETURNING 1
  )
  SELECT count(*) INTO v_promoted FROM upd;

  -- Count already approved
  SELECT count(*) INTO v_already
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id AND status = 'approved';

  -- Count remaining drafts
  SELECT count(*) INTO v_draft_remaining
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id AND status = 'draft';

  RETURN jsonb_build_object(
    'promoted', v_promoted,
    'total_approved', v_already,
    'draft_remaining', v_draft_remaining
  );
END;
$$;

-- Only service_role can call this
REVOKE ALL ON FUNCTION public.promote_exam_questions_from_council(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.promote_exam_questions_from_council(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.promote_exam_questions_from_council(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.promote_exam_questions_from_council(uuid, integer) TO service_role;
