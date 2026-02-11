
-- ============================================================
-- LEARNER QUALITY HARDENING: Mastery Engine, Simulation Gates,
-- Weakness Loop, Exam-Readiness Score
-- ============================================================

-- 1) Learner Gate Status table – tracks per-user/curriculum gate checks
CREATE TABLE IF NOT EXISTS public.learner_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  gate_type text NOT NULL, -- L1_structure, L2_mastery, L3_exam_coverage, L4_weakness_loop
  gate_status text NOT NULL DEFAULT 'pending', -- pending, passed, blocked
  blocked_reason text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  UNIQUE(user_id, curriculum_id, gate_type)
);

ALTER TABLE public.learner_gates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own gates"
ON public.learner_gates FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "System can manage gates"
ON public.learner_gates FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2) Weakness loop tracking
CREATE TABLE IF NOT EXISTS public.weakness_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES public.competencies(id) ON DELETE CASCADE,
  source_session_id uuid REFERENCES public.exam_sessions(id),
  score_at_detection numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active', -- active, training, resolved
  assigned_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  retrained_lesson_ids uuid[] DEFAULT '{}',
  UNIQUE(user_id, curriculum_id, competency_id, source_session_id)
);

ALTER TABLE public.weakness_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weakness assignments"
ON public.weakness_assignments FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own weakness assignments"
ON public.weakness_assignments FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_weakness_assignments_user ON public.weakness_assignments(user_id, curriculum_id);
CREATE INDEX idx_weakness_assignments_status ON public.weakness_assignments(status);

-- 3) Enhanced readiness calculation RPC
CREATE OR REPLACE FUNCTION public.calculate_exam_readiness(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_mastery_score numeric := 0;
  v_sim_score numeric := 0;
  v_total_competencies int := 0;
  v_mastered_count int := 0;
  v_partial_count int := 0;
  v_not_mastered_count int := 0;
  v_high_weight_blocked boolean := false;
  v_weak_competencies jsonb := '[]'::jsonb;
  v_strong_competencies jsonb := '[]'::jsonb;
  v_active_weaknesses int := 0;
  v_readiness_level text := 'not_ready';
  v_sim_allowed boolean := false;
  v_last_sim_score numeric := 0;
BEGIN
  -- Count competency mastery from lesson_outcomes
  SELECT
    count(*),
    count(*) FILTER (WHERE lo.status = 'mastered'),
    count(*) FILTER (WHERE lo.status = 'partial'),
    count(*) FILTER (WHERE lo.status = 'not_mastered')
  INTO v_total_competencies, v_mastered_count, v_partial_count, v_not_mastered_count
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  JOIN public.curricula cur ON cur.id = lf.curriculum_id
  LEFT JOIN public.lesson_outcomes lo ON lo.competency_id = c.id AND lo.user_id = p_user_id
  WHERE cur.id = p_curriculum_id;

  -- Weighted mastery score
  IF v_total_competencies > 0 THEN
    v_mastery_score := (
      (v_mastered_count * 100.0) +
      (v_partial_count * 60.0) +
      (v_not_mastered_count * 0.0)
    ) / v_total_competencies;
  END IF;

  -- Get last simulation score
  SELECT COALESCE(es.score_percentage, 0)
  INTO v_last_sim_score
  FROM public.exam_sessions es
  WHERE es.user_id = p_user_id
    AND es.finished_at IS NOT NULL
    AND es.curriculum_id = p_curriculum_id
  ORDER BY es.finished_at DESC
  LIMIT 1;

  -- Combined readiness: 60% mastery + 40% simulation
  v_sim_score := COALESCE(v_last_sim_score, 0);
  
  -- Weak competencies (score < 70% or not_mastered)
  SELECT jsonb_agg(jsonb_build_object(
    'competency_id', c.id,
    'title', c.title,
    'code', c.code,
    'score', COALESCE(lo.score_percent, 0),
    'status', COALESCE(lo.status, 'not_started')
  ))
  INTO v_weak_competencies
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  LEFT JOIN public.lesson_outcomes lo ON lo.competency_id = c.id AND lo.user_id = p_user_id
  WHERE lf.curriculum_id = p_curriculum_id
    AND (lo.status IS NULL OR lo.status IN ('not_mastered', 'partial') OR lo.score_percent < 70);

  -- Strong competencies
  SELECT jsonb_agg(jsonb_build_object(
    'competency_id', c.id,
    'title', c.title,
    'code', c.code,
    'score', COALESCE(lo.score_percent, 0)
  ))
  INTO v_strong_competencies
  FROM public.competencies c
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id
  LEFT JOIN public.lesson_outcomes lo ON lo.competency_id = c.id AND lo.user_id = p_user_id
  WHERE lf.curriculum_id = p_curriculum_id
    AND lo.status = 'mastered';

  -- Check for active weakness assignments
  SELECT count(*)
  INTO v_active_weaknesses
  FROM public.weakness_assignments
  WHERE user_id = p_user_id
    AND curriculum_id = p_curriculum_id
    AND status IN ('active', 'training');

  -- Simulation allowed check:
  -- No not_mastered high-weight competencies + no active weakness loops
  v_sim_allowed := (v_not_mastered_count = 0) AND (v_active_weaknesses = 0);

  -- Calculate overall readiness
  DECLARE
    v_overall numeric;
  BEGIN
    v_overall := (v_mastery_score * 0.6) + (v_sim_score * 0.4);
    
    IF v_overall >= 80 AND v_not_mastered_count = 0 THEN
      v_readiness_level := 'ready';
    ELSIF v_overall >= 50 THEN
      v_readiness_level := 'almost_ready';
    ELSE
      v_readiness_level := 'not_ready';
    END IF;

    v_result := jsonb_build_object(
      'overall_readiness', round(v_overall, 1),
      'mastery_score', round(v_mastery_score, 1),
      'simulation_score', round(v_sim_score, 1),
      'readiness_level', v_readiness_level,
      'total_competencies', v_total_competencies,
      'mastered_count', v_mastered_count,
      'partial_count', v_partial_count,
      'not_mastered_count', v_not_mastered_count,
      'weak_competencies', COALESCE(v_weak_competencies, '[]'::jsonb),
      'strong_competencies', COALESCE(v_strong_competencies, '[]'::jsonb),
      'simulation_allowed', v_sim_allowed,
      'simulation_blocked_reason', CASE
        WHEN v_not_mastered_count > 0 THEN v_not_mastered_count || ' Kompetenzen nicht bestanden'
        WHEN v_active_weaknesses > 0 THEN v_active_weaknesses || ' Schwächen noch nicht nachtrainiert'
        ELSE NULL
      END,
      'active_weakness_count', v_active_weaknesses,
      'last_simulation_score', v_last_sim_score
    );
  END;

  RETURN v_result;
END;
$$;

-- 4) RPC: Check if user can start simulation (Gate L2 enforcement)
CREATE OR REPLACE FUNCTION public.check_simulation_gate(
  p_user_id uuid,
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_readiness jsonb;
  v_allowed boolean;
BEGIN
  v_readiness := public.calculate_exam_readiness(p_user_id, p_curriculum_id);
  v_allowed := (v_readiness->>'simulation_allowed')::boolean;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'readiness_level', v_readiness->>'readiness_level',
    'blocked_reason', v_readiness->>'simulation_blocked_reason',
    'not_mastered_count', (v_readiness->>'not_mastered_count')::int,
    'active_weakness_count', (v_readiness->>'active_weakness_count')::int,
    'weak_competencies', v_readiness->'weak_competencies'
  );
END;
$$;

-- 5) RPC: Create weakness assignments after simulation
CREATE OR REPLACE FUNCTION public.create_weakness_assignments_from_exam(
  p_session_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_curriculum_id uuid;
  v_count int := 0;
BEGIN
  -- Get session info
  SELECT user_id, curriculum_id
  INTO v_user_id, v_curriculum_id
  FROM public.exam_sessions
  WHERE id = p_session_id;

  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Find competencies where user got < 70% correct in this session
  INSERT INTO public.weakness_assignments (user_id, curriculum_id, competency_id, source_session_id, score_at_detection, status)
  SELECT
    v_user_id,
    v_curriculum_id,
    c.id,
    p_session_id,
    CASE WHEN stats.total > 0 THEN round((stats.correct::numeric / stats.total) * 100, 1) ELSE 0 END,
    'active'
  FROM (
    SELECT
      esq.competency_code,
      count(*) AS total,
      count(*) FILTER (WHERE esq.is_correct = true) AS correct
    FROM public.exam_session_questions esq
    WHERE esq.exam_session_id = p_session_id
      AND esq.competency_code IS NOT NULL
    GROUP BY esq.competency_code
    HAVING count(*) FILTER (WHERE esq.is_correct = true)::numeric / GREATEST(count(*), 1) < 0.7
  ) stats
  JOIN public.competencies c ON c.code = stats.competency_code
  ON CONFLICT (user_id, curriculum_id, competency_id, source_session_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Also downgrade lesson_outcomes for these competencies
  UPDATE public.lesson_outcomes lo
  SET status = CASE
    WHEN lo.score_percent < 50 THEN 'not_mastered'
    ELSE 'partial'
  END,
  needs_review = true
  FROM public.weakness_assignments wa
  WHERE wa.source_session_id = p_session_id
    AND wa.user_id = v_user_id
    AND lo.user_id = v_user_id
    AND lo.competency_id = wa.competency_id
    AND lo.status = 'mastered';

  RETURN v_count;
END;
$$;

-- 6) RPC: Resolve weakness assignment when user re-masters the competency
CREATE OR REPLACE FUNCTION public.resolve_weakness_if_mastered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- When a lesson_outcome reaches mastered, resolve any active weakness for that competency
  IF NEW.status = 'mastered' THEN
    UPDATE public.weakness_assignments
    SET status = 'resolved',
        resolved_at = now(),
        retrained_lesson_ids = array_append(retrained_lesson_ids, NEW.lesson_id)
    WHERE user_id = NEW.user_id
      AND competency_id = NEW.competency_id
      AND status IN ('active', 'training');
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger: auto-resolve weakness when competency mastered
DROP TRIGGER IF EXISTS trg_resolve_weakness ON public.lesson_outcomes;
CREATE TRIGGER trg_resolve_weakness
AFTER INSERT OR UPDATE OF status ON public.lesson_outcomes
FOR EACH ROW
EXECUTE FUNCTION public.resolve_weakness_if_mastered();

-- 7) RPC: Check if next lesson is allowed (Mastery gate for lesson progression)
CREATE OR REPLACE FUNCTION public.check_lesson_progression(
  p_user_id uuid,
  p_lesson_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_module_id uuid;
  v_lesson_order int;
  v_prev_lesson_id uuid;
  v_prev_status text;
  v_prev_score numeric;
  v_allowed boolean := true;
  v_reason text;
BEGIN
  -- Get current lesson info
  SELECT module_id, sort_order
  INTO v_module_id, v_lesson_order
  FROM public.lessons
  WHERE id = p_lesson_id;

  IF v_module_id IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'Lesson not found');
  END IF;

  -- First lesson in module is always allowed
  IF v_lesson_order IS NULL OR v_lesson_order <= 1 THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- Find previous lesson
  SELECT l.id
  INTO v_prev_lesson_id
  FROM public.lessons l
  WHERE l.module_id = v_module_id
    AND l.sort_order < v_lesson_order
  ORDER BY l.sort_order DESC
  LIMIT 1;

  IF v_prev_lesson_id IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- Check previous lesson status
  SELECT lo.status, lo.score_percent
  INTO v_prev_status, v_prev_score
  FROM public.lesson_outcomes lo
  WHERE lo.lesson_id = v_prev_lesson_id
    AND lo.user_id = p_user_id;

  -- Gate: previous lesson must be at least partial (>=50%)
  IF v_prev_status IS NULL THEN
    v_allowed := false;
    v_reason := 'Vorherige Lektion noch nicht abgeschlossen';
  ELSIF v_prev_status = 'not_mastered' THEN
    v_allowed := false;
    v_reason := 'Vorherige Lektion nicht bestanden – bitte wiederhole den Mini-Check';
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'previous_lesson_id', v_prev_lesson_id,
    'previous_status', v_prev_status
  );
END;
$$;
