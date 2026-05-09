
CREATE OR REPLACE FUNCTION public.learner_next_best_step(p_course_id uuid, p_limit int DEFAULT 5)
RETURNS TABLE(
  competency_id uuid,
  competency_title text,
  recommended_action text,
  exam_readiness numeric,
  mastery_score numeric,
  decay_score numeric,
  priority_score numeric,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  RETURN QUERY
    WITH base AS (
      SELECT s.competency_id, c.title AS competency_title,
             s.exam_readiness, s.mastery_score, s.decay_score, s.samples_total
        FROM public.learner_competency_state s
        LEFT JOIN public.competencies c ON c.id = s.competency_id
       WHERE s.user_id = v_user AND s.course_id = p_course_id
    ),
    scored AS (
      SELECT b.*,
        CASE
          WHEN b.mastery_score < 60 THEN 'REPAIR'
          WHEN b.mastery_score < 80 THEN 'DRILL'
          WHEN b.mastery_score < 90 THEN 'REINFORCE'
          ELSE 'CHALLENGE'
        END AS recommended_action,
        ROUND((
          (100 - b.exam_readiness)
          + CASE WHEN b.decay_score < 50 THEN (50 - b.decay_score) ELSE 0 END
          + CASE WHEN b.samples_total < 3 THEN 15 ELSE 0 END
        )::numeric, 2) AS priority_score,
        CASE
          WHEN b.mastery_score < 60 THEN 'low_mastery'
          WHEN b.decay_score < 50 THEN 'high_decay'
          WHEN b.samples_total < 3 THEN 'low_evidence'
          WHEN b.mastery_score < 80 THEN 'consolidation_needed'
          ELSE 'enrichment'
        END AS reason
      FROM base b
    )
    SELECT s.competency_id, s.competency_title, s.recommended_action,
           s.exam_readiness, s.mastery_score, s.decay_score, s.priority_score, s.reason
      FROM scored s
     ORDER BY s.priority_score DESC
     LIMIT GREATEST(LEAST(p_limit, 20), 1);
END $$;

GRANT EXECUTE ON FUNCTION public.learner_next_best_step(uuid, int) TO authenticated;
