CREATE OR REPLACE FUNCTION public.get_exam_question_counts_by_lf(
  p_curriculum_id uuid,
  p_lf_ids uuid[]
)
RETURNS TABLE(learning_field_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT eq.learning_field_id, count(*) AS cnt
  FROM exam_questions eq
  WHERE eq.curriculum_id = p_curriculum_id
    AND eq.learning_field_id = ANY(p_lf_ids)
    AND eq.status != 'rejected'
  GROUP BY eq.learning_field_id;
$$;