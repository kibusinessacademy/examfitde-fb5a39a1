
-- Gap-Matrix RPC for Bloom/Difficulty/Coverage analysis
CREATE OR REPLACE FUNCTION public.get_exam_pool_gap_report(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_total int;
  v_bloom jsonb;
  v_diff jsonb;
  v_comp_gaps jsonb;
  v_bloom_gaps jsonb;
  v_diff_gaps jsonb;
  bloom_targets jsonb := '{"remember":0.20,"understand":0.20,"apply":0.35,"analyze":0.20,"evaluate":0.05}'::jsonb;
  diff_targets jsonb := '{"easy":0.10,"medium":0.55,"hard":0.30,"very_hard":0.05}'::jsonb;
BEGIN
  SELECT count(*) INTO v_total
  FROM exam_questions
  WHERE curriculum_id = p_curriculum_id AND status = 'approved';

  SELECT COALESCE(jsonb_object_agg(cognitive_level, cnt), '{}'::jsonb) INTO v_bloom
  FROM (
    SELECT cognitive_level, count(*) as cnt
    FROM exam_questions
    WHERE curriculum_id = p_curriculum_id AND status = 'approved' AND cognitive_level IS NOT NULL
    GROUP BY cognitive_level
  ) sub;

  SELECT COALESCE(jsonb_object_agg(difficulty, cnt), '{}'::jsonb) INTO v_diff
  FROM (
    SELECT difficulty, count(*) as cnt
    FROM exam_questions
    WHERE curriculum_id = p_curriculum_id AND status = 'approved' AND difficulty IS NOT NULL
    GROUP BY difficulty
  ) sub;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('competency_id', comp_id, 'approved_count', approved_count)), '[]'::jsonb) INTO v_comp_gaps
  FROM (
    SELECT c.id as comp_id, (SELECT count(*) FROM exam_questions eq WHERE eq.competency_id = c.id AND eq.status = 'approved') as approved_count
    FROM competencies c
    WHERE c.curriculum_id = p_curriculum_id
      AND (SELECT count(*) FROM exam_questions eq WHERE eq.competency_id = c.id AND eq.status = 'approved') < 3
    ORDER BY approved_count ASC
    LIMIT 50
  ) sub;

  SELECT COALESCE(jsonb_object_agg(bl, GREATEST(0, target_count - actual_count)), '{}'::jsonb) INTO v_bloom_gaps
  FROM (
    SELECT key as bl,
           CEIL((value::text)::numeric * GREATEST(v_total, 100))::int as target_count,
           COALESCE((v_bloom->>key)::int, 0) as actual_count
    FROM jsonb_each(bloom_targets)
  ) gap_calc
  WHERE target_count > actual_count;

  SELECT COALESCE(jsonb_object_agg(df, GREATEST(0, target_count - actual_count)), '{}'::jsonb) INTO v_diff_gaps
  FROM (
    SELECT key as df,
           CEIL((value::text)::numeric * GREATEST(v_total, 100))::int as target_count,
           COALESCE((v_diff->>key)::int, 0) as actual_count
    FROM jsonb_each(diff_targets)
  ) gap_calc
  WHERE target_count > actual_count;

  result := jsonb_build_object(
    'curriculum_id', p_curriculum_id,
    'total_approved', v_total,
    'bloom_actual', v_bloom,
    'bloom_targets', bloom_targets,
    'bloom_gaps', v_bloom_gaps,
    'difficulty_actual', v_diff,
    'difficulty_targets', diff_targets,
    'difficulty_gaps', v_diff_gaps,
    'competency_gaps', v_comp_gaps,
    'analyzed_at', now()
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_exam_pool_gap_report(uuid) TO authenticated, service_role;
