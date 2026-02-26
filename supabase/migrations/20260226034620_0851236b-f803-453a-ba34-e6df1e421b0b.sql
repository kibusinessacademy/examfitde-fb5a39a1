
-- Create the missing RPC that the Quality Council calls to promote draft → approved
CREATE OR REPLACE FUNCTION public.promote_exam_questions_from_council(
  p_curriculum_id UUID,
  p_limit INT DEFAULT 2000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted INT;
  v_total_approved INT;
  v_draft_remaining INT;
BEGIN
  -- Promote draft questions to approved
  WITH candidates AS (
    SELECT id FROM exam_questions
    WHERE curriculum_id = p_curriculum_id AND status = 'draft'
    ORDER BY created_at
    LIMIT p_limit
  ),
  promoted AS (
    UPDATE exam_questions eq
    SET status = 'approved'
    FROM candidates c
    WHERE eq.id = c.id
    RETURNING eq.id
  )
  SELECT COUNT(*) INTO v_promoted FROM promoted;

  SELECT COUNT(*) INTO v_total_approved
  FROM exam_questions
  WHERE curriculum_id = p_curriculum_id AND status = 'approved';

  SELECT COUNT(*) INTO v_draft_remaining
  FROM exam_questions
  WHERE curriculum_id = p_curriculum_id AND status = 'draft';

  RETURN jsonb_build_object(
    'promoted', v_promoted,
    'total_approved', v_total_approved,
    'draft_remaining', v_draft_remaining
  );
END;
$$;
