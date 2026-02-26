
-- ═══════════════════════════════════════════════════════════════
-- PR2: SSOT MiniCheck Selection + User Mastery
-- ═══════════════════════════════════════════════════════════════

-- 1) lesson_minicheck_questions: SSOT linkage from minichecks to approved exam_questions
CREATE TABLE IF NOT EXISTS public.lesson_minicheck_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minicheck_id uuid NOT NULL REFERENCES public.minicheck_questions(id) ON DELETE CASCADE,
  exam_question_id uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE RESTRICT,
  position int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(minicheck_id, exam_question_id),
  UNIQUE(minicheck_id, position)
);

CREATE INDEX IF NOT EXISTS lesson_mc_q_minicheck_idx ON public.lesson_minicheck_questions(minicheck_id);
CREATE INDEX IF NOT EXISTS lesson_mc_q_exam_idx ON public.lesson_minicheck_questions(exam_question_id);

-- 2) user_competency_mastery: Mastery state per user+curriculum+competency
CREATE TABLE IF NOT EXISTS public.user_competency_mastery (
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL,
  competency_id uuid NOT NULL,
  mastery_state text NOT NULL DEFAULT 'not_mastered',  -- not_mastered | partial | mastered
  mastery_score numeric,
  minicheck_attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, curriculum_id, competency_id)
);

ALTER TABLE public.user_competency_mastery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mastery"
  ON public.user_competency_mastery FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own mastery"
  ON public.user_competency_mastery FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mastery"
  ON public.user_competency_mastery FOR UPDATE
  USING (auth.uid() = user_id);

-- 3) RPC: pick_minicheck_questions — deterministic, annotation-driven selection
CREATE OR REPLACE FUNCTION public.pick_minicheck_questions(
  p_curriculum_id uuid,
  p_competency_id uuid,
  p_total int DEFAULT 8,
  p_elite int DEFAULT 6
) RETURNS TABLE(question_id uuid, elite_level text, elite_score int)
LANGUAGE sql STABLE
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

-- Restrict RPC to service_role only
REVOKE EXECUTE ON FUNCTION public.pick_minicheck_questions(uuid, uuid, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_minicheck_questions(uuid, uuid, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_minicheck_questions(uuid, uuid, int, int) FROM authenticated;
