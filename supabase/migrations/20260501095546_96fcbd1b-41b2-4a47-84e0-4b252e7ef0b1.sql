-- ─────────────────────────────────────────────────────────────────────────
-- PHASE 1: Canonical Identity Contract — Registry & package_key
-- ─────────────────────────────────────────────────────────────────────────

-- Helper: Normalize text → identity key (lowercase, alphanum + _)
CREATE OR REPLACE FUNCTION public.fn_normalize_identity_key(p_input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  IF p_input IS NULL OR p_input = '' THEN RETURN NULL; END IF;
  v := lower(p_input);
  v := translate(v, 'äöüß/-', 'aousn_');
  v := regexp_replace(v, '[^a-z0-9_]+', '_', 'g');
  v := regexp_replace(v, '_+', '_', 'g');
  v := trim(both '_' from v);
  IF v = '' THEN RETURN NULL; END IF;
  RETURN v;
END;
$$;

-- ── Job-Type Registry: erweitern (ops_job_type_registry ist bereits SSOT) ──

ALTER TABLE public.ops_job_type_registry
  ADD COLUMN IF NOT EXISTS job_name text,
  ADD COLUMN IF NOT EXISTS lane text,
  ADD COLUMN IF NOT EXISTS step_key text,
  ADD COLUMN IF NOT EXISTS is_governance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_package_id boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill job_name aus job_type (lesbar)
UPDATE public.ops_job_type_registry
SET job_name = initcap(replace(job_type, '_', ' '))
WHERE job_name IS NULL;

-- Backfill lane aus pool falls vorhanden
UPDATE public.ops_job_type_registry
SET lane = pool
WHERE lane IS NULL AND pool IS NOT NULL;

-- Backfill requires_package_id: alle package_*/lesson_*/handbook_*/pool_*-Jobs sind paketgebunden
UPDATE public.ops_job_type_registry
SET requires_package_id = true
WHERE requires_package_id = false
  AND (job_type LIKE 'package_%'
       OR job_type LIKE 'pool_%'
       OR job_type LIKE 'handbook_%'
       OR job_type LIKE 'lesson_%'
       OR job_type IN (
         'mass_enrich_competencies_v2',
         'ensure_variant_inventory',
         'validate_variant_inventory'
       ));

-- Backfill is_governance: integrity / quality_council / auto_publish / council_*
UPDATE public.ops_job_type_registry
SET is_governance = true
WHERE is_governance = false
  AND (job_type LIKE '%integrity%'
       OR job_type LIKE '%quality_council%'
       OR job_type LIKE 'council_%'
       OR job_type LIKE '%auto_publish%');

-- Trigger: updated_at pflegen
CREATE OR REPLACE FUNCTION public.tg_ops_job_type_registry_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ops_job_type_registry_touch ON public.ops_job_type_registry;
CREATE TRIGGER trg_ops_job_type_registry_touch
  BEFORE UPDATE ON public.ops_job_type_registry
  FOR EACH ROW EXECUTE FUNCTION public.tg_ops_job_type_registry_touch();

COMMENT ON COLUMN public.ops_job_type_registry.job_name IS 'Menschenlesbarer Name. Pflicht für Logs/Admin.';
COMMENT ON COLUMN public.ops_job_type_registry.requires_package_id IS 'Wenn true, MUSS jeder job_queue-Eintrag mit diesem job_type package_id IS NOT NULL haben (Phase 3 Guard).';
COMMENT ON COLUMN public.ops_job_type_registry.is_governance IS 'Governance-Step: integrity, council, auto_publish. Nur über dedizierte Producer enqueuebar.';

-- ── course_packages.package_key (stabiler lesbarer Identifier) ──

ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS package_key text,
  ADD COLUMN IF NOT EXISTS package_key_assigned_at timestamptz;

-- Hybrid-Backfill: <cert_slug>__<track>[__<track_subtype>][__v<version>][__<id_short>]
-- Schritt 1: Basis-Key aus cert_slug + track
WITH base AS (
  SELECT
    cp.id,
    public.fn_normalize_identity_key(c.slug) AS cert_norm,
    public.fn_normalize_identity_key(cp.track::text) AS track_norm,
    public.fn_normalize_identity_key(cp.track_subtype) AS subtype_norm,
    cp.version,
    substring(cp.id::text, 1, 8) AS id_short
  FROM public.course_packages cp
  LEFT JOIN public.certifications c ON c.id = cp.certification_id
  WHERE cp.package_key IS NULL
),
keyed AS (
  SELECT
    id,
    concat_ws('__',
      coalesce(cert_norm, 'pkg_' || id_short),
      coalesce(track_norm, 'default'),
      subtype_norm
    ) AS base_key,
    version,
    id_short
  FROM base
),
-- Schritt 2: Bei Kollisionen Version anhängen, falls weiterhin Kollision id_short
deduped AS (
  SELECT
    id,
    base_key,
    version,
    id_short,
    COUNT(*) OVER (PARTITION BY base_key) AS collision_count,
    ROW_NUMBER() OVER (PARTITION BY base_key ORDER BY version, id) AS collision_rank
  FROM keyed
)
UPDATE public.course_packages cp
SET
  package_key = CASE
    WHEN d.collision_count = 1 THEN d.base_key
    WHEN d.collision_count > 1 AND d.version > 1 THEN d.base_key || '__v' || d.version
    ELSE d.base_key || '__' || d.id_short
  END,
  package_key_assigned_at = now()
FROM deduped d
WHERE cp.id = d.id AND cp.package_key IS NULL;

-- Sicherheitsnetz: falls trotz Logik noch Duplikate, hänge id_short an
WITH dups AS (
  SELECT package_key
  FROM public.course_packages
  WHERE package_key IS NOT NULL
  GROUP BY package_key
  HAVING COUNT(*) > 1
)
UPDATE public.course_packages cp
SET package_key = cp.package_key || '__' || substring(cp.id::text, 1, 8)
WHERE cp.package_key IN (SELECT package_key FROM dups);

-- Unique partial index
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_packages_package_key
  ON public.course_packages(package_key)
  WHERE package_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_packages_package_key_lookup
  ON public.course_packages(package_key);

COMMENT ON COLUMN public.course_packages.package_key IS
  'Stabiler menschenlesbarer Identifier. Wird einmal vergeben und NIEMALS geändert. Format: <cert_slug>__<track>[__<subtype>][__v<n>|__<idshort>]. SSOT für Logs/Admin/Audit. title kann sich ändern, package_key nicht.';

-- Trigger: package_key ist append-only / immutable nach erster Vergabe
CREATE OR REPLACE FUNCTION public.tg_guard_package_key_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.package_key IS NOT NULL AND NEW.package_key IS DISTINCT FROM OLD.package_key THEN
    RAISE EXCEPTION 'PACKAGE_KEY_IMMUTABLE: package_key % darf nach Vergabe nicht geändert werden (versuchte Änderung auf %)',
      OLD.package_key, NEW.package_key
      USING ERRCODE = '23514';
  END IF;
  IF NEW.package_key IS NOT NULL AND OLD.package_key IS NULL AND NEW.package_key_assigned_at IS NULL THEN
    NEW.package_key_assigned_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_package_key_immutable ON public.course_packages;
CREATE TRIGGER trg_guard_package_key_immutable
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_package_key_immutable();