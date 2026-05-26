
CREATE TABLE IF NOT EXISTS public.lead_activation_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id text,
  session_id text,
  user_id uuid,
  persona text NOT NULL,
  signal_type text NOT NULL,
  package_id uuid,
  painpoint_key text,
  source_page text,
  ip_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_las_anon_created ON public.lead_activation_signals(anonymous_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_las_persona_signal ON public.lead_activation_signals(persona, signal_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_las_iphash_created ON public.lead_activation_signals(ip_hash, created_at DESC);

ALTER TABLE public.lead_activation_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_activation_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.lead_activation_signals TO service_role;

CREATE OR REPLACE FUNCTION public.record_activation_signal(
  _persona text,
  _signal_type text,
  _anonymous_id text DEFAULT NULL,
  _session_id text DEFAULT NULL,
  _package_id uuid DEFAULT NULL,
  _painpoint_key text DEFAULT NULL,
  _source_page text DEFAULT NULL,
  _ip_hash text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF _persona IS NULL OR length(_persona) = 0 THEN
    RAISE EXCEPTION 'persona required' USING ERRCODE='22023';
  END IF;
  IF _signal_type IS NULL OR length(_signal_type) = 0 THEN
    RAISE EXCEPTION 'signal_type required' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.lead_activation_signals(
    anonymous_id, session_id, user_id, persona, signal_type,
    package_id, painpoint_key, source_page, ip_hash, metadata
  ) VALUES (
    _anonymous_id, _session_id, v_uid, _persona, _signal_type,
    _package_id, _painpoint_key, _source_page, _ip_hash, COALESCE(_metadata,'{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_activation_signal(text,text,text,text,uuid,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_activation_signal(text,text,text,text,uuid,text,text,text,jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_demo_rate_limit_check(
  _persona text,
  _ip_hash text,
  _anonymous_id text DEFAULT NULL,
  _window_minutes int DEFAULT 60,
  _max_calls int DEFAULT 5
)
RETURNS TABLE(allowed boolean, used int, remaining int, reset_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_window_start timestamptz := now() - make_interval(mins => _window_minutes);
BEGIN
  SELECT COUNT(*)::int INTO v_count
  FROM public.lead_activation_signals
  WHERE persona = _persona
    AND signal_type = 'demo_personalize_request'
    AND created_at >= v_window_start
    AND (
      (_ip_hash IS NOT NULL AND ip_hash = _ip_hash)
      OR (_anonymous_id IS NOT NULL AND anonymous_id = _anonymous_id)
    );

  RETURN QUERY SELECT
    (v_count < _max_calls)::boolean,
    v_count,
    GREATEST(_max_calls - v_count, 0),
    (v_window_start + make_interval(mins => _window_minutes));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_demo_rate_limit_check(text,text,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_demo_rate_limit_check(text,text,text,int,int) TO service_role;

INSERT INTO public.ops_audit_contract (action_type, owner_module, required_keys, schema_version)
VALUES
  ('demo_personalize_invoked', 'cut_6_1_demo', ARRAY['persona','painpoint_key','package_id'], 1),
  ('demo_personalize_rate_limited', 'cut_6_1_demo', ARRAY['persona','ip_hash'], 1),
  ('demo_personalize_completed', 'cut_6_1_demo', ARRAY['persona','package_id','tokens_streamed'], 1)
ON CONFLICT (action_type) DO NOTHING;
