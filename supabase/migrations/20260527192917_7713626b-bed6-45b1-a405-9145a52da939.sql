
-- =============================================================================
-- VerwaltungsOS Oral Bridge v1
-- =============================================================================

CREATE TABLE public.verwaltung_oral_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  department_key TEXT NOT NULL,
  oral_case_key TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT 'buerger_neutral',
  conflict_level TEXT NOT NULL DEFAULT 'medium',
  escalation_state INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  scenario_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  debrief JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CONSTRAINT verwaltung_oral_sessions_status_chk
    CHECK (status IN ('active','finished','aborted')),
  CONSTRAINT verwaltung_oral_sessions_conflict_chk
    CHECK (conflict_level IN ('low','medium','high'))
);

CREATE INDEX idx_vos_user_started
  ON public.verwaltung_oral_sessions (user_id, started_at DESC);
CREATE INDEX idx_vos_dept_case
  ON public.verwaltung_oral_sessions (department_key, oral_case_key);

GRANT SELECT, INSERT, UPDATE ON public.verwaltung_oral_sessions TO authenticated;
GRANT ALL ON public.verwaltung_oral_sessions TO service_role;

ALTER TABLE public.verwaltung_oral_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vos_user_select_own"
  ON public.verwaltung_oral_sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "vos_user_insert_own"
  ON public.verwaltung_oral_sessions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vos_user_update_own"
  ON public.verwaltung_oral_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------

CREATE TABLE public.verwaltung_oral_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.verwaltung_oral_sessions(id) ON DELETE CASCADE,
  turn_index INT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  persona_emotion TEXT,
  escalation_delta INT NOT NULL DEFAULT 0,
  evaluation JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT verwaltung_oral_turns_role_chk
    CHECK (role IN ('persona','user','system')),
  CONSTRAINT verwaltung_oral_turns_unique_idx
    UNIQUE (session_id, turn_index)
);

CREATE INDEX idx_vot_session ON public.verwaltung_oral_turns (session_id, turn_index);

GRANT SELECT, INSERT ON public.verwaltung_oral_turns TO authenticated;
GRANT ALL ON public.verwaltung_oral_turns TO service_role;

ALTER TABLE public.verwaltung_oral_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vot_user_select_own"
  ON public.verwaltung_oral_turns
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.verwaltung_oral_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "vot_user_insert_own"
  ON public.verwaltung_oral_turns
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.verwaltung_oral_sessions s
      WHERE s.id = session_id AND s.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_verwaltung_oral_session(
  _department_key TEXT,
  _oral_case_key TEXT,
  _persona TEXT DEFAULT 'buerger_neutral'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_dna RECORD;
  v_case JSONB;
  v_conflict TEXT;
  v_session_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT department_key, department_name, category, oral_training_cases
    INTO v_dna
  FROM public.verwaltung_department_dna
  WHERE department_key = _department_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPARTMENT_NOT_FOUND: %', _department_key;
  END IF;

  SELECT c INTO v_case
  FROM jsonb_array_elements(COALESCE(v_dna.oral_training_cases, '[]'::jsonb)) c
  WHERE c->>'key' = _oral_case_key
  LIMIT 1;

  IF v_case IS NULL THEN
    RAISE EXCEPTION 'ORAL_CASE_NOT_FOUND: %', _oral_case_key;
  END IF;

  v_conflict := COALESCE(v_case->>'conflict_level', 'medium');
  IF v_conflict NOT IN ('low','medium','high') THEN
    v_conflict := 'medium';
  END IF;

  INSERT INTO public.verwaltung_oral_sessions (
    user_id, department_key, oral_case_key, persona, conflict_level, scenario_snapshot
  ) VALUES (
    v_user, _department_key, _oral_case_key, _persona, v_conflict,
    jsonb_build_object(
      'department_name', v_dna.department_name,
      'category', v_dna.category,
      'oral_case', v_case
    )
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_verwaltung_oral_session(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_verwaltung_oral_session(TEXT, TEXT, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_verwaltung_oral_session(_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_turns JSONB;
BEGIN
  SELECT * INTO v_session
  FROM public.verwaltung_oral_sessions
  WHERE id = _session_id
    AND (user_id = auth.uid() OR auth.role() = 'service_role');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','NOT_FOUND_OR_FORBIDDEN');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.turn_index), '[]'::jsonb)
    INTO v_turns
  FROM public.verwaltung_oral_turns t
  WHERE t.session_id = _session_id;

  RETURN jsonb_build_object(
    'id', v_session.id,
    'user_id', v_session.user_id,
    'department_key', v_session.department_key,
    'oral_case_key', v_session.oral_case_key,
    'persona', v_session.persona,
    'conflict_level', v_session.conflict_level,
    'escalation_state', v_session.escalation_state,
    'status', v_session.status,
    'scenario_snapshot', v_session.scenario_snapshot,
    'scores', v_session.scores,
    'debrief', v_session.debrief,
    'started_at', v_session.started_at,
    'ended_at', v_session.ended_at,
    'turns', v_turns
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_verwaltung_oral_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_verwaltung_oral_session(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_verwaltung_oral_session(
  _session_id UUID,
  _scores JSONB,
  _debrief JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT user_id INTO v_owner
  FROM public.verwaltung_oral_sessions
  WHERE id = _session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND';
  END IF;

  IF v_owner <> auth.uid() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.verwaltung_oral_sessions
     SET scores   = COALESCE(_scores, '{}'::jsonb),
         debrief  = COALESCE(_debrief, '{}'::jsonb),
         status   = 'finished',
         ended_at = now()
   WHERE id = _session_id;

  RETURN jsonb_build_object('ok', true, 'session_id', _session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_verwaltung_oral_session(UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_verwaltung_oral_session(UUID, JSONB, JSONB) TO authenticated, service_role;
