
-- P2 helper: pick_minicheck_elite (fix reserved word "position")
CREATE OR REPLACE FUNCTION public.pick_minicheck_elite(
  p_competency_id uuid,
  p_total int DEFAULT 8,
  p_min_elite int DEFAULT 5
)
RETURNS TABLE(exam_question_id uuid, elite_level text, score numeric, sort_pos int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH elite_pool AS (
    SELECT eq.id, eq.elite_level_eff, eq.score_eff
    FROM exam_questions_elite_v eq
    WHERE eq.competency_id = p_competency_id
      AND eq.status = 'approved'
      AND eq.elite_level_eff IN ('elite', 'advanced')
    ORDER BY eq.score_eff DESC NULLS LAST, random()
    LIMIT p_min_elite
  ),
  remaining AS (
    SELECT eq.id, eq.elite_level_eff, eq.score_eff
    FROM exam_questions_elite_v eq
    WHERE eq.competency_id = p_competency_id
      AND eq.status = 'approved'
      AND eq.id NOT IN (SELECT ep.id FROM elite_pool ep)
    ORDER BY eq.score_eff DESC NULLS LAST, random()
    LIMIT GREATEST(0, p_total - (SELECT count(*) FROM elite_pool))
  ),
  combined AS (
    SELECT * FROM elite_pool
    UNION ALL
    SELECT * FROM remaining
  )
  SELECT c.id, c.elite_level_eff::text, c.score_eff, row_number() OVER (ORDER BY random())::int
  FROM combined c;
END;
$$;

REVOKE ALL ON FUNCTION public.pick_minicheck_elite FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_minicheck_elite TO service_role;
