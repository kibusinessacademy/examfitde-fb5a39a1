
CREATE TABLE IF NOT EXISTS public.store_release_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android','ios')),
  workflow_run_id text,
  commit_sha text,
  build_number integer,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  artifact_name text,
  artifact_url text,
  metadata_hash text,
  error_code text,
  dry_run boolean NOT NULL DEFAULT true,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_release_builds_manifest ON public.store_release_builds (manifest_id, platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_release_builds_workflow ON public.store_release_builds (workflow_run_id);

GRANT SELECT ON public.store_release_builds TO authenticated;
GRANT ALL ON public.store_release_builds TO service_role;

ALTER TABLE public.store_release_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read store_release_builds"
ON public.store_release_builds FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service writes store_release_builds"
ON public.store_release_builds FOR ALL
TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_store_release_builds_touch
BEFORE UPDATE ON public.store_release_builds
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
