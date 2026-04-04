
-- ============================================================
-- STANDALONE BUNDLE ARCHITECTURE – Phase 1
-- ============================================================

-- 1. TABLES
-- ------------------------------------------------------------

-- 1.1 standalone_artifact_versions
CREATE TABLE IF NOT EXISTS public.standalone_artifact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  curriculum_id uuid NULL REFERENCES public.curricula(id) ON DELETE SET NULL,

  artifact_kind text NOT NULL CHECK (
    artifact_kind IN ('snapshot','bundle','zip','manifest')
  ),

  version_tag text NOT NULL,
  source_step text NULL,
  source_integrity_report_id uuid NULL,
  source_quality_session_id uuid NULL,

  storage_bucket text NULL,
  storage_path text NULL,
  mime_type text NULL,
  checksum_sha256 text NULL,
  size_bytes bigint NULL,

  build_status text NOT NULL DEFAULT 'pending' CHECK (
    build_status IN ('pending','processing','completed','failed')
  ),
  validation_status text NOT NULL DEFAULT 'pending' CHECK (
    validation_status IN ('pending','passed','failed')
  ),

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (package_id, artifact_kind, version_tag)
);

ALTER TABLE public.standalone_artifact_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on standalone_artifact_versions"
  ON public.standalone_artifact_versions FOR ALL
  USING (true) WITH CHECK (true);

-- 1.2 standalone_backup_targets
CREATE TABLE IF NOT EXISTS public.standalone_backup_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('supabase_storage','google_drive')),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ref text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.standalone_backup_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on standalone_backup_targets"
  ON public.standalone_backup_targets FOR ALL
  USING (true) WITH CHECK (true);

-- 1.3 standalone_backups
CREATE TABLE IF NOT EXISTS public.standalone_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_version_id uuid NOT NULL REFERENCES public.standalone_artifact_versions(id) ON DELETE CASCADE,
  backup_target_id uuid NOT NULL REFERENCES public.standalone_backup_targets(id) ON DELETE CASCADE,

  backup_status text NOT NULL DEFAULT 'pending' CHECK (
    backup_status IN ('pending','processing','completed','failed')
  ),

  external_file_id text NULL,
  external_url text NULL,
  checksum_sha256 text NULL,
  size_bytes bigint NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (artifact_version_id, backup_target_id)
);

ALTER TABLE public.standalone_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on standalone_backups"
  ON public.standalone_backups FOR ALL
  USING (true) WITH CHECK (true);

-- 1.4 standalone_restore_events
CREATE TABLE IF NOT EXISTS public.standalone_restore_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_version_id uuid NOT NULL REFERENCES public.standalone_artifact_versions(id) ON DELETE RESTRICT,
  restore_source text NOT NULL CHECK (
    restore_source IN ('supabase_storage','google_drive','manual_upload')
  ),
  restore_target text NOT NULL CHECK (
    restore_target IN ('preview','download_only','rebuild_live')
  ),
  restore_status text NOT NULL DEFAULT 'pending' CHECK (
    restore_status IN ('pending','processing','completed','failed')
  ),
  initiated_by text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.standalone_restore_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on standalone_restore_events"
  ON public.standalone_restore_events FOR ALL
  USING (true) WITH CHECK (true);

-- 2. HELPER FUNCTION
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_package_has_valid_standalone_bundle(p_package_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.standalone_artifact_versions sav
    WHERE sav.package_id = p_package_id
      AND sav.artifact_kind = 'bundle'
      AND sav.build_status = 'completed'
      AND sav.validation_status = 'passed'
  );
$$;

-- 3. HEALTH VIEW
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_standalone_artifact_health AS
SELECT
  sav.package_id,
  sav.course_id,
  sav.version_tag,
  MAX(CASE WHEN sav.artifact_kind = 'snapshot' THEN sav.build_status END) AS snapshot_status,
  MAX(CASE WHEN sav.artifact_kind = 'bundle' THEN sav.build_status END) AS bundle_status,
  MAX(CASE WHEN sav.artifact_kind = 'zip' THEN sav.build_status END) AS zip_status,
  BOOL_OR(sav.validation_status = 'passed') AS any_validation_passed,
  MAX(sav.created_at) AS latest_artifact_at,
  (SELECT COUNT(*) FROM public.standalone_backups sb
   JOIN public.standalone_artifact_versions sav2 ON sb.artifact_version_id = sav2.id
   WHERE sav2.package_id = sav.package_id
     AND sav2.version_tag = sav.version_tag
     AND sb.backup_status = 'completed') AS completed_backups
FROM public.standalone_artifact_versions sav
GROUP BY sav.package_id, sav.course_id, sav.version_tag;

-- 4. PIPELINE DAG EDGES
-- ------------------------------------------------------------

-- Re-wire: quality_council → build_standalone_snapshot → ... → auto_publish
-- First remove the direct quality_council → auto_publish edge
DELETE FROM public.pipeline_dag_edges
WHERE step_key = 'auto_publish' AND depends_on = 'quality_council';

INSERT INTO public.pipeline_dag_edges (step_key, depends_on) VALUES
  ('build_standalone_snapshot', 'quality_council'),
  ('build_standalone_bundle', 'build_standalone_snapshot'),
  ('validate_standalone_bundle', 'build_standalone_bundle'),
  ('backup_standalone_bundle', 'validate_standalone_bundle'),
  ('auto_publish', 'backup_standalone_bundle')
ON CONFLICT DO NOTHING;

-- 5. JOB TYPE REGISTRY
-- ------------------------------------------------------------

INSERT INTO public.ops_job_type_registry (job_type, pool, description) VALUES
  ('build_standalone_snapshot', 'content', 'Serialize frozen SSOT snapshot for standalone bundle'),
  ('build_standalone_bundle', 'content', 'Build standalone HTML/ZIP bundle from snapshot'),
  ('validate_standalone_bundle', 'content', 'Validate standalone bundle structure and content'),
  ('backup_standalone_bundle', 'content', 'Backup standalone bundle to external targets'),
  ('restore_standalone_bundle', 'content', 'Restore standalone bundle from backup')
ON CONFLICT (job_type) DO NOTHING;

-- 6. STORAGE BUCKET
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('standalone-bundles', 'standalone-bundles', false, 524288000)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for standalone-bundles
CREATE POLICY "Service role can manage standalone bundles"
  ON storage.objects FOR ALL
  USING (bucket_id = 'standalone-bundles')
  WITH CHECK (bucket_id = 'standalone-bundles');

-- 7. SEED DEFAULT BACKUP TARGET
-- ------------------------------------------------------------

INSERT INTO public.standalone_backup_targets (provider, name, config) VALUES
  ('supabase_storage', 'Internal Storage', '{"bucket": "standalone-bundles", "path_prefix": "backups"}'::jsonb)
ON CONFLICT DO NOTHING;

-- 8. UPDATED_AT TRIGGER
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_standalone_artifact_versions_updated_at
  BEFORE UPDATE ON public.standalone_artifact_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_standalone_backups_updated_at
  BEFORE UPDATE ON public.standalone_backups
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_standalone_restore_events_updated_at
  BEFORE UPDATE ON public.standalone_restore_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
