
-- SSOT-Diagnostic-Set: max 10 approved exam_questions, 1 pro Kompetenz, sortiert nach exam_relevance_tier + sort_order.
-- SECURITY DEFINER: liest nur aus published packages + approved/tier1_passed questions, kein Schreibzugriff.
-- Liefert Question-Stem + Options + correct_answer + competency-Kontext, damit die Marketing-Seite ohne Auth arbeiten kann.

CREATE OR REPLACE FUNCTION public.fn_get_pruefungsreife_diagnostic_set(
  p_package_id uuid,
  p_limit int DEFAULT 8
)
RETURNS TABLE (
  question_id uuid,
  competency_id uuid,
  competency_title text,
  learning_field_id uuid,
  question_text text,
  options jsonb,
  correct_answer int,
  blueprint_id uuid,
  exam_relevance_tier text,
  sort_order int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pkg AS (
    SELECT cp.id AS package_id, cp.curriculum_id
    FROM public.course_packages cp
    WHERE cp.id = p_package_id
      AND cp.status = 'published'
      AND cp.curriculum_id IS NOT NULL
    LIMIT 1
  ),
  ranked AS (
    SELECT
      eq.id AS question_id,
      eq.competency_id,
      c.title AS competency_title,
      c.learning_field_id,
      eq.question_text,
      eq.options,
      eq.correct_answer,
      eq.blueprint_id,
      c.exam_relevance_tier,
      c.sort_order,
      ROW_NUMBER() OVER (
        PARTITION BY eq.competency_id
        ORDER BY
          CASE WHEN eq.item_difficulty BETWEEN 0.4 AND 0.7 THEN 0 ELSE 1 END,
          COALESCE(eq.item_usage_count, 0) ASC,
          eq.created_at DESC
      ) AS rn_per_competency
    FROM pkg
    JOIN public.exam_questions eq ON eq.curriculum_id = pkg.curriculum_id
    JOIN public.competencies c ON c.id = eq.competency_id
    WHERE eq.qc_status IN ('approved','tier1_passed')
      AND eq.question_text IS NOT NULL
      AND eq.options IS NOT NULL
      AND eq.correct_answer IS NOT NULL
      AND jsonb_typeof(eq.options) = 'array'
      AND jsonb_array_length(eq.options) >= 2
      AND eq.competency_id IS NOT NULL
  )
  SELECT
    question_id,
    competency_id,
    competency_title,
    learning_field_id,
    question_text,
    options,
    correct_answer,
    blueprint_id,
    exam_relevance_tier,
    sort_order
  FROM ranked
  WHERE rn_per_competency = 1
  ORDER BY
    CASE exam_relevance_tier
      WHEN 'tier_1' THEN 0
      WHEN 'tier_2' THEN 1
      WHEN 'tier_3' THEN 2
      ELSE 3
    END,
    sort_order NULLS LAST,
    competency_title
  LIMIT GREATEST(LEAST(COALESCE(p_limit, 8), 10), 4);
$$;

REVOKE ALL ON FUNCTION public.fn_get_pruefungsreife_diagnostic_set(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_pruefungsreife_diagnostic_set(uuid, int) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.fn_get_pruefungsreife_diagnostic_set(uuid, int) IS
  'Berufsspezifische Pruefungsreife-Diagnostik: max 10 approved exam_questions pro published package, 1 pro Kompetenz, sortiert nach exam_relevance_tier. SSOT-Quelle fuer den kostenlosen Pruefungsreife-Check. Kein Schreibzugriff.';
