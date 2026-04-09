
-- ═══════════════════════════════════════════════════════════
-- 1. EXTEND shuttle_sessions with missing columns
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.shuttle_sessions
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'adaptive'
    CHECK (mode IN ('adaptive','random','weakness','speed','exam_lite')),
  ADD COLUMN IF NOT EXISTS current_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_streak INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS xp_earned INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_response_ms INTEGER,
  ADD COLUMN IF NOT EXISTS started_from TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Add status column with check constraint if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shuttle_sessions' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.shuttle_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  END IF;
END $$;

-- Add check constraint for status if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shuttle_sessions_status_check'
  ) THEN
    ALTER TABLE public.shuttle_sessions
      ADD CONSTRAINT shuttle_sessions_status_check
      CHECK (status IN ('active','completed','abandoned'));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shuttle_sessions_user_status
  ON shuttle_sessions (user_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_shuttle_events_session_type
  ON shuttle_events (session_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_shuttle_question_state_user_curriculum
  ON shuttle_question_state (user_id, curriculum_id);

-- ═══════════════════════════════════════════════════════════
-- 2. fn_get_or_create_shuttle_session
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_get_or_create_shuttle_session(
  p_user_id UUID,
  p_curriculum_id UUID,
  p_mode TEXT DEFAULT 'adaptive',
  p_started_from TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_new_id UUID;
BEGIN
  -- Find existing active session for same user+curriculum+mode
  SELECT id, started_at, mode, questions_answered, correct_count,
         current_streak, best_streak, xp_earned
  INTO v_session
  FROM shuttle_sessions
  WHERE user_id = p_user_id
    AND curriculum_id = p_curriculum_id
    AND status = 'active'
    AND mode = p_mode
    AND started_at > now() - INTERVAL '2 hours'
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_session.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_session.id,
      'started_at', v_session.started_at,
      'mode', v_session.mode,
      'questions_answered', v_session.questions_answered,
      'correct_count', v_session.correct_count,
      'current_streak', v_session.current_streak,
      'best_streak', v_session.best_streak,
      'xp_earned', v_session.xp_earned,
      'resumed', true
    );
  END IF;

  -- Create new session
  INSERT INTO shuttle_sessions (user_id, curriculum_id, mode, started_from)
  VALUES (p_user_id, p_curriculum_id, p_mode, p_started_from)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'id', v_new_id,
    'started_at', now(),
    'mode', p_mode,
    'questions_answered', 0,
    'correct_count', 0,
    'current_streak', 0,
    'best_streak', 0,
    'xp_earned', 0,
    'resumed', false
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. fn_get_shuttle_dashboard_summary
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_get_shuttle_dashboard_summary(
  p_user_id UUID,
  p_curriculum_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today_answered INT;
  v_today_correct INT;
  v_stats RECORD;
  v_weakest RECORD;
  v_recommended_mode TEXT;
BEGIN
  -- Today's stats from shuttle_events
  SELECT
    COUNT(*) FILTER (WHERE event_type = 'question_answered'),
    COUNT(*) FILTER (WHERE event_type = 'question_answered' AND is_correct = true)
  INTO v_today_answered, v_today_correct
  FROM shuttle_events
  WHERE user_id = p_user_id
    AND curriculum_id = p_curriculum_id
    AND occurred_at >= CURRENT_DATE;

  -- Lifetime stats
  SELECT
    COALESCE(total_questions, 0) AS total_questions,
    COALESCE(total_correct, 0) AS total_correct,
    COALESCE(current_streak, 0) AS current_streak,
    COALESCE(best_streak, 0) AS best_streak,
    COALESCE(total_sessions, 0) AS total_sessions
  INTO v_stats
  FROM shuttle_user_stats
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  IF v_stats IS NULL THEN
    v_stats := ROW(0,0,0,0,0);
  END IF;

  -- Weakest competency
  SELECT comp.title, ucp.score, ucp.competency_id
  INTO v_weakest
  FROM user_competency_progress ucp
  JOIN competencies comp ON comp.id = ucp.competency_id
  WHERE ucp.user_id = p_user_id
    AND ucp.curriculum_id = p_curriculum_id
  ORDER BY ucp.score ASC
  LIMIT 1;

  -- Recommend mode
  IF v_weakest.score IS NOT NULL AND v_weakest.score < 40 THEN
    v_recommended_mode := 'weakness';
  ELSIF v_today_answered < 5 THEN
    v_recommended_mode := 'adaptive';
  ELSE
    v_recommended_mode := 'exam_lite';
  END IF;

  RETURN jsonb_build_object(
    'today_answered', COALESCE(v_today_answered, 0),
    'today_correct', COALESCE(v_today_correct, 0),
    'today_accuracy', CASE WHEN COALESCE(v_today_answered, 0) > 0
      THEN ROUND(COALESCE(v_today_correct, 0)::numeric / v_today_answered * 100)
      ELSE 0 END,
    'lifetime_questions', v_stats.total_questions,
    'lifetime_correct', v_stats.total_correct,
    'lifetime_accuracy', CASE WHEN v_stats.total_questions > 0
      THEN ROUND(v_stats.total_correct::numeric / v_stats.total_questions * 100)
      ELSE 0 END,
    'current_streak', v_stats.current_streak,
    'best_streak', v_stats.best_streak,
    'total_sessions', v_stats.total_sessions,
    'weakest_competency', CASE WHEN v_weakest.title IS NOT NULL THEN
      jsonb_build_object(
        'id', v_weakest.competency_id,
        'title', v_weakest.title,
        'score', v_weakest.score
      ) ELSE NULL END,
    'recommended_mode', v_recommended_mode
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. REPLACE fn_select_next_shuttle_question with mode support
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_select_next_shuttle_question(
  p_user_id UUID,
  p_curriculum_id UUID,
  p_session_id UUID,
  p_mode TEXT DEFAULT 'adaptive'
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
  v_eff_mode TEXT;
BEGIN
  v_eff_mode := COALESCE(p_mode, 'adaptive');

  -- Session validation
  SELECT s.id, s.user_id, s.curriculum_id, s.status, s.mode
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

  -- Use session mode if not explicitly overridden
  IF v_eff_mode = 'adaptive' AND v_session.mode IS NOT NULL THEN
    v_eff_mode := v_session.mode;
  END IF;

  -- Anti-loop: last 10 questions
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

  -- Anti-loop: last 3 competencies
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

  -- Mode-based selection
  IF v_eff_mode = 'weakness' THEN
    -- Only questions from weak competencies
    SELECT eq.id INTO v_selected_id
    FROM exam_questions eq
    JOIN user_competency_progress ucp
      ON ucp.competency_id = eq.competency_id
      AND ucp.user_id = p_user_id
      AND ucp.curriculum_id = p_curriculum_id
    LEFT JOIN shuttle_question_state sqs
      ON sqs.user_id = p_user_id AND sqs.question_id = eq.id
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'approved'
      AND NOT (eq.id = ANY(v_recent_ids))
      AND (sqs.cooldown_until IS NULL OR sqs.cooldown_until < now())
      AND eq.options IS NOT NULL
      AND jsonb_array_length(eq.options) >= 2
      AND eq.correct_answer >= 0
      AND eq.correct_answer < jsonb_array_length(eq.options)
      AND ucp.mastery_level IN ('not_mastered', 'partial')
    ORDER BY
      ucp.score ASC,
      COALESCE(sqs.last_seen_at, '1970-01-01'::TIMESTAMPTZ) ASC,
      RANDOM()
    LIMIT 1;

  ELSIF v_eff_mode = 'random' THEN
    -- Pure random from eligible questions
    SELECT eq.id INTO v_selected_id
    FROM exam_questions eq
    LEFT JOIN shuttle_question_state sqs
      ON sqs.user_id = p_user_id AND sqs.question_id = eq.id
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'approved'
      AND NOT (eq.id = ANY(v_recent_ids))
      AND (sqs.cooldown_until IS NULL OR sqs.cooldown_until < now())
      AND eq.options IS NOT NULL
      AND jsonb_array_length(eq.options) >= 2
      AND eq.correct_answer >= 0
      AND eq.correct_answer < jsonb_array_length(eq.options)
    ORDER BY RANDOM()
    LIMIT 1;

  ELSIF v_eff_mode = 'speed' THEN
    -- Prefer questions user has seen before (for speed drill)
    SELECT eq.id INTO v_selected_id
    FROM exam_questions eq
    LEFT JOIN shuttle_question_state sqs
      ON sqs.user_id = p_user_id AND sqs.question_id = eq.id
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'approved'
      AND NOT (eq.id = ANY(v_recent_ids))
      AND (sqs.cooldown_until IS NULL OR sqs.cooldown_until < now())
      AND eq.options IS NOT NULL
      AND jsonb_array_length(eq.options) >= 2
      AND eq.correct_answer >= 0
      AND eq.correct_answer < jsonb_array_length(eq.options)
    ORDER BY
      COALESCE(sqs.times_seen, 0) DESC,
      CASE WHEN eq.difficulty = 'easy' THEN 0 WHEN eq.difficulty = 'medium' THEN 1 ELSE 2 END ASC,
      RANDOM()
    LIMIT 1;

  ELSIF v_eff_mode = 'exam_lite' THEN
    -- Blueprint-first, exam-relevance weighted
    SELECT eq.id INTO v_selected_id
    FROM exam_questions eq
    LEFT JOIN user_competency_progress ucp
      ON ucp.competency_id = eq.competency_id
      AND ucp.user_id = p_user_id
      AND ucp.curriculum_id = p_curriculum_id
    LEFT JOIN shuttle_question_state sqs
      ON sqs.user_id = p_user_id AND sqs.question_id = eq.id
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'approved'
      AND NOT (eq.id = ANY(v_recent_ids))
      AND (sqs.cooldown_until IS NULL OR sqs.cooldown_until < now())
      AND eq.options IS NOT NULL
      AND jsonb_array_length(eq.options) >= 2
      AND eq.correct_answer >= 0
      AND eq.correct_answer < jsonb_array_length(eq.options)
    ORDER BY
      CASE WHEN eq.blueprint_id IS NOT NULL THEN 0 ELSE 1 END ASC,
      CASE WHEN eq.difficulty = 'hard' THEN 0 WHEN eq.difficulty = 'medium' THEN 1 ELSE 2 END ASC,
      CASE WHEN eq.competency_id = ANY(v_recent_competencies) THEN 1 ELSE 0 END ASC,
      RANDOM()
    LIMIT 1;

  ELSE
    -- adaptive (default): weighted selection
    SELECT eq.id INTO v_selected_id
    FROM exam_questions eq
    LEFT JOIN user_competency_progress ucp
      ON ucp.competency_id = eq.competency_id
      AND ucp.user_id = p_user_id
      AND ucp.curriculum_id = p_curriculum_id
    LEFT JOIN shuttle_question_state sqs
      ON sqs.user_id = p_user_id AND sqs.question_id = eq.id
    WHERE eq.curriculum_id = p_curriculum_id
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
  END IF;

  IF v_selected_id IS NULL THEN
    RETURN;
  END IF;

  -- Record question_served event
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

-- ═══════════════════════════════════════════════════════════
-- 5. REPLACE fn_submit_shuttle_answer with XP + mastery
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_submit_shuttle_answer(
  p_user_id UUID,
  p_session_id UUID,
  p_question_id UUID,
  p_selected_option_indexes JSONB,
  p_response_ms INTEGER DEFAULT NULL
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
  v_xp_awarded INT;
  v_new_streak INT;
  v_new_best_streak INT;
  v_mastery_delta NUMERIC;
BEGIN
  -- Session validation
  SELECT id, user_id, curriculum_id, status, questions_answered, correct_count,
         current_streak, best_streak, xp_earned
  INTO v_session
  FROM shuttle_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF v_session.user_id != p_user_id THEN RAISE EXCEPTION 'Session does not belong to user'; END IF;
  IF v_session.status != 'active' THEN RAISE EXCEPTION 'Session is not active'; END IF;

  -- Question validation
  SELECT id, curriculum_id, competency_id, blueprint_id,
         correct_answer, explanation, options, status,
         trap_type, trap_tags, distractor_meta
  INTO v_question
  FROM exam_questions
  WHERE id = p_question_id;

  IF v_question IS NULL THEN RAISE EXCEPTION 'Question not found'; END IF;
  IF v_question.curriculum_id != v_session.curriculum_id THEN RAISE EXCEPTION 'Question does not belong to session curriculum'; END IF;
  IF v_question.status != 'approved' THEN RAISE EXCEPTION 'Question is not approved'; END IF;

  -- Served check
  SELECT EXISTS (
    SELECT 1 FROM shuttle_events
    WHERE session_id = p_session_id AND question_id = p_question_id AND event_type = 'question_served'
  ) INTO v_was_served;
  IF NOT v_was_served THEN RAISE EXCEPTION 'Question was not served in this session'; END IF;

  -- Double-submit guard
  SELECT EXISTS (
    SELECT 1 FROM shuttle_events
    WHERE session_id = p_session_id AND question_id = p_question_id AND event_type = 'question_answered'
  ) INTO v_already_answered;
  IF v_already_answered THEN
    RETURN jsonb_build_object('error', 'Already answered', 'duplicate', true);
  END IF;

  -- Evaluate answer
  v_selected_index := (p_selected_option_indexes->>0)::INT;
  v_is_correct := (v_selected_index = v_question.correct_answer);

  -- XP calculation: 2 for correct, 1 for attempt, +1 streak bonus every 5
  v_xp_awarded := CASE WHEN v_is_correct THEN 2 ELSE 1 END;
  IF v_is_correct AND (v_session.current_streak + 1) % 5 = 0 THEN
    v_xp_awarded := v_xp_awarded + 3; -- streak bonus
  END IF;

  -- Streak calculation
  v_new_streak := CASE WHEN v_is_correct THEN v_session.current_streak + 1 ELSE 0 END;
  v_new_best_streak := GREATEST(v_session.best_streak, v_new_streak);

  -- Write answer event
  INSERT INTO shuttle_events (
    session_id, user_id, curriculum_id, question_id,
    competency_id, blueprint_id, event_type,
    is_correct, selected_option_indexes, response_ms, payload
  ) VALUES (
    p_session_id, p_user_id, v_session.curriculum_id, p_question_id,
    v_question.competency_id, v_question.blueprint_id, 'question_answered',
    v_is_correct, p_selected_option_indexes, p_response_ms,
    jsonb_build_object('xp_awarded', v_xp_awarded, 'streak', v_new_streak)
  );

  -- Cooldown
  v_cooldown_hours := CASE WHEN v_is_correct THEN 4 ELSE 1 END;

  -- Update question state
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

  -- Update session counters + streak + xp
  UPDATE shuttle_sessions SET
    questions_answered = questions_answered + 1,
    correct_count = correct_count + CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    current_streak = v_new_streak,
    best_streak = v_new_best_streak,
    xp_earned = xp_earned + v_xp_awarded,
    average_response_ms = CASE
      WHEN p_response_ms IS NOT NULL THEN
        COALESCE((average_response_ms * questions_answered + p_response_ms) / (questions_answered + 1), p_response_ms)
      ELSE average_response_ms
    END
  WHERE id = p_session_id;

  -- Update user stats
  INSERT INTO shuttle_user_stats (
    user_id, curriculum_id,
    total_questions, total_correct, total_time_ms,
    current_streak, best_streak, total_sessions, updated_at
  ) VALUES (
    p_user_id, v_session.curriculum_id,
    1, CASE WHEN v_is_correct THEN 1 ELSE 0 END, COALESCE(p_response_ms, 0),
    CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    0, now()
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

  -- Lightweight mastery influence (smaller weight than exam)
  IF v_question.competency_id IS NOT NULL THEN
    v_mastery_delta := CASE WHEN v_is_correct THEN 0.5 ELSE -0.3 END;
    UPDATE user_competency_progress SET
      score = GREATEST(0, LEAST(100, score + v_mastery_delta)),
      updated_at = now()
    WHERE user_id = p_user_id
      AND curriculum_id = v_session.curriculum_id
      AND competency_id = v_question.competency_id;
  END IF;

  -- Build response
  IF v_is_correct THEN
    RETURN jsonb_build_object(
      'is_correct', true,
      'correct_answer', v_question.correct_answer,
      'explanation', v_question.explanation,
      'xp_awarded', v_xp_awarded,
      'streak', v_new_streak,
      'best_streak', v_new_best_streak
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
      'distractor_meta', v_question.distractor_meta,
      'xp_awarded', v_xp_awarded,
      'streak', 0,
      'best_streak', v_new_best_streak
    );
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. UPDATE NBA with SHUTTLE_TRAINING + DAILY_CHALLENGE
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_next_best_action(
  p_user_id UUID,
  p_curriculum_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requesting_uid uuid;
  v_has_competency boolean;
  v_has_lessons boolean;
  v_has_exams boolean;
  v_readiness numeric;
  v_mastery_avg numeric;
  v_sim_trend numeric;
  v_risk text;
  v_due_count integer;
  v_bottleneck jsonb;
  v_critical_block jsonb;
  v_sim_scores numeric[];
  v_weighted_avg numeric;
  v_daily_challenge_open boolean;
  v_shuttle_today int;
BEGIN
  -- AUTH GUARD
  v_requesting_uid := auth.uid();
  IF v_requesting_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_requesting_uid <> p_user_id THEN
    IF NOT public.has_role(v_requesting_uid, 'admin') THEN
      RAISE EXCEPTION 'Access denied: cannot query another user''s data';
    END IF;
  END IF;

  -- ONBOARDING GATE
  SELECT EXISTS(
    SELECT 1 FROM user_competency_progress
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id LIMIT 1
  ) INTO v_has_competency;
  SELECT EXISTS(
    SELECT 1 FROM learning_progress lp
    JOIN lessons l ON l.id = lp.lesson_id
    JOIN modules m ON m.id = l.module_id
    JOIN courses c ON c.id = m.course_id
    JOIN curricula cur ON cur.id = c.curriculum_id
    WHERE lp.user_id = p_user_id AND cur.id = p_curriculum_id AND lp.completed = true LIMIT 1
  ) INTO v_has_lessons;
  SELECT EXISTS(
    SELECT 1 FROM exam_sessions es
    WHERE es.user_id = p_user_id AND es.curriculum_id = p_curriculum_id AND es.finished_at IS NOT NULL LIMIT 1
  ) INTO v_has_exams;

  IF NOT v_has_competency AND NOT v_has_lessons AND NOT v_has_exams THEN
    RETURN jsonb_build_object(
      'action', 'ONBOARDING',
      'headline', 'Willkommen! Lass uns starten.',
      'subline', 'Wir ermitteln deinen aktuellen Stand, damit du gezielt lernen kannst.',
      'cta', 'Einstufung starten',
      'route', '/readiness-check',
      'readiness_score', 0, 'risk_level', 'high', 'bottleneck', NULL,
      'intent', 'onboarding',
      'route_payload', jsonb_build_object('intent', 'onboarding', 'curriculum_id', p_curriculum_id)
    );
  END IF;

  -- Mastery average
  SELECT COALESCE(AVG(
    CASE WHEN mastery_level = 'mastered' THEN score
         WHEN mastery_level = 'partial' THEN score * 0.5
         ELSE score * 0.25 END
  ), 0) INTO v_mastery_avg
  FROM user_competency_progress
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id;

  -- Sim scores
  SELECT ARRAY(
    SELECT COALESCE(es.score_percentage, 0)
    FROM exam_sessions es
    WHERE es.user_id = p_user_id AND es.curriculum_id = p_curriculum_id
      AND es.finished_at IS NOT NULL AND es.score_percentage IS NOT NULL
    ORDER BY es.finished_at DESC LIMIT 3
  ) INTO v_sim_scores;

  IF array_length(v_sim_scores, 1) >= 3 THEN
    v_weighted_avg := v_sim_scores[1] * 0.5 + v_sim_scores[2] * 0.3 + v_sim_scores[3] * 0.2;
  ELSIF array_length(v_sim_scores, 1) = 2 THEN
    v_weighted_avg := v_sim_scores[1] * 0.6 + v_sim_scores[2] * 0.4;
  ELSIF array_length(v_sim_scores, 1) = 1 THEN
    v_weighted_avg := v_sim_scores[1];
  ELSE v_weighted_avg := 0;
  END IF;

  v_sim_trend := v_weighted_avg;
  v_readiness := 0.7 * v_mastery_avg + 0.3 * v_sim_trend;
  IF v_readiness >= 75 THEN v_risk := 'low';
  ELSIF v_readiness >= 50 THEN v_risk := 'medium';
  ELSE v_risk := 'high'; END IF;

  -- Bottleneck
  SELECT jsonb_build_object(
    'id', ucp.competency_id, 'title', COALESCE(comp.title, 'Unbekannte Kompetenz'),
    'field', COALESCE(lf.title, ''), 'score', ucp.score
  ) INTO v_bottleneck
  FROM user_competency_progress ucp
  LEFT JOIN competencies comp ON comp.id = ucp.competency_id
  LEFT JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE ucp.user_id = p_user_id AND ucp.curriculum_id = p_curriculum_id
  ORDER BY ucp.score ASC LIMIT 1;

  -- ══ NEW: DAILY CHALLENGE check ══
  SELECT NOT EXISTS(
    SELECT 1 FROM daily_challenges
    WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
      AND challenge_date = CURRENT_DATE AND completed = true
  ) INTO v_daily_challenge_open;

  IF v_daily_challenge_open THEN
    RETURN jsonb_build_object(
      'action', 'DAILY_CHALLENGE',
      'headline', 'Deine tägliche Challenge wartet!',
      'subline', '3–5 Fragen – halte deine Streak am Leben.',
      'cta', 'Challenge starten',
      'route', '/daily-challenge',
      'readiness_score', ROUND(v_readiness), 'risk_level', v_risk,
      'bottleneck', v_bottleneck, 'intent', 'daily_challenge',
      'route_payload', jsonb_build_object('intent', 'daily_challenge', 'curriculum_id', p_curriculum_id)
    );
  END IF;

  -- ══ NEW: SHUTTLE_TRAINING (few questions today, low friction) ══
  SELECT COUNT(*)::int INTO v_shuttle_today
  FROM shuttle_events
  WHERE user_id = p_user_id AND curriculum_id = p_curriculum_id
    AND event_type = 'question_answered' AND occurred_at >= CURRENT_DATE;

  IF v_shuttle_today < 10 AND v_risk IN ('medium', 'high') THEN
    RETURN jsonb_build_object(
      'action', 'SHUTTLE_TRAINING',
      'headline', '2 Min Schnelltraining',
      'subline', 'Trainiere gezielt deine Schwächen – schnell und effektiv.',
      'cta', 'Jetzt trainieren',
      'route', '/shuttle',
      'readiness_score', ROUND(v_readiness), 'risk_level', v_risk,
      'bottleneck', v_bottleneck, 'intent', 'shuttle_training',
      'route_payload', jsonb_build_object(
        'intent', 'shuttle_training', 'curriculum_id', p_curriculum_id,
        'mode', CASE WHEN v_risk = 'high' THEN 'weakness' ELSE 'adaptive' END
      )
    );
  END IF;

  -- Spaced repetition
  SELECT COUNT(*)::integer INTO v_due_count
  FROM spaced_repetition_cards src
  WHERE src.user_id = p_user_id AND src.curriculum_id = p_curriculum_id AND src.next_review_at <= now();

  IF v_due_count >= 5 THEN
    RETURN jsonb_build_object(
      'action', 'SPACED_REPETITION',
      'headline', format('%s Wiederholungen fällig', v_due_count),
      'subline', 'Sichere dein Wissen, bevor du weiter lernst.',
      'cta', 'Jetzt wiederholen', 'route', '/spaced-repetition',
      'readiness_score', ROUND(v_readiness), 'risk_level', v_risk,
      'bottleneck', v_bottleneck, 'intent', 'spaced_repetition',
      'route_payload', jsonb_build_object('intent', 'spaced_repetition', 'curriculum_id', p_curriculum_id, 'due_count', v_due_count)
    );
  END IF;

  -- Critical competency gate
  SELECT jsonb_build_object(
    'id', ucp.competency_id, 'title', COALESCE(comp.title, 'Unbekannte Kompetenz'),
    'field', COALESCE(lf.title, ''), 'score', ucp.score
  ) INTO v_critical_block
  FROM user_competency_progress ucp
  JOIN competencies comp ON comp.id = ucp.competency_id
  LEFT JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE ucp.user_id = p_user_id AND ucp.curriculum_id = p_curriculum_id
    AND ucp.score < 50 AND ucp.mastery_level = 'not_mastered'
  ORDER BY ucp.score ASC LIMIT 1;

  IF v_critical_block IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', 'WEAKNESS_TRAINING',
      'headline', 'Kritische Lücke schließen',
      'subline', format('%s ist bestehensrelevant und noch zu schwach.', v_critical_block->>'title'),
      'cta', 'Jetzt gezielt trainieren', 'route', '/exam-trainer',
      'readiness_score', ROUND(v_readiness), 'risk_level', 'high',
      'bottleneck', v_critical_block, 'intent', 'critical_competency_gate',
      'route_payload', jsonb_build_object('intent', 'critical_competency_gate', 'curriculum_id', p_curriculum_id, 'competency_id', v_critical_block->>'id')
    );
  END IF;

  -- Weakness training
  IF v_risk IN ('high', 'medium') THEN
    RETURN jsonb_build_object(
      'action', 'WEAKNESS_TRAINING',
      'headline', 'Gezielt Schwächen abbauen',
      'subline', format('Dein Engpass: %s', COALESCE(v_bottleneck->>'title', 'Unbekannt')),
      'cta', 'Schwäche trainieren', 'route', '/exam-trainer',
      'readiness_score', ROUND(v_readiness), 'risk_level', v_risk,
      'bottleneck', v_bottleneck, 'intent', 'weakness_training',
      'route_payload', jsonb_build_object('intent', 'weakness_training', 'curriculum_id', p_curriculum_id, 'competency_id', v_bottleneck->>'id')
    );
  END IF;

  -- Exam simulation
  IF v_readiness < 85 THEN
    RETURN jsonb_build_object(
      'action', 'EXAM_SIMULATION',
      'headline', 'Bereit für eine Simulation',
      'subline', format('Prüfungsreife: %s%% – teste dich unter Realbedingungen.', ROUND(v_readiness)),
      'cta', 'Simulation starten', 'route', '/exam-simulation',
      'readiness_score', ROUND(v_readiness), 'risk_level', v_risk,
      'bottleneck', v_bottleneck, 'intent', 'exam_simulation',
      'route_payload', jsonb_build_object('intent', 'exam_simulation', 'curriculum_id', p_curriculum_id)
    );
  END IF;

  -- Exam final
  RETURN jsonb_build_object(
    'action', 'EXAM_FINAL',
    'headline', 'Du bist prüfungsreif!',
    'subline', format('Prüfungsreife: %s%% – Finale Generalprobe empfohlen.', ROUND(v_readiness)),
    'cta', 'Generalprobe starten', 'route', '/exam-simulation',
    'readiness_score', ROUND(v_readiness), 'risk_level', v_risk,
    'bottleneck', v_bottleneck, 'intent', 'exam_final',
    'route_payload', jsonb_build_object('intent', 'exam_final', 'curriculum_id', p_curriculum_id)
  );
END;
$$;
