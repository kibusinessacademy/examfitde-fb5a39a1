
CREATE OR REPLACE FUNCTION public.oral_curriculum_readiness(p_curriculum_id uuid)
RETURNS TABLE(curriculum_id uuid, has_blueprints boolean, blueprint_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_curriculum_id AS curriculum_id,
    COALESCE(COUNT(b.id), 0) > 0 AS has_blueprints,
    COALESCE(COUNT(b.id), 0)::int AS blueprint_count
  FROM public.oral_exam_blueprints b
  JOIN public.competencies c ON c.id = b.competency_id
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = p_curriculum_id
    AND b.status = 'approved'
$$;

GRANT EXECUTE ON FUNCTION public.oral_curriculum_readiness(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.oral_curricula_readiness_bulk(p_curriculum_ids uuid[])
RETURNS TABLE(curriculum_id uuid, has_blueprints boolean, blueprint_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lf.curriculum_id,
    COUNT(b.id) > 0 AS has_blueprints,
    COUNT(b.id)::int AS blueprint_count
  FROM public.oral_exam_blueprints b
  JOIN public.competencies c ON c.id = b.competency_id
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = ANY(p_curriculum_ids)
    AND b.status = 'approved'
  GROUP BY lf.curriculum_id
$$;

GRANT EXECUTE ON FUNCTION public.oral_curricula_readiness_bulk(uuid[]) TO anon, authenticated, service_role;
