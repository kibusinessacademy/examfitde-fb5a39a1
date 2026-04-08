
-- Fix 1: question_id nullable + rename field
ALTER TABLE public.shuttle_events
  ALTER COLUMN question_id DROP NOT NULL;

ALTER TABLE public.shuttle_events
  RENAME COLUMN selected_option_ids TO selected_option_indexes;

-- Fix 2: Double-submit unique index
CREATE UNIQUE INDEX idx_shuttle_events_no_double_answer
  ON public.shuttle_events (session_id, question_id)
  WHERE event_type = 'question_answered' AND question_id IS NOT NULL;

-- Fix 3: Remove client INSERT policy
DROP POLICY IF EXISTS "shuttle_sessions_insert_own" ON public.shuttle_sessions;

-- Fix 4: Drop old RPCs with old signatures before recreating
DROP FUNCTION IF EXISTS public.fn_submit_shuttle_answer(UUID, UUID, UUID, JSONB, INT);
DROP FUNCTION IF EXISTS public.fn_select_next_shuttle_question(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_complete_shuttle_session(UUID, UUID, TEXT);

-- ===== fn_start_shuttle_session (NEW) =====
CREATE OR REPLACE FUNCTION public.fn_start_shuttle_session(
  p_user_id UUID,
  p_curriculum_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id UUID;
  v_started_at TIMESTAMPTZ;
BEGIN
  INSERT INTO shuttle_sessions (user_id, curriculum_id)
  VALUES (p_user_id, p_curriculum_id)
  RETURNING id, started_at INTO v_session_id, v_started_at;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'started_at', v_started_at
  );
END;
$$;

-- ===== fn_select_next_shuttle_question =====
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
  v_selected_id UUID;
  v_session RECORD;
BEGIN
  SELECT s.id, s.user_id, s.curriculum_id, s.status
  INTO v_session
  FROM shuttle_sessions s
  WHERE s.id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF v_session.user_id != p_user_id THEN
    RAISE EXCEPTION 'Session does not belong to user';
  END IF;
  IF v_session.status != 'active' THEN
    RAISE EXCEPTION 'Session is not active';
  END IF;

  SELECT ARRAY_AGG(sub.question_id)
  INTO v_recent_ids
  FROM (
    SELECT se.question_id
    FROM shuttle_events se
    WHERE se.session_id = p_session_id
      AND se.event_type IN ('question_served', 'question_answered')
      AND se.question_id IS NOT NULL
    ORDER BY se.occurred_at DESC
    LIMIT 10
  ) sub;

  v_recent_ids := COALESCE(v_recent_ids, ARRAY[]::UUID[]);

  SELECT ARRAY_AGG(sub.cid)
  INTO v_recent_competencies
  FROM (
    SELECT eq2.competency_id AS cid
    FROM shuttle_events se2
    JOIN exam_questions eq2 ON eq2.id = se2.question_id
    WHERE se2.session_id = p_session_id
      AND se2.event_type = 'question_served'
      AND se2.question_id IS NOT NULL
      AND eq2.competency_id IS NOT NULL
    ORDER BY se2.occurred_at DESC
    LIMIT 3
  ) sub;

  v_recent_competencies := COALESCE(v_recent_competencies, ARRAY[]::UUID[]);

  SELECT eq.id INTO v_selected_id
  FROM exam_questions eq
  LEFT JOIN user_competency_progress ucp
    ON ucp.competency_id = eq.competency_id
    AND ucp.user_id = p_user_id
    AND ucp.curriculum_id = p_curriculum_id
  LEFT JOIN shuttle_question_state sqs
    ON sqs.user_id = p_user_id
    AND sqs.question_id = eq.id
  WHERE
    eq.curriculum_id = p_curriculum_id
    AND eq.status = 'approved'
    AND NOT (eq.id = ANY(v_recent_ids))
    AND (sqs.cooldown_until IS NULL OR sqs.cooldown_until < now())
    AND eq.options IS NOT NULL
    AND jsonb_array_length(eq.options) >= 2
    AND eq.correct_answer >= 0
    AND eq.correct_answer < jsonb_array_length(eq.options)
  ORDER BY
    CASE
      WHEN ucp.mastery_level = 'not_mastered' THEN 0
      WHEN ucp.mastery_level = 'partial' THEN 1
      WHEN ucp.mastery_level IS NULL THEN 2
      ELSE 3
    END ASC,
    CASE WHEN eq.blueprint_id IS NOT NULL THEN 0 ELSE 1 END ASC,
    CASE WHEN eq.competency_id = ANY(v_recent_competencies) THEN 1 ELSE 0 END ASC,
    COALESCE(sqs.last_seen_at, '1970-01-01'::TIMESTAMPTZ) ASC,
    COALESCE(sqs.times_seen, 0) ASC,
    RANDOM()
  LIMIT 1;

  IF v_selected_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO shuttle_events (
    session_id, user_id, curriculum_id, question_id,
    competency_id, blueprint_id, event_type
  )
  SELECT
    p_session_id, p_user_id, p_curriculum_id, eq.id,
    eq.competency_id, eq.blueprint_id, 'question_served'
  FROM exam_questions eq WHERE eq.id = v_selected_id;

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
  WHERE eq.id = v_selected_id;
END;
$$;

-- ===== fn_submit_shuttle_answer =====
CREATE OR REPLACE FUNCTION public.fn_submit_shuttle_answer(
  p_user_id UUID,
  p_session_id UUID,
  p_question_id UUID,
  p_selected_option_indexes JSONB,
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
  v_already_answered BOOLEAN;
  v_was_served BOOLEAN;
BEGIN
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

  SELECT id, curriculum_id, competency_id, blueprint_id,
         correct_answer, explanation, options, status,
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
  IF v_question.status != 'approved' THEN
    RAISE EXCEPTION 'Question is not approved';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM shuttle_events
    WHERE session_id = p_session_id
      AND question_id = p_question_id
      AND event_type = 'question_served'
  ) INTO v_was_served;

  IF NOT v_was_served THEN
    RAISE EXCEPTION 'Question was not served in this session';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM shuttle_events
    WHERE session_id = p_session_id
      AND question_id = p_question_id
      AND event_type = 'question_answered'
  ) INTO v_already_answered;

  IF v_already_answered THEN
    RETURN jsonb_build_object('error', 'Already answered', 'duplicate', true);
  END IF;

  v_selected_index := (p_selected_option_indexes->>0)::INT;
  v_is_correct := (v_selected_index = v_question.correct_answer);

  INSERT INTO shuttle_events (
    session_id, user_id, curriculum_id, question_id,
    competency_id, blueprint_id, event_type,
    is_correct, selected_option_indexes, response_ms
  ) VALUES (
    p_session_id, p_user_id, v_session.curriculum_id, p_question_id,
    v_question.competency_id, v_question.blueprint_id, 'question_answered',
    v_is_correct, p_selected_option_indexes, p_response_ms
  );

  v_cooldown_hours := CASE WHEN v_is_correct THEN 4 ELSE 1 END;

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

  UPDATE shuttle_sessions SET
    questions_answered = questions_answered + 1,
    correct_count = correct_count + CASE WHEN v_is_correct THEN 1 ELSE 0 END
  WHERE id = p_session_id;

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

  IF v_is_correct THEN
    RETURN jsonb_build_object(
      'is_correct', true,
      'correct_answer', v_question.correct_answer,
      'explanation', v_question.explanation
    );
  ELSE
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

-- ===== fn_complete_shuttle_session =====
CREATE OR REPLACE FUNCTION public.fn_complete_shuttle_session(
  p_user_id UUID,
  p_session_id UUID,
  p_reason TEXT DEFAULT 'completed'
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

  UPDATE shuttle_sessions SET
    status = v_status,
    ended_at = now()
  WHERE id = p_session_id;

  INSERT INTO shuttle_events (
    session_id, user_id, curriculum_id, question_id,
    event_type, payload
  ) VALUES (
    p_session_id, p_user_id, v_session.curriculum_id,
    NULL,
    v_event_type,
    jsonb_build_object(
      'questions_answered', v_session.questions_answered,
      'correct_count', v_session.correct_count,
      'accuracy', CASE WHEN v_session.questions_answered > 0
        THEN ROUND((v_session.correct_count::NUMERIC / v_session.questions_answered) * 100)
        ELSE 0 END
    )
  );

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
