CREATE OR REPLACE FUNCTION public.get_approved_question_counts(p_curriculum_ids uuid[])
RETURNS TABLE(curriculum_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT eq.curriculum_id, COUNT(*)::bigint
  FROM exam_questions eq
  WHERE eq.curriculum_id = ANY(p_curriculum_ids)
    AND eq.status = 'approved'
  GROUP BY eq.curriculum_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_approved_question_counts(uuid[]) TO anon, authenticated;