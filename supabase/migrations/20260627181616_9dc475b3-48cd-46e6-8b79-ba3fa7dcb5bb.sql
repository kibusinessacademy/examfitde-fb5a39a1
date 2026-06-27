
-- STORE.LIFECYCLE.OS.1 — Persistence
-- Append-only lifecycle event log + manual store feedback log.
-- No publish, no automation. Humans drive transitions.

CREATE TABLE IF NOT EXISTS public.store_lifecycle_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id UUID NOT NULL,
  manifest_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apple','google','any')),
  event_type TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  occurred_at_reference TIMESTAMPTZ NOT NULL,
  actor_id UUID NULL,
  feedback_ref UUID NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_lifecycle_events_candidate ON public.store_lifecycle_events(candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_store_lifecycle_events_manifest ON public.store_lifecycle_events(manifest_id, created_at);

GRANT SELECT, INSERT ON public.store_lifecycle_events TO authenticated;
GRANT ALL ON public.store_lifecycle_events TO service_role;
ALTER TABLE public.store_lifecycle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read lifecycle events"
  ON public.store_lifecycle_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "service role manages lifecycle events"
  ON public.store_lifecycle_events FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Append-only guard: block UPDATE / DELETE for non-service callers.
CREATE OR REPLACE FUNCTION public.store_lifecycle_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'store_lifecycle_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_store_lifecycle_events_no_update ON public.store_lifecycle_events;
CREATE TRIGGER trg_store_lifecycle_events_no_update
  BEFORE UPDATE OR DELETE ON public.store_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.store_lifecycle_events_append_only();


CREATE TABLE IF NOT EXISTS public.store_lifecycle_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id UUID NOT NULL,
  manifest_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apple','google')),
  store_feedback_type TEXT NOT NULL,
  store_feedback_status TEXT NOT NULL,
  external_reference TEXT NULL,
  reason_code TEXT NULL,
  human_summary TEXT NOT NULL,
  required_action TEXT NULL,
  received_at_reference TIMESTAMPTZ NOT NULL,
  evidence_url TEXT NULL,
  reviewer TEXT NULL,
  payload_hash TEXT NULL,
  recorded_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_lifecycle_feedback_candidate ON public.store_lifecycle_feedback(candidate_id, received_at_reference);
CREATE INDEX IF NOT EXISTS idx_store_lifecycle_feedback_manifest ON public.store_lifecycle_feedback(manifest_id, received_at_reference);

GRANT SELECT, INSERT ON public.store_lifecycle_feedback TO authenticated;
GRANT ALL ON public.store_lifecycle_feedback TO service_role;
ALTER TABLE public.store_lifecycle_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read lifecycle feedback"
  ON public.store_lifecycle_feedback FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "service role manages lifecycle feedback"
  ON public.store_lifecycle_feedback FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.store_lifecycle_feedback_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'store_lifecycle_feedback is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_store_lifecycle_feedback_no_update ON public.store_lifecycle_feedback;
CREATE TRIGGER trg_store_lifecycle_feedback_no_update
  BEFORE UPDATE OR DELETE ON public.store_lifecycle_feedback
  FOR EACH ROW EXECUTE FUNCTION public.store_lifecycle_feedback_append_only();
