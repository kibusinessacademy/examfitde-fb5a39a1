
CREATE TABLE IF NOT EXISTS public.store_release_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL,
  product_id uuid,
  curriculum_id uuid,
  course_id uuid,
  version text NOT NULL,
  build_number text,
  candidate_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','invalidated','approved','exported','cancelled')),
  manifest_hash text,
  listing_hash text,
  package_hash text,
  build_hash text,
  review_hash text,
  smoke_hash text,
  android_build_reference text,
  ios_build_reference text,
  review_gate_version text,
  smoke_version text,
  invalidated_reason text,
  invalidated_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  exported_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_release_candidates_manifest
  ON public.store_release_candidates(manifest_id, candidate_version DESC);
CREATE INDEX IF NOT EXISTS idx_store_release_candidates_status
  ON public.store_release_candidates(status);

GRANT SELECT ON public.store_release_candidates TO authenticated;
GRANT ALL ON public.store_release_candidates TO service_role;

ALTER TABLE public.store_release_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read release candidates"
  ON public.store_release_candidates
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service writes release candidates"
  ON public.store_release_candidates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.store_release_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.store_release_candidates(id) ON DELETE CASCADE,
  manifest_id uuid NOT NULL,
  event text NOT NULL
    CHECK (event IN (
      'created','review_completed','candidate_created','candidate_invalidated',
      'approved','submission_started','submission_cancelled',
      'store_feedback_received','rejected','archived','submission_exported'
    )),
  actor_id uuid,
  note text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_release_timeline_candidate
  ON public.store_release_timeline(candidate_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_store_release_timeline_manifest
  ON public.store_release_timeline(manifest_id, occurred_at);

GRANT SELECT ON public.store_release_timeline TO authenticated;
GRANT ALL ON public.store_release_timeline TO service_role;

ALTER TABLE public.store_release_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read release timeline"
  ON public.store_release_timeline
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service writes release timeline"
  ON public.store_release_timeline
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Append-only enforcement: no UPDATE / DELETE except via service_role.
CREATE OR REPLACE FUNCTION public.fn_store_release_timeline_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' <> 'service_role' THEN
    RAISE EXCEPTION 'store_release_timeline is append-only';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_release_timeline_no_update ON public.store_release_timeline;
CREATE TRIGGER trg_store_release_timeline_no_update
  BEFORE UPDATE OR DELETE ON public.store_release_timeline
  FOR EACH ROW EXECUTE FUNCTION public.fn_store_release_timeline_append_only();
