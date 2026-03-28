
CREATE TABLE IF NOT EXISTS public.conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  curriculum_id uuid,
  event_type text NOT NULL,
  intent text,
  readiness_score numeric,
  risk_level text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conversion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on conversion_events"
  ON public.conversion_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can insert own conversion events"
  ON public.conversion_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.track_conversion_event(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_event_type text,
  p_intent text,
  p_readiness_score numeric,
  p_risk_level text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.conversion_events (
    user_id, curriculum_id, event_type, intent, readiness_score, risk_level
  ) VALUES (
    p_user_id, p_curriculum_id, p_event_type, p_intent, p_readiness_score, p_risk_level
  );
$$;

REVOKE ALL ON FUNCTION public.track_conversion_event(uuid, uuid, text, text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_conversion_event(uuid, uuid, text, text, numeric, text) TO authenticated, service_role;
