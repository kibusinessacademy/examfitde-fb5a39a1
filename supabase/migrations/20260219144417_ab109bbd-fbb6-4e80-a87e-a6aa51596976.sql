
CREATE OR REPLACE FUNCTION public.get_package_question_counts(p_curriculum_ids uuid[])
RETURNS TABLE(curriculum_id uuid, total bigint, approved bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 
    eq.curriculum_id,
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE eq.status = 'approved') as approved
  FROM public.exam_questions eq
  WHERE eq.curriculum_id = ANY(p_curriculum_ids)
  GROUP BY eq.curriculum_id;
$$;
