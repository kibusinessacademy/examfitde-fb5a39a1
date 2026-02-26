-- Publish-Gate + Council Promote RPC (fixed)

-- 1) Publish-Gate RPC
CREATE OR REPLACE FUNCTION public.validate_publish_readiness(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_total_q integer;
  v_approved_q integer;
  v_track text;
  v_min_questions integer := 100;
BEGIN
  SELECT c.curriculum_id, COALESCE(cp.pipeline_mode, 'standard')
  INTO v_curriculum_id, v_track
  FROM course_packages cp
  JOIN courses c ON c.id = cp.course_id
  WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PACKAGE_NOT_FOUND');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'approved')
  INTO v_total_q, v_approved_q
  FROM exam_questions
  WHERE curriculum_id = v_curriculum_id;

  IF v_approved_q = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ZERO_APPROVED_QUESTIONS', 'total_questions', v_total_q, 'approved_questions', v_approved_q);
  END IF;

  IF v_approved_q < v_min_questions THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_APPROVED_QUESTIONS', 'total_questions', v_total_q, 'approved_questions', v_approved_q, 'minimum_required', v_min_questions);
  END IF;

  RETURN jsonb_build_object('ok', true, 'total_questions', v_total_q, 'approved_questions', v_approved_q, 'track', v_track);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_publish_readiness(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_publish_readiness(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.validate_publish_readiness(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.validate_publish_readiness(uuid) TO service_role;

-- 2) Improved promote RPC with counts
CREATE OR REPLACE FUNCTION public.promote_exam_questions_from_council(
  p_curriculum_id uuid,
  p_limit integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted integer;
  v_already_approved integer;
  v_total integer;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'approved'), count(*)
  INTO v_already_approved, v_total
  FROM exam_questions
  WHERE curriculum_id = p_curriculum_id;

  WITH to_promote AS (
    SELECT id FROM exam_questions
    WHERE curriculum_id = p_curriculum_id AND status = 'draft'
    LIMIT p_limit
  ),
  promoted AS (
    UPDATE exam_questions SET status = 'approved', reviewed_at = now()
    WHERE id IN (SELECT id FROM to_promote)
    RETURNING id
  )
  SELECT count(*) INTO v_promoted FROM promoted;

  RETURN jsonb_build_object(
    'ok', true,
    'promoted_count', v_promoted,
    'already_approved', v_already_approved,
    'total_questions', v_total,
    'curriculum_id', p_curriculum_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_exam_questions_from_council(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_exam_questions_from_council(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.promote_exam_questions_from_council(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.promote_exam_questions_from_council(uuid, integer) TO service_role;