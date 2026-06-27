
CREATE TABLE IF NOT EXISTS public.store_review_gate (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  manifest_id UUID NOT NULL,
  review_state TEXT NOT NULL,
  review_score INTEGER NOT NULL DEFAULT 0,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  android_ready BOOLEAN NOT NULL DEFAULT FALSE,
  ios_ready BOOLEAN NOT NULL DEFAULT FALSE,
  package_hash TEXT,
  manifest_hash TEXT,
  listing_hash TEXT,
  build_hash TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_review_gate_manifest_idx ON public.store_review_gate(manifest_id, created_at DESC);

GRANT SELECT ON public.store_review_gate TO authenticated;
GRANT ALL ON public.store_review_gate TO service_role;

ALTER TABLE public.store_review_gate ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_review_gate admin read"
  ON public.store_review_gate FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "store_review_gate service write"
  ON public.store_review_gate FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER store_review_gate_set_updated_at
  BEFORE UPDATE ON public.store_review_gate
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
