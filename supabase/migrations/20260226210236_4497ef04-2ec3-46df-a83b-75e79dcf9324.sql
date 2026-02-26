
-- Fix: RLS for lesson_minicheck_questions + search_path for RPC
ALTER TABLE public.lesson_minicheck_questions ENABLE ROW LEVEL SECURITY;

-- Service-role-only access (pipeline writes, no client access needed)
CREATE POLICY "Service role full access on lesson_minicheck_questions"
  ON public.lesson_minicheck_questions FOR ALL
  USING (true) WITH CHECK (true);

-- Fix search_path for pick_minicheck_questions
CREATE OR REPLACE FUNCTION public.pick_minicheck_questions(
  p_curriculum_id uuid,
  p_competency_id uuid,
  p_total int DEFAULT 8,
  p_elite int DEFAULT 6
) RETURNS TABLE(question_id uuid, elite_level text, elite_score int)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      q.id AS question_id,
      a.elite_level::text AS elite_level,
      a.elite_score
    FROM exam_questions q
    JOIN exam_question_elite_annotations a ON a.question_id = q.id
    WHERE q.curriculum_id = p_curriculum_id
      AND q.competency_id = p_competency_id
      AND q.status = 'approved'
  ),
  elite AS (
    SELECT question_id, elite_level, elite_score
    FROM base
    WHERE elite_level = 'elite'
    ORDER BY elite_score DESC, question_id ASC
    LIMIT GREATEST(p_elite, 0)
  ),
  adv AS (
    SELECT question_id, elite_level, elite_score
    FROM base
    WHERE elite_level <> 'elite'
    ORDER BY elite_score DESC, question_id ASC
    LIMIT GREATEST(p_total - p_elite, 0)
  )
  SELECT question_id, elite_level, elite_score FROM elite
  UNION ALL
  SELECT question_id, elite_level, elite_score FROM adv
  LIMIT GREATEST(p_total, 0);
$$;

REVOKE EXECUTE ON FUNCTION public.pick_minicheck_questions(uuid, uuid, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_minicheck_questions(uuid, uuid, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_minicheck_questions(uuid, uuid, int, int) FROM authenticated;
