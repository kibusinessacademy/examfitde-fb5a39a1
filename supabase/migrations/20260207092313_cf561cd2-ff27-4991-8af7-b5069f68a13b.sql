-- P0.3: Function to get lesson recommendations based on exam weaknesses
-- Links exam failures through competency_id to recommended lessons

CREATE OR REPLACE FUNCTION public.get_exam_lesson_recommendations(
  p_session_id uuid
)
RETURNS TABLE (
  competency_id uuid,
  competency_code text,
  competency_title text,
  learning_field_code text,
  learning_field_title text,
  correct_count integer,
  total_count integer,
  score_percent numeric,
  recommended_lessons jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH session_stats AS (
    -- Aggregate per competency from session questions
    SELECT 
      c.id as comp_id,
      c.code as comp_code,
      c.title as comp_title,
      lf.code as lf_code,
      lf.title as lf_title,
      COUNT(*) FILTER (WHERE esq.is_correct = true)::integer as correct,
      COUNT(*)::integer as total
    FROM exam_session_questions esq
    JOIN exam_questions eq ON eq.id = esq.question_id
    LEFT JOIN competencies c ON c.id = eq.competency_id
    LEFT JOIN learning_fields lf ON lf.id = eq.learning_field_id
    WHERE esq.exam_session_id = p_session_id
      AND eq.competency_id IS NOT NULL
    GROUP BY c.id, c.code, c.title, lf.code, lf.title
  ),
  weak_competencies AS (
    -- Filter to competencies with score < 70%
    SELECT 
      ss.*,
      ROUND((ss.correct::numeric / NULLIF(ss.total, 0)) * 100, 1) as score_pct
    FROM session_stats ss
    WHERE (ss.correct::numeric / NULLIF(ss.total, 0)) < 0.7
  ),
  lesson_recs AS (
    -- Find lessons for each weak competency
    SELECT 
      wc.comp_id,
      jsonb_agg(
        jsonb_build_object(
          'lesson_id', l.id,
          'lesson_title', l.title,
          'module_title', m.title,
          'course_id', c.id,
          'course_title', c.title,
          'step', l.step
        )
        ORDER BY m.sort_order, l.sort_order
      ) as lessons
    FROM weak_competencies wc
    JOIN lessons l ON l.competency_id = wc.comp_id
    JOIN modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    WHERE c.status = 'published'
    GROUP BY wc.comp_id
  )
  SELECT 
    wc.comp_id as competency_id,
    wc.comp_code as competency_code,
    wc.comp_title as competency_title,
    wc.lf_code as learning_field_code,
    wc.lf_title as learning_field_title,
    wc.correct as correct_count,
    wc.total as total_count,
    wc.score_pct as score_percent,
    COALESCE(lr.lessons, '[]'::jsonb) as recommended_lessons
  FROM weak_competencies wc
  LEFT JOIN lesson_recs lr ON lr.comp_id = wc.comp_id
  ORDER BY wc.score_pct ASC, wc.total DESC;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_exam_lesson_recommendations(uuid) TO authenticated;