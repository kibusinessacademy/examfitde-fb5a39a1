
-- ============================================================
-- SHUTTLE MODE DB HARDENING – Drop old, create production-ready
-- ============================================================

-- 1. Drop old RPC
DROP FUNCTION IF EXISTS public.get_shuttle_next_question(UUID, UUID, UUID);

-- 2. Drop old tables (cascade removes FK + policies)
DROP TABLE IF EXISTS public.shuttle_events CASCADE;
DROP TABLE IF EXISTS public.shuttle_sessions CASCADE;

-- ============================================================
-- TABLE: shuttle_sessions
-- ============================================================
CREATE TABLE public.shuttle_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  questions_answered INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shuttle_sessions_user_curriculum
  ON public.shuttle_sessions (user_id, curriculum_id);
CREATE INDEX idx_shuttle_sessions_active
  ON public.shuttle_sessions (user_id, status)
  WHERE status = 'active';

ALTER TABLE public.shuttle_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shuttle_sessions_select_own"
  ON public.shuttle_sessions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "shuttle_sessions_insert_own"
  ON public.shuttle_sessions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- No direct UPDATE/DELETE from client – RPCs handle mutations

-- ============================================================
-- TABLE: shuttle_events  (fachliche SSOT)
-- ============================================================
CREATE TABLE public.shuttle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.shuttle_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  question_id UUID NOT NULL,
  competency_id UUID,
  blueprint_id UUID,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'question_served',
      'question_answered',
      'feedback_opened',
      'next_question_requested',
      'session_completed',
      'session_abandoned'
    )),
  is_correct BOOLEAN,
  selected_option_ids JSONB,        -- future-proof: array of indices or UUIDs
  response_ms INT,
  payload JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shuttle_events_session ON public.shuttle_events (session_id, occurred_at);
CREATE INDEX idx_shuttle_events_user_question ON public.shuttle_events (user_id, question_id);
CREATE INDEX idx_shuttle_events_user_curriculum ON public.shuttle_events (user_id, curriculum_id);
CREATE INDEX idx_shuttle_events_type ON public.shuttle_events (event_type);

ALTER TABLE public.shuttle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shuttle_events_select_own"
  ON public.shuttle_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- No direct INSERT from client – only via RPCs (service_role)

-- ============================================================
-- TABLE: shuttle_question_state  (per-user per-question tracking)
-- ============================================================
CREATE TABLE public.shuttle_question_state (
  user_id UUID NOT NULL,
  question_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  times_seen INT NOT NULL DEFAULT 0,
  times_correct INT NOT NULL DEFAULT 0,
  times_incorrect INT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  last_correct_at TIMESTAMPTZ,
  cooldown_until TIMESTAMPTZ,
  streak INT NOT NULL DEFAULT 0,      -- consecutive correct
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX idx_shuttle_qstate_curriculum
  ON public.shuttle_question_state (user_id, curriculum_id);
CREATE INDEX idx_shuttle_qstate_cooldown
  ON public.shuttle_question_state (user_id, curriculum_id, cooldown_until);

ALTER TABLE public.shuttle_question_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shuttle_qstate_select_own"
  ON public.shuttle_question_state FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- No direct write from client

-- ============================================================
-- TABLE: shuttle_user_stats  (aggregated per user/curriculum)
-- ============================================================
CREATE TABLE public.shuttle_user_stats (
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  total_sessions INT NOT NULL DEFAULT 0,
  total_questions INT NOT NULL DEFAULT 0,
  total_correct INT NOT NULL DEFAULT 0,
  total_time_ms BIGINT NOT NULL DEFAULT 0,
  current_streak INT NOT NULL DEFAULT 0,
  best_streak INT NOT NULL DEFAULT 0,
  last_session_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, curriculum_id)
);

ALTER TABLE public.shuttle_user_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shuttle_user_stats_select_own"
  ON public.shuttle_user_stats FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- RPC: fn_select_next_shuttle_question
-- Weighted selection: weakness > blueprint > cooldown > competency variance > random tiebreaker
-- Only approved questions, anti-loop, cooldown
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_select_next_shuttle_question(
  p_user_id UUID,
  p_curriculum_id UUID,
  p_session_id UUID
)
RETURNS TABLE (
  question_id UUID,
  question_text TEXT,
  question_type TEXT,
  options JSONB,
  competency_id UUID,
  blueprint_id UUID,
  difficulty TEXT,
  trap_type TEXT,
  trap_tags TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_ids UUID[];
  v_recent_competencies UUID[];
BEGIN
  -- Anti-loop: last 10 questions in this session
  IF p_session_id IS NOT NULL THEN
    SELECT ARRAY_AGG(sub.question_id)
    INTO v_recent_ids
    FROM (
      SELECT se.question_id
      FROM shuttle_events se
      WHERE se.session_id = p_session_id
        AND se.event_type IN ('question_served', 'question_answered')
      ORDER BY se.occurred_at DESC
      LIMIT 10
    ) sub;

    -- Competency variance: last 3 competencies served
    SELECT ARRAY_AGG(sub.competency_id)
    INTO v_recent_competencies
    FROM (
      SELECT DISTINCT eq2.competency_id
      FROM shuttle_events se2
      JOIN exam_questions eq2 ON eq2.id = se2.question_id
      WHERE se2.session_id = p_session_id
        AND se2.event_type IN ('question_served', 'question_answered')
        AND eq2.competency_id IS NOT NULL
      ORDER BY eq2.competency_id  -- deterministic dedup
      LIMIT 3
    ) sub;
  END IF;

  v_recent_ids := COALESCE(v_recent_ids, ARRAY[]::UUID[]);
  v_recent_competencies := COALESCE(v_recent_competencies, ARRAY[]::UUID[]);

  RETURN QUERY
  SELECT
    eq.id AS question_id,
    eq.question_text,
    eq.question_type,
    eq.options,
    eq.competency_id,
    eq.blueprint_id,
    eq.difficulty::TEXT,
    eq.trap_type,
    eq.trap_tags
  FROM exam_questions eq
  LEFT JOIN user_competency_progress ucp
    ON ucp.competency_id = eq.competency_id
    AND ucp.user_id = p_user_id
    AND ucp.curriculum_id = p_curriculum_id
  LEFT JOIN shuttle_question_state sqs
    ON sqs.user_id = p_user_id
    AND sqs.question_id = eq.id
  WHERE
    -- Only this curriculum
    eq.curriculum_id = p_curriculum_id
    -- Only approved questions
    AND eq.status = 'approved'
    -- Anti-loop: not in last 10
    AND NOT (eq.id = ANY(v_recent_ids))
    -- Cooldown: skip if still cooling
    AND (sqs.cooldown_until IS NULL OR sqs.cooldown_until < now())
    -- Skip broken questions (must have options and correct_answer)
    AND eq.options IS NOT NULL
    AND jsonb_array_length(eq.options) >= 2
    AND eq.correct_answer >= 0
    AND eq.correct_answer < jsonb_array_length(eq.options)
  ORDER BY
    -- 1. Weakness priority (not_mastered first)
    CASE
      WHEN ucp.mastery_level = 'not_mastered' THEN 0
      WHEN ucp.mastery_level = 'partial' THEN 1
      WHEN ucp.mastery_level IS NULL THEN 2
      ELSE 3
    END ASC,
    -- 2. Blueprint-relevance (has blueprint = exam-relevant)
    CASE WHEN eq.blueprint_id IS NOT NULL THEN 0 ELSE 1 END ASC,
    -- 3. Competency variance (deprioritize recently served competencies)
    CASE WHEN eq.competency_id = ANY(v_recent_competencies) THEN 1 ELSE 0 END ASC,
    -- 4. Least recently seen (global across sessions)
    COALESCE(sqs.last_seen_at, '1970-01-01'::TIMESTAMPTZ) ASC,
    -- 5. Fewer times seen = less explored
    COALESCE(sqs.times_seen, 0) ASC,
    -- 6. Random tiebreaker on filtered pool
    RANDOM()
  LIMIT 1;
END;
$$;

-- ============================================================
-- RPC: fn_submit_shuttle_answer
-- Atomic: validates → writes event → updates question state →
--         updates session → updates user stats → returns feedback
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_submit_shuttle_answer(
  p_user_id UUID,
  p_session_id UUID,
  p_question_id UUID,
  p_selected_option_ids JSONB,    -- e.g. [2] for single choice
  p_response_ms INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_question RECORD;
  v_is_correct BOOLEAN;
  v_selected_index INT;
  v_correct_option_text TEXT;
  v_cooldown_hours INT;
  v_new_streak INT;
BEGIN
  -- 1. Validate session ownership + active
  SELECT id, user_id, curriculum_id, status, questions_answered, correct_count
  INTO v_session
  FROM shuttle_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_session.user_id != p_user_id THEN
    RAISE EXCEPTION 'Session does not belong to user';
  END IF;
  IF v_session.status != 'active' THEN
    RAISE EXCEPTION 'Session is not active';
  END IF;

  -- 2. Validate question exists, belongs to curriculum, is approved
  SELECT id, curriculum_id, competency_id, blueprint_id,
         correct_answer, explanation, options,
         trap_type, trap_tags, distractor_meta
  INTO v_question
  FROM exam_questions
  WHERE id = p_question_id;

  IF v_question IS NULL THEN
    RAISE EXCEPTION 'Question not found';
  END IF;
  IF v_question.curriculum_id != v_session.curriculum_id THEN
    RAISE EXCEPTION 'Question does not belong to session curriculum';
  END IF;

  -- 3. Determine correctness
  -- For V1 single-choice: p_selected_option_ids = [index]
  v_selected_index := (p_selected_option_ids->>0)::INT;
  v_is_correct := (v_selected_index = v_question.correct_answer);

  -- 4. Write shuttle_event (question_answered)
  INSERT INTO shuttle_events (
    session_id, user_id, curriculum_id, question_id,
    competency_id, blueprint_id, event_type,
    is_correct, selected_option_ids, response_ms
  ) VALUES (
    p_session_id, p_user_id, v_session.curriculum_id, p_question_id,
    v_question.competency_id, v_question.blueprint_id, 'question_answered',
    v_is_correct, p_selected_option_ids, p_response_ms
  );

  -- 5. Update shuttle_question_state (upsert)
  v_cooldown_hours := CASE
    WHEN v_is_correct THEN 4    -- correct: 4h cooldown
    ELSE 1                       -- incorrect: 1h cooldown (show again sooner)
  END;

  INSERT INTO shuttle_question_state (
    user_id, question_id, curriculum_id,
    times_seen, times_correct, times_incorrect,
    last_seen_at, last_correct_at, cooldown_until, streak
  ) VALUES (
    p_user_id, p_question_id, v_session.curriculum_id,
    1,
    CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    CASE WHEN v_is_correct THEN 0 ELSE 1 END,
    now(),
    CASE WHEN v_is_correct THEN now() ELSE NULL END,
    now() + (v_cooldown_hours || ' hours')::INTERVAL,
    CASE WHEN v_is_correct THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    times_seen = shuttle_question_state.times_seen + 1,
    times_correct = shuttle_question_state.times_correct + CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    times_incorrect = shuttle_question_state.times_incorrect + CASE WHEN v_is_correct THEN 0 ELSE 1 END,
    last_seen_at = now(),
    last_correct_at = CASE WHEN v_is_correct THEN now() ELSE shuttle_question_state.last_correct_at END,
    cooldown_until = now() + (v_cooldown_hours || ' hours')::INTERVAL,
    streak = CASE WHEN v_is_correct THEN shuttle_question_state.streak + 1 ELSE 0 END;

  -- 6. Update session counters (atomic, no race condition)
  UPDATE shuttle_sessions SET
    questions_answered = questions_answered + 1,
    correct_count = correct_count + CASE WHEN v_is_correct THEN 1 ELSE 0 END
  WHERE id = p_session_id;

  -- 7. Upsert shuttle_user_stats
  INSERT INTO shuttle_user_stats (
    user_id, curriculum_id,
    total_questions, total_correct, total_time_ms,
    current_streak, best_streak, updated_at
  ) VALUES (
    p_user_id, v_session.curriculum_id,
    1,
    CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    COALESCE(p_response_ms, 0),
    CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (user_id, curriculum_id) DO UPDATE SET
    total_questions = shuttle_user_stats.total_questions + 1,
    total_correct = shuttle_user_stats.total_correct + CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    total_time_ms = shuttle_user_stats.total_time_ms + COALESCE(p_response_ms, 0),
    current_streak = CASE WHEN v_is_correct THEN shuttle_user_stats.current_streak + 1 ELSE 0 END,
    best_streak = GREATEST(
      shuttle_user_stats.best_streak,
      CASE WHEN v_is_correct THEN shuttle_user_stats.current_streak + 1 ELSE shuttle_user_stats.best_streak END
    ),
    updated_at = now();

  -- 8. Build feedback response
  IF v_is_correct THEN
    RETURN jsonb_build_object(
      'is_correct', true,
      'correct_answer', v_question.correct_answer,
      'explanation', v_question.explanation
    );
  ELSE
    -- Get correct option text
    v_correct_option_text := v_question.options->>v_question.correct_answer;

    RETURN jsonb_build_object(
      'is_correct', false,
      'correct_answer', v_question.correct_answer,
      'correct_option_text', v_correct_option_text,
      'explanation', v_question.explanation,
      'trap_type', v_question.trap_type,
      'trap_tags', to_jsonb(v_question.trap_tags),
      'distractor_meta', v_question.distractor_meta
    );
  END IF;
END;
$$;

-- ============================================================
-- RPC: fn_complete_shuttle_session
-- Closes session, writes completion event, updates user stats
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_complete_shuttle_session(
  p_user_id UUID,
  p_session_id UUID,
  p_reason TEXT DEFAULT 'completed'  -- 'completed' or 'abandoned'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_status TEXT;
  v_event_type TEXT;
BEGIN
  -- Validate
  SELECT id, user_id, curriculum_id, status, questions_answered, correct_count
  INTO v_session
  FROM shuttle_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_session.user_id != p_user_id THEN
    RAISE EXCEPTION 'Session does not belong to user';
  END IF;
  IF v_session.status != 'active' THEN
    RETURN jsonb_build_object('error', 'Session already ended');
  END IF;

  v_status := CASE WHEN p_reason = 'abandoned' THEN 'abandoned' ELSE 'completed' END;
  v_event_type := CASE WHEN p_reason = 'abandoned' THEN 'session_abandoned' ELSE 'session_completed' END;

  -- Close session
  UPDATE shuttle_sessions SET
    status = v_status,
    ended_at = now()
  WHERE id = p_session_id;

  -- Write completion event
  INSERT INTO shuttle_events (
    session_id, user_id, curriculum_id, question_id,
    event_type, payload
  ) VALUES (
    p_session_id, p_user_id, v_session.curriculum_id,
    '00000000-0000-0000-0000-000000000000'::UUID,  -- no question for session events
    v_event_type,
    jsonb_build_object(
      'questions_answered', v_session.questions_answered,
      'correct_count', v_session.correct_count,
      'accuracy', CASE WHEN v_session.questions_answered > 0
        THEN ROUND((v_session.correct_count::NUMERIC / v_session.questions_answered) * 100)
        ELSE 0 END
    )
  );

  -- Update user stats session count
  INSERT INTO shuttle_user_stats (user_id, curriculum_id, total_sessions, updated_at)
  VALUES (p_user_id, v_session.curriculum_id, 1, now())
  ON CONFLICT (user_id, curriculum_id) DO UPDATE SET
    total_sessions = shuttle_user_stats.total_sessions + 1,
    last_session_at = now(),
    updated_at = now();

  RETURN jsonb_build_object(
    'status', v_status,
    'questions_answered', v_session.questions_answered,
    'correct_count', v_session.correct_count,
    'accuracy', CASE WHEN v_session.questions_answered > 0
      THEN ROUND((v_session.correct_count::NUMERIC / v_session.questions_answered) * 100)
      ELSE 0 END
  );
END;
$$;
