
-- ═══ API Keys System ═══
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  created_by uuid,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_prefix ON public.api_keys (key_prefix);
CREATE INDEX idx_api_keys_org ON public.api_keys (org_id);
CREATE INDEX idx_api_keys_status ON public.api_keys (status);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read api_keys"
  ON public.api_keys FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin insert api_keys"
  ON public.api_keys FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin update api_keys"
  ON public.api_keys FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ═══ API Key Events ═══
CREATE TABLE public.api_key_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_key_events_key ON public.api_key_events (api_key_id);

ALTER TABLE public.api_key_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read api_key_events"
  ON public.api_key_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin insert api_key_events"
  ON public.api_key_events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
