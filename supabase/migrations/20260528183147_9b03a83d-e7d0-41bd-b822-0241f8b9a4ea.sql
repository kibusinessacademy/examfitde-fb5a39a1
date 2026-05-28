
-- Cut B2 — VerwaltungsOS Realtime-Layer Foundation
CREATE TABLE IF NOT EXISTS public.verwaltung_persona_agent_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_key text NOT NULL UNIQUE,
  elevenlabs_agent_id text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.verwaltung_persona_agent_map TO authenticated;
GRANT ALL ON public.verwaltung_persona_agent_map TO service_role;

ALTER TABLE public.verwaltung_persona_agent_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage persona agent map"
  ON public.verwaltung_persona_agent_map FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read persona agent map"
  ON public.verwaltung_persona_agent_map FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.verwaltung_persona_agent_map (persona_key, notes) VALUES
  ('buerger_neutral',           'Neutraler Bürger — Standard-Anfrage. Voice: Brian.'),
  ('buerger_aufgebracht',       'Aufgebrachter Bürger — Eskalations-Szenarien. Voice: Chris.'),
  ('buerger_unsicher',          'Unsicherer Bürger — empathische Führung. Voice: Matilda.'),
  ('buerger_juristisch',        'Juristisch-versierter Bürger — präzise Argumentation. Voice: George.'),
  ('antragsteller_familie',     'Familien-Antragsteller — Sozialleistungen. Voice: Jessica.'),
  ('antragsteller_unternehmer', 'Unternehmer-Antragsteller — Genehmigungen. Voice: Will.'),
  ('vorgesetzte_dezernent',     'Dezernent — interne Rücksprache. Voice: Daniel.'),
  ('kollege_kollegial',         'Kollegialer Kollege — Sparring. Voice: Liam.'),
  ('presse_kritisch',           'Kritische Presse — Statements. Voice: Eric.')
ON CONFLICT (persona_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verwaltung_resolve_persona_agent(_persona text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT elevenlabs_agent_id
  FROM public.verwaltung_persona_agent_map
  WHERE persona_key = COALESCE(_persona, 'buerger_neutral')
    AND active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.verwaltung_resolve_persona_agent(text) TO authenticated, service_role;

ALTER TABLE public.verwaltung_oral_sessions
  ADD COLUMN IF NOT EXISTS realtime_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS realtime_convai_session_id text,
  ADD COLUMN IF NOT EXISTS realtime_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS realtime_ended_at timestamptz;

INSERT INTO public.ops_audit_contract (action_type, owner_module, required_keys) VALUES
  ('verwaltung_realtime_token_issued',     'verwaltungsos.realtime',
   ARRAY['session_id','persona','agent_id','caller_role']),
  ('verwaltung_realtime_session_started',  'verwaltungsos.realtime',
   ARRAY['session_id','persona','agent_id','convai_session_id','caller_role']),
  ('verwaltung_realtime_session_ended',    'verwaltungsos.realtime',
   ARRAY['session_id','convai_session_id','duration_seconds','caller_role'])
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module = EXCLUDED.owner_module;

CREATE OR REPLACE FUNCTION public.verwaltung_start_realtime_session(
  _session_id uuid,
  _convai_session_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_agent_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT id, user_id, persona, status
    INTO v_session
    FROM public.verwaltung_oral_sessions
   WHERE id = _session_id AND user_id = auth.uid();

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = '42704';
  END IF;

  v_agent_id := public.verwaltung_resolve_persona_agent(v_session.persona);

  UPDATE public.verwaltung_oral_sessions
     SET realtime_mode = true,
         realtime_convai_session_id = _convai_session_id,
         realtime_started_at = now()
   WHERE id = _session_id;

  PERFORM public.fn_emit_audit(
    _action_type := 'verwaltung_realtime_session_started',
    _payload := jsonb_build_object(
      'session_id', _session_id::text,
      'persona', v_session.persona,
      'agent_id', COALESCE(v_agent_id, 'unconfigured'),
      'convai_session_id', _convai_session_id,
      'caller_role', 'authenticated'
    )
  );

  RETURN jsonb_build_object('ok', true, 'agent_id', v_agent_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verwaltung_start_realtime_session(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verwaltung_end_realtime_session(
  _session_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_duration int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT id, realtime_started_at, realtime_convai_session_id
    INTO v_session
    FROM public.verwaltung_oral_sessions
   WHERE id = _session_id AND user_id = auth.uid();

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = '42704';
  END IF;

  v_duration := COALESCE(EXTRACT(EPOCH FROM (now() - v_session.realtime_started_at))::int, 0);

  UPDATE public.verwaltung_oral_sessions
     SET realtime_ended_at = now(),
         realtime_mode = false
   WHERE id = _session_id;

  PERFORM public.fn_emit_audit(
    _action_type := 'verwaltung_realtime_session_ended',
    _payload := jsonb_build_object(
      'session_id', _session_id::text,
      'convai_session_id', COALESCE(v_session.realtime_convai_session_id, 'none'),
      'duration_seconds', v_duration,
      'caller_role', 'authenticated'
    )
  );

  RETURN jsonb_build_object('ok', true, 'duration_seconds', v_duration);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verwaltung_end_realtime_session(uuid) TO authenticated, service_role;

CREATE TRIGGER trg_verwaltung_persona_agent_map_updated_at
  BEFORE UPDATE ON public.verwaltung_persona_agent_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
