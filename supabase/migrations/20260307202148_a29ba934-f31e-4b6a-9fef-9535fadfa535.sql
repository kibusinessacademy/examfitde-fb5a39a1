
-- Verification audit RPC for session breakdown integrity
CREATE OR REPLACE FUNCTION public.audit_session_breakdown(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_questions int;
  v_mapped_skill_questions int;
  v_mapped_comp_questions int;
  v_unmapped_question_ids uuid[];
  v_skill_breakdown_sum int;
  v_comp_breakdown_sum int;
  v_breakdown jsonb;
BEGIN
  -- Total questions in session
  SELECT count(*) INTO v_total_questions
  FROM public.exam_session_questions WHERE exam_session_id = p_session_id;

  -- Questions with skill mapping via question_skill_map
  SELECT count(DISTINCT esq.id) INTO v_mapped_skill_questions
  FROM public.exam_session_questions esq
  JOIN public.question_skill_map qsm ON qsm.question_id = esq.question_id
  WHERE esq.exam_session_id = p_session_id;

  -- Questions with competency mapping
  SELECT count(*) INTO v_mapped_comp_questions
  FROM public.exam_session_questions
  WHERE exam_session_id = p_session_id AND competency_code IS NOT NULL AND competency_code != '';

  -- Unmapped question IDs (no skill mapping)
  SELECT array_agg(esq.question_id) INTO v_unmapped_question_ids
  FROM public.exam_session_questions esq
  LEFT JOIN public.question_skill_map qsm ON qsm.question_id = esq.question_id
  WHERE esq.exam_session_id = p_session_id AND qsm.id IS NULL;

  -- Stored breakdown sums
  SELECT breakdown INTO v_breakdown FROM public.exam_sessions WHERE id = p_session_id;

  SELECT coalesce(sum((value->>'total')::int), 0) INTO v_skill_breakdown_sum
  FROM jsonb_each(v_breakdown->'by_skill_node');

  SELECT coalesce(sum((value->>'total')::int), 0) INTO v_comp_breakdown_sum
  FROM jsonb_each(v_breakdown->'by_competency');

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'total_questions', v_total_questions,
    'skill_mapped_questions', v_mapped_skill_questions,
    'competency_mapped_questions', v_mapped_comp_questions,
    'unmapped_question_count', coalesce(array_length(v_unmapped_question_ids, 1), 0),
    'unmapped_question_ids', coalesce(to_jsonb(v_unmapped_question_ids), '[]'::jsonb),
    'breakdown_by_skill_node_sum', v_skill_breakdown_sum,
    'breakdown_by_competency_sum', v_comp_breakdown_sum,
    'skill_coverage_pct', CASE WHEN v_total_questions > 0 THEN round(v_mapped_skill_questions::numeric / v_total_questions * 100, 1) ELSE 0 END,
    'is_healthy', (v_mapped_skill_questions = v_total_questions AND v_total_questions > 0)
  );
END;
$$;
