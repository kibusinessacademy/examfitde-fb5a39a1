
-- ═══════════════════════════════════════════════════════════
-- PATCH 1: Idempotent Event Tables
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_exam_skill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  question_id uuid NOT NULL,
  skill_node_id uuid NOT NULL REFERENCES public.skill_nodes(id),
  is_correct boolean NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uese_user_skill
  ON public.user_exam_skill_events(user_id, skill_node_id);

ALTER TABLE public.user_exam_skill_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_minicheck_skill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  submission_id uuid NOT NULL DEFAULT gen_random_uuid(),
  lesson_id uuid NULL,
  skill_node_id uuid NOT NULL REFERENCES public.skill_nodes(id),
  correct_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_umse_user_skill
  ON public.user_minicheck_skill_events(user_id, skill_node_id);

ALTER TABLE public.user_minicheck_skill_events ENABLE ROW LEVEL SECURITY;

-- RLS: users can read own events
CREATE POLICY "Users can read own exam skill events"
  ON public.user_exam_skill_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read own minicheck skill events"
  ON public.user_minicheck_skill_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- PATCH 1: SSOT Aggregation RPC
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.refresh_user_skill_score_from_events(
  p_user_id uuid,
  p_skill_node_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam_attempts int := 0;
  v_exam_correct int := 0;
  v_minicheck_attempts int := 0;
  v_minicheck_correct int := 0;
  v_last_exam_at timestamptz;
  v_last_minicheck_at timestamptz;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (WHERE is_correct),
    max(created_at)
  INTO v_exam_attempts, v_exam_correct, v_last_exam_at
  FROM public.user_exam_skill_events
  WHERE user_id = p_user_id
    AND skill_node_id = p_skill_node_id;

  SELECT
    coalesce(sum(total_count), 0),
    coalesce(sum(correct_count), 0),
    max(created_at)
  INTO v_minicheck_attempts, v_minicheck_correct, v_last_minicheck_at
  FROM public.user_minicheck_skill_events
  WHERE user_id = p_user_id
    AND skill_node_id = p_skill_node_id;

  INSERT INTO public.user_skill_scores (
    user_id, skill_node_id,
    attempts, correct,
    minicheck_attempts, minicheck_correct,
    last_exam_at, last_attempt_at, last_minicheck_at,
    updated_at
  )
  VALUES (
    p_user_id, p_skill_node_id,
    v_exam_attempts, v_exam_correct,
    v_minicheck_attempts, v_minicheck_correct,
    v_last_exam_at,
    coalesce(v_last_exam_at, now()),
    v_last_minicheck_at,
    now()
  )
  ON CONFLICT (user_id, skill_node_id)
  DO UPDATE SET
    attempts = excluded.attempts,
    correct = excluded.correct,
    minicheck_attempts = excluded.minicheck_attempts,
    minicheck_correct = excluded.minicheck_correct,
    last_exam_at = excluded.last_exam_at,
    last_attempt_at = excluded.last_attempt_at,
    last_minicheck_at = excluded.last_minicheck_at,
    updated_at = now();

  RETURN public.recalculate_mastery(p_user_id, p_skill_node_id);
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- PATCH 2: SSOT Skill Seeding from Competencies
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_skill_nodes_from_competencies(
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seeded int := 0;
BEGIN
  INSERT INTO public.skill_nodes (
    curriculum_id, lernfeld, kompetenz, mikro_skill, description
  )
  SELECT
    lf.curriculum_id,
    coalesce(lf.code, 'LF0'),
    c.title,
    c.title,
    coalesce(c.description, 'Kompetenzbasiert erzeugt')
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = p_curriculum_id
  ON CONFLICT (curriculum_id, lernfeld, kompetenz, mikro_skill)
  DO NOTHING;

  GET DIAGNOSTICS v_seeded = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'seeded', v_seeded, 'source', 'competencies');
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- PATCH 3: Batch Recalculate + Enhanced recalculate_all
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recalculate_mastery_for_skills(
  p_user_id uuid,
  p_skill_node_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skill_id uuid;
  v_count int := 0;
BEGIN
  FOREACH v_skill_id IN ARRAY p_skill_node_ids
  LOOP
    PERFORM public.recalculate_mastery(p_user_id, v_skill_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'recalculated', v_count);
END;
$$;

-- Enhanced recalculate_all with diagnostic output
CREATE OR REPLACE FUNCTION public.recalculate_all_mastery(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skill record;
  v_count int := 0;
  v_mastered int := 0;
  v_partial int := 0;
  v_not_mastered int := 0;
  v_low_conf int := 0;
BEGIN
  FOR v_skill IN
    SELECT skill_node_id FROM public.user_skill_scores WHERE user_id = p_user_id
  LOOP
    PERFORM public.recalculate_mastery(p_user_id, v_skill.skill_node_id);
    v_count := v_count + 1;
  END LOOP;

  SELECT
    count(*) FILTER (WHERE mastery_status = 'mastered'),
    count(*) FILTER (WHERE mastery_status = 'partial'),
    count(*) FILTER (WHERE mastery_status = 'not_mastered'),
    count(*) FILTER (WHERE coalesce(confidence, 0) < 0.3)
  INTO v_mastered, v_partial, v_not_mastered, v_low_conf
  FROM public.user_skill_scores
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'recalculated', v_count,
    'mastered', v_mastered,
    'partial', v_partial,
    'not_mastered', v_not_mastered,
    'low_confidence', v_low_conf
  );
END;
$$;
