
-- ============================================================
-- LEARNER HARDENING: Readiness Gate + Weakness Loop (ENFORCED)
-- ============================================================

-- 1) Remediation Queue table
CREATE TABLE IF NOT EXISTS public.user_remediation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES public.competencies(id) ON DELETE CASCADE,
  source_session_id uuid REFERENCES public.exam_sessions(id),
  score_at_detection numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','training','resolved','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(user_id, curriculum_id, competency_id, status)
);

CREATE INDEX IF NOT EXISTS idx_remediation_user ON public.user_remediation_queue(user_id, curriculum_id);
CREATE INDEX IF NOT EXISTS idx_remediation_status ON public.user_remediation_queue(status);

ALTER TABLE public.user_remediation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own remediation" ON public.user_remediation_queue
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "System manages remediation" ON public.user_remediation_queue
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2) get_exam_readiness: check if user is ready for simulation
CREATE OR REPLACE FUNCTION public.get_exam_readiness(p_user_id uuid, p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_not_mastered int;
  v_active_weaknesses int;
  v_active_remediation int;
  v_readiness_level text;
  v_allowed boolean;
  v_blocked_reason text;
BEGIN
  -- Count competencies with not_mastered status (lesson_outcomes.status)
  SELECT count(*) INTO v_not_mastered
  FROM public.lesson_outcomes lo
  JOIN public.lessons l ON l.id = lo.lesson_id
  JOIN public.modules m ON m.id = l.module_id
  JOIN public.courses c ON c.id = m.course_id
  WHERE lo.user_id = p_user_id
    AND c.curriculum_id = p_curriculum_id
    AND lo.status = 'not_mastered';

  -- Count active weakness assignments
  SELECT count(*) INTO v_active_weaknesses
  FROM public.weakness_assignments wa
  WHERE wa.user_id = p_user_id
    AND wa.curriculum_id = p_curriculum_id
    AND wa.status IN ('active', 'training');

  -- Count active remediation items
  SELECT count(*) INTO v_active_remediation
  FROM public.user_remediation_queue urq
  WHERE urq.user_id = p_user_id
    AND urq.curriculum_id = p_curriculum_id
    AND urq.status IN ('pending', 'training');

  -- Determine readiness
  IF v_not_mastered = 0 AND v_active_weaknesses = 0 AND v_active_remediation = 0 THEN
    v_readiness_level := 'ready';
    v_allowed := true;
    v_blocked_reason := NULL;
  ELSIF v_not_mastered <= 2 AND v_active_weaknesses <= 1 AND v_active_remediation <= 1 THEN
    v_readiness_level := 'almost_ready';
    v_allowed := true;
    v_blocked_reason := NULL;
  ELSE
    v_readiness_level := 'not_ready';
    v_allowed := false;
    v_blocked_reason := format(
      '%s Kompetenzen nicht gemeistert, %s offene Schwächen, %s Nachtrainings ausstehend',
      v_not_mastered, v_active_weaknesses, v_active_remediation
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'readiness_level', v_readiness_level,
    'not_mastered_count', v_not_mastered,
    'active_weakness_count', v_active_weaknesses,
    'active_remediation_count', v_active_remediation,
    'blocked_reason', v_blocked_reason
  );
END;
$$;

-- 3) REPLACE start_exam_session with readiness gate
CREATE OR REPLACE FUNCTION public.start_exam_session(p_blueprint_id uuid, p_mode text DEFAULT 'simulation')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_blueprint record;
  v_session_id uuid;
  v_seed int;
  v_readiness jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_blueprint FROM public.exam_blueprints WHERE id = p_blueprint_id AND frozen = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blueprint not found or not frozen';
  END IF;

  -- READINESS GATE: Block simulation/timed_exam if not ready
  IF p_mode IN ('simulation', 'timed_exam') THEN
    v_readiness := public.get_exam_readiness(v_user_id, v_blueprint.curriculum_id);
    IF NOT (v_readiness->>'allowed')::boolean THEN
      RAISE EXCEPTION 'READINESS_BLOCKED: %', v_readiness->>'blocked_reason';
    END IF;
  END IF;

  v_seed := floor(extract(epoch from now()))::int;

  INSERT INTO public.exam_sessions (
    user_id, curriculum_id, blueprint_id, mode, seed,
    total_questions, time_limit_minutes
  ) VALUES (
    v_user_id, v_blueprint.curriculum_id, p_blueprint_id, p_mode, v_seed,
    v_blueprint.total_questions,
    CASE WHEN p_mode = 'timed_exam' THEN v_blueprint.time_limit_minutes ELSE NULL END
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.exam_session_questions (
    exam_session_id, question_id, order_index, difficulty,
    learning_field_code, competency_code
  )
  SELECT
    v_session_id, eq.id,
    row_number() OVER (ORDER BY random()),
    eq.difficulty, eq.learning_field_code, eq.competency_code
  FROM public.exam_questions eq
  WHERE eq.blueprint_id = p_blueprint_id
    AND eq.status = 'approved'
  ORDER BY random()
  LIMIT v_blueprint.total_questions;

  RETURN v_session_id;
END;
$$;

-- 4) REPLACE finish_exam_session with weakness loop
CREATE OR REPLACE FUNCTION public.finish_exam_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session record;
  v_total int;
  v_correct int;
  v_score numeric;
  v_passed boolean;
  v_by_difficulty jsonb := '{}'::jsonb;
  v_by_lf jsonb := '{}'::jsonb;
  v_pass_threshold numeric;
  rec record;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_session FROM public.exam_sessions
  WHERE id = p_session_id AND user_id = v_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.finished_at IS NOT NULL THEN RAISE EXCEPTION 'Session already finished'; END IF;

  SELECT count(*), count(*) FILTER (WHERE is_correct = true)
  INTO v_total, v_correct
  FROM public.exam_session_questions WHERE exam_session_id = p_session_id;

  v_score := CASE WHEN v_total > 0 THEN (v_correct::numeric / v_total * 100) ELSE 0 END;

  SELECT coalesce(pass_threshold, 50) INTO v_pass_threshold
  FROM public.exam_blueprints WHERE id = v_session.blueprint_id;

  v_passed := v_score >= v_pass_threshold;

  FOR rec IN
    SELECT difficulty, count(*) as total, count(*) FILTER (WHERE is_correct = true) as correct
    FROM public.exam_session_questions WHERE exam_session_id = p_session_id GROUP BY difficulty
  LOOP
    v_by_difficulty := v_by_difficulty || jsonb_build_object(rec.difficulty, jsonb_build_object('total', rec.total, 'correct', rec.correct));
  END LOOP;

  FOR rec IN
    SELECT coalesce(learning_field_code, 'unknown') as lf, count(*) as total, count(*) FILTER (WHERE is_correct = true) as correct
    FROM public.exam_session_questions WHERE exam_session_id = p_session_id GROUP BY learning_field_code
  LOOP
    v_by_lf := v_by_lf || jsonb_build_object(rec.lf, jsonb_build_object('total', rec.total, 'correct', rec.correct));
  END LOOP;

  UPDATE public.exam_sessions SET finished_at = now(), score_percentage = v_score, passed = v_passed
  WHERE id = p_session_id;

  -- *** WEAKNESS LOOP: Create remediation items for competencies < 70% ***
  INSERT INTO public.user_remediation_queue (user_id, curriculum_id, competency_id, source_session_id, score_at_detection, status)
  SELECT
    v_user_id, v_session.curriculum_id, c.id, p_session_id,
    round((count(*) FILTER (WHERE esq.is_correct = true)::numeric / nullif(count(*), 0) * 100)),
    'pending'
  FROM public.exam_session_questions esq
  JOIN public.exam_questions eq ON eq.id = esq.question_id
  JOIN public.competencies c ON c.code = esq.competency_code
  JOIN public.learning_fields lf ON lf.id = c.learning_field_id AND lf.curriculum_id = v_session.curriculum_id
  WHERE esq.exam_session_id = p_session_id
  GROUP BY c.id
  HAVING (count(*) FILTER (WHERE esq.is_correct = true)::numeric / nullif(count(*), 0) * 100) < 70
  ON CONFLICT (user_id, curriculum_id, competency_id, status) DO NOTHING;

  -- Mark related lesson_outcomes as needs_review
  UPDATE public.lesson_outcomes lo SET needs_review = true
  FROM public.user_remediation_queue urq
  WHERE urq.user_id = v_user_id
    AND urq.source_session_id = p_session_id
    AND urq.status = 'pending'
    AND lo.user_id = v_user_id
    AND lo.competency_id = urq.competency_id;

  RETURN jsonb_build_object(
    'total_questions', v_total, 'correct_answers', v_correct,
    'score_percentage', v_score, 'passed', v_passed,
    'pass_threshold', v_pass_threshold,
    'breakdown', jsonb_build_object('by_difficulty', v_by_difficulty, 'by_learning_field', v_by_lf)
  );
END;
$$;

-- 5) Auto-resolve remediation when mastery achieved
CREATE OR REPLACE FUNCTION public.resolve_remediation_on_mastery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- lesson_outcomes uses 'status' column with values like 'mastered'
  IF NEW.status = 'mastered' THEN
    UPDATE public.user_remediation_queue
    SET status = 'resolved', resolved_at = now()
    WHERE user_id = NEW.user_id
      AND competency_id = NEW.competency_id
      AND status IN ('pending', 'training');

    -- Also resolve weakness_assignments
    UPDATE public.weakness_assignments
    SET status = 'resolved', resolved_at = now()
    WHERE user_id = NEW.user_id
      AND competency_id = NEW.competency_id
      AND status IN ('active', 'training');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_remediation ON public.lesson_outcomes;
CREATE TRIGGER trg_resolve_remediation
  AFTER INSERT OR UPDATE OF status ON public.lesson_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_remediation_on_mastery();
