
DROP FUNCTION IF EXISTS public.get_shuttle_next_question(UUID, UUID, UUID);

CREATE FUNCTION public.get_shuttle_next_question(
  p_user_id UUID,
  p_curriculum_id UUID,
  p_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
  question_id UUID,
  question_text TEXT,
  question_type TEXT,
  options JSONB,
  competency_id UUID,
  blueprint_id UUID,
  difficulty TEXT,
  trap_type TEXT,
  explanation TEXT,
  distractor_meta JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_ids UUID[];
BEGIN
  IF p_session_id IS NOT NULL THEN
    SELECT ARRAY_AGG(sub.question_id)
    INTO v_recent_ids
    FROM (
      SELECT se2.question_id
      FROM shuttle_events se2
      WHERE se2.session_id = p_session_id
      ORDER BY se2.created_at DESC
      LIMIT 10
    ) sub;
  END IF;

  IF v_recent_ids IS NULL THEN
    v_recent_ids := ARRAY[]::UUID[];
  END IF;

  RETURN QUERY
  SELECT
    eq.id AS question_id,
    eq.question_text,
    eq.question_type,
    eq.options,
    eq.competency_id,
    eq.blueprint_id,
    eq.difficulty::TEXT,
    COALESCE(eq.trap_tags[1], NULL) AS trap_type,
    eq.explanation,
    eq.distractor_meta
  FROM exam_questions eq
  LEFT JOIN user_competency_progress ucp
    ON ucp.competency_id = eq.competency_id
    AND ucp.user_id = p_user_id
    AND ucp.curriculum_id = p_curriculum_id
  WHERE eq.curriculum_id = p_curriculum_id
    AND eq.status IN ('approved', 'tier1_passed')
    AND NOT (eq.id = ANY(v_recent_ids))
  ORDER BY
    CASE
      WHEN ucp.mastery_level = 'not_mastered' THEN 0
      WHEN ucp.mastery_level = 'partial' THEN 1
      WHEN ucp.mastery_level IS NULL THEN 2
      ELSE 3
    END ASC,
    CASE WHEN eq.blueprint_id IS NOT NULL THEN 0 ELSE 1 END ASC,
    COALESCE(
      (SELECT MAX(se3.created_at) FROM shuttle_events se3
       JOIN shuttle_sessions ss ON ss.id = se3.session_id
       WHERE se3.question_id = eq.id AND ss.user_id = p_user_id),
      '1970-01-01'::TIMESTAMPTZ
    ) ASC,
    RANDOM()
  LIMIT 1;
END;
$$;
