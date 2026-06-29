-- Structured generation event log for the beruf image pipeline.
-- Records every status transition (queued → generating → ready/failed)
-- plus scene_id, prompt_version, model and optional error so we can
-- forensically explain why an image succeeded or failed later.
CREATE TABLE IF NOT EXISTS public.beruf_image_generation_events (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('queued','generating','ready','failed','retry_requested')),
  scene_id TEXT,
  prompt_version INTEGER,
  model TEXT,
  duration_ms INTEGER,
  error TEXT,
  force_requested BOOLEAN NOT NULL DEFAULT false,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.beruf_image_generation_events TO authenticated;
GRANT ALL ON public.beruf_image_generation_events TO service_role;

ALTER TABLE public.beruf_image_generation_events ENABLE ROW LEVEL SECURITY;

-- Only admins can read these forensic events. Writes flow exclusively via
-- service_role (edge function) — no client-side INSERTs.
CREATE POLICY "admin read beruf image events"
  ON public.beruf_image_generation_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS beruf_image_generation_events_slug_idx
  ON public.beruf_image_generation_events (slug, created_at DESC);
CREATE INDEX IF NOT EXISTS beruf_image_generation_events_event_idx
  ON public.beruf_image_generation_events (event, created_at DESC);

-- The base cache table is read publicly (for the UI), but admin edits
-- (scene_id / prompt_text / meta overrides) must be gated to admins.
DROP POLICY IF EXISTS "admin write beruf image cache" ON public.beruf_image_cache;
CREATE POLICY "admin write beruf image cache"
  ON public.beruf_image_cache
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
GRANT UPDATE (scene_id, prompt_text, model, prompt_version, alt_text, meta)
  ON public.beruf_image_cache TO authenticated;