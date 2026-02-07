-- ============================================
-- Exam Simulation Engine (SSOT-based)
-- ============================================

-- 1️⃣ Exam Blueprints (IHK-kompatible Prüfungsstruktur)
CREATE TABLE IF NOT EXISTS public.exam_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  total_questions integer NOT NULL DEFAULT 40,
  time_limit_minutes integer NOT NULL DEFAULT 90,
  pass_threshold numeric(3,2) NOT NULL DEFAULT 0.50,
  difficulty_distribution jsonb NOT NULL DEFAULT '{"easy": 0.30, "medium": 0.50, "hard": 0.20}',
  section_weights jsonb NOT NULL DEFAULT '[]',
  question_types jsonb NOT NULL DEFAULT '["single_choice", "multiple_choice"]',
  frozen boolean NOT NULL DEFAULT false,
  frozen_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.exam_blueprints ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can manage blueprints"
  ON public.exam_blueprints
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view frozen blueprints"
  ON public.exam_blueprints
  FOR SELECT
  USING (frozen = true OR public.has_role(auth.uid(), 'admin'));

-- Index
CREATE INDEX IF NOT EXISTS idx_exam_blueprints_curriculum 
  ON public.exam_blueprints(curriculum_id);

-- 2️⃣ Exam Session Mode Enum
DO $$ BEGIN
  CREATE TYPE public.exam_mode AS ENUM ('simulation', 'practice', 'timed_exam');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3️⃣ Exam Sessions (laufende Prüfungen)
CREATE TABLE IF NOT EXISTS public.exam_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  blueprint_id uuid NOT NULL REFERENCES public.exam_blueprints(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'simulation',
  seed integer NOT NULL,
  total_questions integer NOT NULL,
  time_limit_minutes integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  current_index integer NOT NULL DEFAULT 0,
  points_earned numeric(5,2) DEFAULT 0,
  points_total numeric(5,2) DEFAULT 0,
  score_percentage numeric(5,2),
  passed boolean,
  breakdown jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can manage their own sessions"
  ON public.exam_sessions
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all sessions"
  ON public.exam_sessions
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exam_sessions_user 
  ON public.exam_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_blueprint 
  ON public.exam_sessions(blueprint_id);

-- 4️⃣ Exam Session Questions (Snapshot der Prüfungsfragen)
CREATE TABLE IF NOT EXISTS public.exam_session_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_session_id uuid NOT NULL REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  order_index integer NOT NULL,
  difficulty text NOT NULL,
  learning_field_code text,
  competency_code text,
  user_answer integer,
  is_correct boolean,
  answered_at timestamptz,
  time_spent_seconds integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(exam_session_id, order_index)
);

-- Enable RLS
ALTER TABLE public.exam_session_questions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can manage their own session questions"
  ON public.exam_session_questions
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.exam_sessions es
    WHERE es.id = exam_session_questions.exam_session_id
    AND es.user_id = auth.uid()
  ));

CREATE POLICY "Admins can view all session questions"
  ON public.exam_session_questions
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exam_session_questions_session 
  ON public.exam_session_questions(exam_session_id);

-- 5️⃣ User Competency Stats (für Adaptivität)
CREATE TABLE IF NOT EXISTS public.user_competency_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NOT NULL REFERENCES public.curricula(id) ON DELETE CASCADE,
  learning_field_id uuid REFERENCES public.learning_fields(id) ON DELETE SET NULL,
  competency_id uuid REFERENCES public.competencies(id) ON DELETE SET NULL,
  total_attempts integer NOT NULL DEFAULT 0,
  correct_attempts integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  last_difficulty text,
  mastery_level numeric(3,2) DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, curriculum_id, competency_id)
);

-- Enable RLS
ALTER TABLE public.user_competency_stats ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can manage their own stats"
  ON public.user_competency_stats
  FOR ALL
  USING (user_id = auth.uid());

-- 6️⃣ Function: Generate deterministic question set
CREATE OR REPLACE FUNCTION public.generate_exam_questions(
  p_blueprint_id uuid,
  p_seed integer
)
RETURNS TABLE (
  question_id uuid,
  order_index integer,
  difficulty text,
  learning_field_code text,
  competency_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blueprint exam_blueprints%ROWTYPE;
  v_total integer;
  v_easy_count integer;
  v_medium_count integer;
  v_hard_count integer;
  v_distribution jsonb;
BEGIN
  -- Get blueprint
  SELECT * INTO v_blueprint
  FROM exam_blueprints
  WHERE id = p_blueprint_id AND frozen = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blueprint not found or not frozen: %', p_blueprint_id;
  END IF;
  
  v_total := v_blueprint.total_questions;
  v_distribution := v_blueprint.difficulty_distribution;
  
  -- Calculate counts per difficulty
  v_easy_count := ROUND(v_total * COALESCE((v_distribution->>'easy')::numeric, 0.30));
  v_hard_count := ROUND(v_total * COALESCE((v_distribution->>'hard')::numeric, 0.20));
  v_medium_count := v_total - v_easy_count - v_hard_count;
  
  -- Set random seed for reproducibility
  PERFORM setseed(p_seed::numeric / 2147483647);
  
  -- Return shuffled questions by difficulty
  RETURN QUERY
  WITH easy_q AS (
    SELECT eq.id, eq.difficulty::text, lf.code as lf_code, c.code as c_code
    FROM exam_questions eq
    LEFT JOIN learning_fields lf ON lf.id = eq.learning_field_id
    LEFT JOIN competencies c ON c.id = eq.competency_id
    WHERE eq.curriculum_id = v_blueprint.curriculum_id
      AND eq.status = 'approved'
      AND eq.difficulty = 'easy'
    ORDER BY random()
    LIMIT v_easy_count
  ),
  medium_q AS (
    SELECT eq.id, eq.difficulty::text, lf.code as lf_code, c.code as c_code
    FROM exam_questions eq
    LEFT JOIN learning_fields lf ON lf.id = eq.learning_field_id
    LEFT JOIN competencies c ON c.id = eq.competency_id
    WHERE eq.curriculum_id = v_blueprint.curriculum_id
      AND eq.status = 'approved'
      AND eq.difficulty = 'medium'
    ORDER BY random()
    LIMIT v_medium_count
  ),
  hard_q AS (
    SELECT eq.id, eq.difficulty::text, lf.code as lf_code, c.code as c_code
    FROM exam_questions eq
    LEFT JOIN learning_fields lf ON lf.id = eq.learning_field_id
    LEFT JOIN competencies c ON c.id = eq.competency_id
    WHERE eq.curriculum_id = v_blueprint.curriculum_id
      AND eq.status = 'approved'
      AND eq.difficulty = 'hard'
    ORDER BY random()
    LIMIT v_hard_count
  ),
  all_questions AS (
    SELECT * FROM easy_q
    UNION ALL
    SELECT * FROM medium_q
    UNION ALL
    SELECT * FROM hard_q
  ),
  shuffled AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY random()) as idx
    FROM all_questions
  )
  SELECT s.id, (s.idx - 1)::integer, s.difficulty, s.lf_code, s.c_code
  FROM shuffled s;
END;
$$;

-- 7️⃣ Function: Start exam session
CREATE OR REPLACE FUNCTION public.start_exam_session(
  p_blueprint_id uuid,
  p_mode text DEFAULT 'simulation'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blueprint exam_blueprints%ROWTYPE;
  v_session_id uuid;
  v_seed integer;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Get blueprint
  SELECT * INTO v_blueprint
  FROM exam_blueprints
  WHERE id = p_blueprint_id AND frozen = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blueprint not found or not frozen';
  END IF;
  
  -- Generate deterministic seed
  v_seed := (EXTRACT(EPOCH FROM now()) * 1000)::integer % 2147483647;
  
  -- Create session
  INSERT INTO exam_sessions (
    user_id,
    curriculum_id,
    blueprint_id,
    mode,
    seed,
    total_questions,
    time_limit_minutes
  ) VALUES (
    v_user_id,
    v_blueprint.curriculum_id,
    p_blueprint_id,
    p_mode,
    v_seed,
    v_blueprint.total_questions,
    CASE WHEN p_mode = 'timed_exam' THEN v_blueprint.time_limit_minutes ELSE NULL END
  )
  RETURNING id INTO v_session_id;
  
  -- Generate and insert questions
  INSERT INTO exam_session_questions (
    exam_session_id,
    question_id,
    order_index,
    difficulty,
    learning_field_code,
    competency_code
  )
  SELECT 
    v_session_id,
    q.question_id,
    q.order_index,
    q.difficulty,
    q.learning_field_code,
    q.competency_code
  FROM public.generate_exam_questions(p_blueprint_id, v_seed) q;
  
  RETURN v_session_id;
END;
$$;

-- 8️⃣ Function: Submit answer
CREATE OR REPLACE FUNCTION public.submit_exam_answer(
  p_session_id uuid,
  p_question_index integer,
  p_answer integer,
  p_time_spent integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session exam_sessions%ROWTYPE;
  v_session_question exam_session_questions%ROWTYPE;
  v_question exam_questions%ROWTYPE;
  v_is_correct boolean;
  v_result jsonb;
BEGIN
  -- Get session
  SELECT * INTO v_session
  FROM exam_sessions
  WHERE id = p_session_id AND user_id = auth.uid();
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or not authorized';
  END IF;
  
  IF v_session.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'Session already finished';
  END IF;
  
  -- Get session question
  SELECT * INTO v_session_question
  FROM exam_session_questions
  WHERE exam_session_id = p_session_id AND order_index = p_question_index;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found at index %', p_question_index;
  END IF;
  
  -- Get actual question for correct answer
  SELECT * INTO v_question
  FROM exam_questions
  WHERE id = v_session_question.question_id;
  
  -- Check if correct
  v_is_correct := (p_answer = v_question.correct_answer);
  
  -- Update session question
  UPDATE exam_session_questions
  SET user_answer = p_answer,
      is_correct = v_is_correct,
      answered_at = now(),
      time_spent_seconds = p_time_spent
  WHERE id = v_session_question.id;
  
  -- Update session current index
  UPDATE exam_sessions
  SET current_index = GREATEST(current_index, p_question_index + 1)
  WHERE id = p_session_id;
  
  -- Build result
  v_result := jsonb_build_object(
    'is_correct', v_is_correct,
    'correct_answer', v_question.correct_answer,
    'explanation', v_question.explanation
  );
  
  RETURN v_result;
END;
$$;

-- 9️⃣ Function: Finish exam session
CREATE OR REPLACE FUNCTION public.finish_exam_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session exam_sessions%ROWTYPE;
  v_blueprint exam_blueprints%ROWTYPE;
  v_total integer;
  v_correct integer;
  v_score numeric;
  v_passed boolean;
  v_breakdown jsonb;
  v_result jsonb;
BEGIN
  -- Get session
  SELECT * INTO v_session
  FROM exam_sessions
  WHERE id = p_session_id AND user_id = auth.uid();
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or not authorized';
  END IF;
  
  IF v_session.finished_at IS NOT NULL THEN
    -- Already finished, return existing result
    SELECT jsonb_build_object(
      'score_percentage', v_session.score_percentage,
      'passed', v_session.passed,
      'breakdown', v_session.breakdown
    ) INTO v_result;
    RETURN v_result;
  END IF;
  
  -- Get blueprint for pass threshold
  SELECT * INTO v_blueprint
  FROM exam_blueprints
  WHERE id = v_session.blueprint_id;
  
  -- Calculate results
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE is_correct = true)
  INTO v_total, v_correct
  FROM exam_session_questions
  WHERE exam_session_id = p_session_id;
  
  v_score := CASE WHEN v_total > 0 THEN (v_correct::numeric / v_total) * 100 ELSE 0 END;
  v_passed := v_score >= (v_blueprint.pass_threshold * 100);
  
  -- Calculate breakdown by difficulty
  SELECT jsonb_build_object(
    'by_difficulty', (
      SELECT jsonb_object_agg(difficulty, stats)
      FROM (
        SELECT 
          difficulty,
          jsonb_build_object(
            'total', COUNT(*),
            'correct', COUNT(*) FILTER (WHERE is_correct = true)
          ) as stats
        FROM exam_session_questions
        WHERE exam_session_id = p_session_id
        GROUP BY difficulty
      ) sub
    ),
    'by_learning_field', (
      SELECT jsonb_object_agg(COALESCE(learning_field_code, 'unknown'), stats)
      FROM (
        SELECT 
          learning_field_code,
          jsonb_build_object(
            'total', COUNT(*),
            'correct', COUNT(*) FILTER (WHERE is_correct = true)
          ) as stats
        FROM exam_session_questions
        WHERE exam_session_id = p_session_id
        GROUP BY learning_field_code
      ) sub
    )
  ) INTO v_breakdown;
  
  -- Update session
  UPDATE exam_sessions
  SET finished_at = now(),
      points_earned = v_correct,
      points_total = v_total,
      score_percentage = v_score,
      passed = v_passed,
      breakdown = v_breakdown
  WHERE id = p_session_id;
  
  -- Update user competency stats
  INSERT INTO user_competency_stats (user_id, curriculum_id, competency_id, total_attempts, correct_attempts, updated_at)
  SELECT 
    v_session.user_id,
    v_session.curriculum_id,
    eq.competency_id,
    1,
    CASE WHEN esq.is_correct THEN 1 ELSE 0 END,
    now()
  FROM exam_session_questions esq
  JOIN exam_questions eq ON eq.id = esq.question_id
  WHERE esq.exam_session_id = p_session_id
    AND eq.competency_id IS NOT NULL
  ON CONFLICT (user_id, curriculum_id, competency_id)
  DO UPDATE SET
    total_attempts = user_competency_stats.total_attempts + 1,
    correct_attempts = user_competency_stats.correct_attempts + EXCLUDED.correct_attempts,
    mastery_level = (user_competency_stats.correct_attempts + EXCLUDED.correct_attempts)::numeric / 
                    (user_competency_stats.total_attempts + 1),
    updated_at = now();
  
  -- Build result
  v_result := jsonb_build_object(
    'total_questions', v_total,
    'correct_answers', v_correct,
    'score_percentage', v_score,
    'passed', v_passed,
    'pass_threshold', v_blueprint.pass_threshold * 100,
    'breakdown', v_breakdown
  );
  
  RETURN v_result;
END;
$$;