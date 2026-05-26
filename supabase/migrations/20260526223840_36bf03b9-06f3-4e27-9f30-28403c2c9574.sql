
-- 1. voice_sessions
CREATE TABLE public.voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  package_id UUID REFERENCES public.course_packages(id) ON DELETE SET NULL,
  vertical TEXT NOT NULL,
  scenario_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  voice_mode_enabled BOOLEAN NOT NULL DEFAULT false,
  language TEXT NOT NULL DEFAULT 'de',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_sessions_status_chk CHECK (status IN ('active','completed','aborted','aborted_by_character','timeout')),
  CONSTRAINT voice_sessions_vertical_chk CHECK (vertical IN ('hr_interview','examfit_oral','kundenservice','medizin','pflege','negotiation','custom'))
);
CREATE INDEX idx_voice_sessions_user ON public.voice_sessions(user_id, started_at DESC);
CREATE INDEX idx_voice_sessions_package ON public.voice_sessions(package_id) WHERE package_id IS NOT NULL;
CREATE INDEX idx_voice_sessions_vertical_status ON public.voice_sessions(vertical, status);

GRANT SELECT, INSERT, UPDATE ON public.voice_sessions TO authenticated;
GRANT ALL ON public.voice_sessions TO service_role;
ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_sessions_owner_select" ON public.voice_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "voice_sessions_owner_insert" ON public.voice_sessions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "voice_sessions_owner_update" ON public.voice_sessions FOR UPDATE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- 2. voice_turns
CREATE TABLE public.voice_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.voice_sessions(id) ON DELETE CASCADE,
  turn_index INT NOT NULL,
  role TEXT NOT NULL,
  transcript TEXT,
  audio_duration_ms INT,
  stt_latency_ms INT,
  llm_latency_ms INT,
  tts_latency_ms INT,
  input_mode TEXT NOT NULL DEFAULT 'text',
  competency_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_turns_role_chk CHECK (role IN ('user','assistant','system','character')),
  CONSTRAINT voice_turns_input_mode_chk CHECK (input_mode IN ('text','voice','synthetic')),
  UNIQUE (session_id, turn_index)
);
CREATE INDEX idx_voice_turns_session ON public.voice_turns(session_id, turn_index);

GRANT SELECT, INSERT ON public.voice_turns TO authenticated;
GRANT ALL ON public.voice_turns TO service_role;
ALTER TABLE public.voice_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_turns_owner_select" ON public.voice_turns FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.voice_sessions s WHERE s.id = session_id AND (s.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role)))
);
CREATE POLICY "voice_turns_owner_insert" ON public.voice_turns FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.voice_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
);

-- 3. voice_artifacts
CREATE TABLE public.voice_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.voice_sessions(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_artifacts_type_chk CHECK (artifact_type IN ('scorecard','protocol','ticket','transcript_export','competency_map','custom'))
);
CREATE INDEX idx_voice_artifacts_session ON public.voice_artifacts(session_id, created_at DESC);

GRANT SELECT, INSERT ON public.voice_artifacts TO authenticated;
GRANT ALL ON public.voice_artifacts TO service_role;
ALTER TABLE public.voice_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_artifacts_owner_select" ON public.voice_artifacts FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.voice_sessions s WHERE s.id = session_id AND (s.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role)))
);
CREATE POLICY "voice_artifacts_service_insert" ON public.voice_artifacts FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.voice_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
);

-- 4. voice_compliance_events
CREATE TABLE public.voice_compliance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.voice_sessions(id) ON DELETE CASCADE,
  user_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_compliance_event_type_chk CHECK (event_type IN (
    'consent_given','consent_revoked','recording_started','recording_stopped',
    'data_purged','export_requested','access_denied','quality_gate_failed','session_aborted'
  ))
);
CREATE INDEX idx_voice_compliance_session ON public.voice_compliance_events(session_id, created_at DESC);
CREATE INDEX idx_voice_compliance_user ON public.voice_compliance_events(user_id, created_at DESC);

GRANT INSERT ON public.voice_compliance_events TO authenticated;
GRANT ALL ON public.voice_compliance_events TO service_role;
ALTER TABLE public.voice_compliance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_compliance_admin_select" ON public.voice_compliance_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "voice_compliance_owner_insert" ON public.voice_compliance_events FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.voice_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
);

-- 5. Trigger updated_at
CREATE TRIGGER trg_voice_sessions_updated_at
BEFORE UPDATE ON public.voice_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. fn_voice_access_check
CREATE OR REPLACE FUNCTION public.fn_voice_access_check(_user_id UUID, _package_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track TEXT;
  v_has_grant BOOLEAN;
  v_oral_eligible BOOLEAN;
BEGIN
  IF _user_id IS NULL OR _package_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'missing_args');
  END IF;

  SELECT p.track
  INTO v_track
  FROM public.course_packages cp
  LEFT JOIN public.products p ON p.curriculum_id = cp.certification_id
  WHERE cp.id = _package_id
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1;

  v_oral_eligible := v_track IN ('AUSBILDUNG_VOLL','EXAM_FIRST_PLUS');

  IF NOT v_oral_eligible THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'track_not_oral_eligible', 'track', v_track);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.learner_course_grants lcg
    WHERE lcg.user_id = _user_id
      AND lcg.package_id = _package_id
      AND lcg.status = 'active'
      AND (lcg.valid_until IS NULL OR lcg.valid_until > now())
  ) OR public.has_role(_user_id, 'admin'::app_role)
  INTO v_has_grant;

  IF NOT v_has_grant THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_active_grant', 'track', v_track);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'track', v_track);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_voice_access_check(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_voice_access_check(UUID, UUID) TO authenticated, service_role;

-- 7. Audit-Contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('voice_session_started', ARRAY['session_id','vertical','voice_mode'], 'voiceos'),
  ('voice_session_ended', ARRAY['session_id','status','turns_count'], 'voiceos'),
  ('voice_access_denied', ARRAY['user_id','package_id','reason'], 'voiceos'),
  ('voice_artifact_created', ARRAY['session_id','artifact_type'], 'voiceos')
ON CONFLICT (action_type) DO NOTHING;
