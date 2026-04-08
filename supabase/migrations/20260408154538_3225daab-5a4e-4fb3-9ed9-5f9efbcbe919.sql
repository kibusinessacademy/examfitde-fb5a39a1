
-- ============================================================
-- Shuttle Mode: Sessions & Events
-- ============================================================

CREATE TABLE public.shuttle_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  questions_answered INT NOT NULL DEFAULT 0,
  correct_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  xp_earned INT NOT NULL DEFAULT 0
);

ALTER TABLE public.shuttle_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own shuttle sessions"
  ON public.shuttle_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own shuttle sessions"
  ON public.shuttle_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shuttle sessions"
  ON public.shuttle_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_shuttle_sessions_user ON public.shuttle_sessions(user_id, curriculum_id);

-- ============================================================

CREATE TABLE public.shuttle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.shuttle_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  is_correct BOOLEAN NOT NULL,
  response_time_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shuttle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own shuttle events"
  ON public.shuttle_events FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shuttle_sessions s
    WHERE s.id = shuttle_events.session_id AND s.user_id = auth.uid()
  ));

CREATE POLICY "Users can create own shuttle events"
  ON public.shuttle_events FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.shuttle_sessions s
    WHERE s.id = shuttle_events.session_id AND s.user_id = auth.uid()
  ));

CREATE INDEX idx_shuttle_events_session ON public.shuttle_events(session_id);
CREATE INDEX idx_shuttle_events_question ON public.shuttle_events(question_id);

-- ============================================================
-- RPC: Weighted question selection for Shuttle Mode
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_shuttle_next_question(
  p_user_id UUID,
  p_curriculum_id UUID,
  p_session_id UUID DEFAULT NULL
)
RETURNS TABLE (
  question_id UUID,
  question_text TEXT,
  question_type TEXT,
  answers JSONB,
  competency_id UUID,
  blueprint_id UUID,
  difficulty TEXT,
  trap_type TEXT,
  explanation TEXT,
  distractor_meta JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_ids UUID[];
BEGIN
  -- Anti-loop: get last 10 answered question IDs in this session
  IF p_session_id IS NOT NULL THEN
    SELECT ARRAY_AGG(se.question_id)
    INTO v_recent_ids
    FROM (
      SELECT se2.question_id
      FROM shuttle_events se2
      WHERE se2.session_id = p_session_id
      ORDER BY se2.created_at DESC
      LIMIT 10
    ) se;
  END IF;

  IF v_recent_ids IS NULL THEN
    v_recent_ids := ARRAY[]::UUID[];
  END IF;

  RETURN QUERY
  SELECT
    eq.id AS question_id,
    eq.question_text,
    eq.question_type,
    eq.answers,
    eq.competency_id,
    eq.blueprint_id,
    eq.difficulty,
    eq.trap_type,
    eq.explanation,
    eq.distractor_meta
  FROM exam_questions eq
  LEFT JOIN user_competency_progress ucp
    ON ucp.competency_id = eq.competency_id
    AND ucp.user_id = p_user_id
    AND ucp.curriculum_id = p_curriculum_id
  WHERE eq.curriculum_id = p_curriculum_id
    AND eq.status IN ('approved', 'tier1_passed')
    AND NOT (eq.id = ANY(v_recent_ids))
  ORDER BY
    -- 1. Weakness priority: not_mastered > partial > mastered
    CASE
      WHEN ucp.mastery_level = 'not_mastered' THEN 0
      WHEN ucp.mastery_level = 'partial' THEN 1
      WHEN ucp.mastery_level IS NULL THEN 2
      ELSE 3
    END ASC,
    -- 2. Exam relevance (blueprint-based questions first)
    CASE WHEN eq.blueprint_id IS NOT NULL THEN 0 ELSE 1 END ASC,
    -- 3. Least recently seen
    COALESCE(
      (SELECT MAX(se3.created_at) FROM shuttle_events se3
       JOIN shuttle_sessions ss ON ss.id = se3.session_id
       WHERE se3.question_id = eq.id AND ss.user_id = p_user_id),
      '1970-01-01'::TIMESTAMPTZ
    ) ASC,
    -- 4. Random tiebreaker
    RANDOM()
  LIMIT 1;
END;
$$;
