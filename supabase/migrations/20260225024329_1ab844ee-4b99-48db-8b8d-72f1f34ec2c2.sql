
-- 1) Fix get_lesson_minichecks: remove explanation leak
CREATE OR REPLACE FUNCTION public.get_lesson_minichecks(p_lesson_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', mq.id,
      'text', mq.question_text,
      'options', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', (idx - 1),
            'text', elem->>'text'
          )
          ORDER BY idx
        )
        FROM jsonb_array_elements(mq.options) WITH ORDINALITY AS t(elem, idx)
      ),
      'difficulty', mq.difficulty,
      'cognitive_level', mq.cognitive_level
    )
    ORDER BY mq.sort_order NULLS LAST, mq.created_at
  )
  INTO v_result
  FROM public.minicheck_questions mq
  WHERE mq.lesson_id = p_lesson_id
    AND mq.mode = 'lesson'
    AND mq.status IN ('approved', 'draft');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 2) Fix get_drill_minichecks: remove double ORDER BY random()
CREATE OR REPLACE FUNCTION public.get_drill_minichecks(
  p_curriculum_id uuid,
  p_competency_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(q)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', mq.id,
      'text', mq.question_text,
      'options', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', (idx - 1),
            'text', elem->>'text'
          )
          ORDER BY idx
        )
        FROM jsonb_array_elements(mq.options) WITH ORDINALITY AS t(elem, idx)
      ),
      'difficulty', mq.difficulty,
      'cognitive_level', mq.cognitive_level,
      'competency_id', mq.competency_id
    ) AS q
    FROM public.minicheck_questions mq
    WHERE mq.curriculum_id = p_curriculum_id
      AND mq.mode = 'drill'
      AND mq.status IN ('approved', 'draft')
      AND (p_competency_id IS NULL OR mq.competency_id = p_competency_id)
    ORDER BY random()
    LIMIT p_limit
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- 3) SSOT RPC: list_curriculum_competencies (replaces direct table reads in DrillSession)
CREATE OR REPLACE FUNCTION public.list_curriculum_competencies(p_curriculum_id uuid)
RETURNS TABLE(id uuid, title text)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.title
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = p_curriculum_id
  ORDER BY c.title;
$$;
