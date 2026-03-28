
CREATE OR REPLACE FUNCTION public.get_adaptive_oral_exam_prompts(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_limit int DEFAULT 6
)
RETURNS TABLE(
  competency_id uuid,
  competency_title text,
  learning_field_title text,
  mastery_level text,
  prompt_weight int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS competency_id,
    c.title AS competency_title,
    lf.title AS learning_field_title,
    COALESCE(ucp.mastery_level, 'not_mastered') AS mastery_level,
    CASE
      WHEN COALESCE(ucp.mastery_level, 'not_mastered') = 'not_mastered' THEN 1
      WHEN ucp.mastery_level = 'partial' THEN 2
      ELSE 3
    END AS prompt_weight
  FROM public.competencies c
  JOIN public.learning_fields lf
    ON lf.id = c.learning_field_id
  LEFT JOIN public.user_competency_progress ucp
    ON ucp.user_id = p_user_id
   AND ucp.competency_id = c.id
  WHERE lf.curriculum_id = p_curriculum_id
  ORDER BY
    CASE
      WHEN COALESCE(ucp.mastery_level, 'not_mastered') = 'not_mastered' THEN 1
      WHEN ucp.mastery_level = 'partial' THEN 2
      ELSE 3
    END,
    random()
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_adaptive_oral_exam_prompts(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_adaptive_oral_exam_prompts(uuid, uuid, int) TO authenticated, service_role;
