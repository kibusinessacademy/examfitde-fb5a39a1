
ALTER TABLE public.storage_bucket_registry
  ADD COLUMN IF NOT EXISTS content_class text NOT NULL DEFAULT 'unknown';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='storage_bucket_registry_content_class_chk') THEN
    ALTER TABLE public.storage_bucket_registry
      ADD CONSTRAINT storage_bucket_registry_content_class_chk
      CHECK (content_class IN ('exam_content','curriculum','learner_data','assessment','certificate','ai_artifact','seo_asset','system_asset','media_upload','unknown'));
  END IF;
END $$;

ALTER TABLE public.storage_rls_audit_findings
  ADD COLUMN IF NOT EXISTS content_class text NOT NULL DEFAULT 'unknown';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='storage_rls_audit_findings_content_class_chk') THEN
    ALTER TABLE public.storage_rls_audit_findings
      ADD CONSTRAINT storage_rls_audit_findings_content_class_chk
      CHECK (content_class IN ('exam_content','curriculum','learner_data','assessment','certificate','ai_artifact','seo_asset','system_asset','media_upload','unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_storage_findings_content_class
  ON public.storage_rls_audit_findings(content_class, severity, status);

DROP VIEW IF EXISTS public.v_admin_storage_bucket_maturity;
CREATE VIEW public.v_admin_storage_bucket_maturity AS
WITH last_findings AS (
  SELECT bucket_id,
         max(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS max_sev,
         count(*) FILTER (WHERE status='open') AS open_count,
         count(*) FILTER (WHERE severity IN ('high','critical') AND status='open') AS hi_open
  FROM public.storage_rls_audit_findings
  GROUP BY bucket_id
)
SELECT
  r.bucket_id, r.purpose, r.tenant_model, r.content_class,
  r.expected_path_regex, r.owner_module, r.risk_level,
  r.is_public, r.observed_object_count, r.last_seen_at,
  COALESCE(f.open_count,0) AS open_findings,
  COALESCE(f.hi_open,0)    AS high_open_findings,
  CASE
    WHEN r.is_public IS TRUE THEN 'bronze'
    WHEN COALESCE(f.hi_open,0) > 0 THEN 'bronze'
    WHEN r.tenant_model = 'unknown' THEN 'bronze'
    WHEN r.tenant_model IN ('org','user') AND r.expected_path_regex IS NOT NULL AND COALESCE(f.open_count,0)=0 THEN 'gold'
    WHEN r.tenant_model IN ('org','user') AND r.expected_path_regex IS NOT NULL THEN 'silver'
    WHEN r.tenant_model IN ('org','user') THEN 'silver'
    ELSE 'bronze'
  END AS maturity
FROM public.storage_bucket_registry r
LEFT JOIN last_findings f USING (bucket_id)
ORDER BY r.bucket_id;
GRANT SELECT ON public.v_admin_storage_bucket_maturity TO authenticated;

CREATE OR REPLACE VIEW public.v_admin_storage_audit_kpis AS
WITH latest_run AS (
  SELECT id FROM public.storage_audit_runs WHERE status='completed' ORDER BY started_at DESC LIMIT 1
),
buckets AS (
  SELECT
    count(*)                                              AS total_buckets,
    count(*) FILTER (WHERE is_public IS TRUE)             AS public_buckets,
    count(*) FILTER (WHERE is_public IS NOT TRUE)         AS private_buckets,
    count(*) FILTER (WHERE tenant_model = 'unknown')      AS unclassified_buckets,
    count(*) FILTER (WHERE content_class = 'unknown')     AS uncl_content_buckets
  FROM public.storage_bucket_registry
),
fnd AS (
  SELECT
    count(*) FILTER (WHERE status='open')                                AS open_findings,
    count(*) FILTER (WHERE status='open' AND severity IN ('high','critical')) AS hi_open_findings,
    count(*) FILTER (WHERE finding_type='no_tenant_prefix_detected')     AS no_tenant_prefix_findings,
    count(*) FILTER (WHERE finding_type='flat_root_objects')             AS flat_root_findings,
    count(*) FILTER (WHERE finding_type='bucket_is_public')              AS public_bucket_findings,
    count(*) FILTER (WHERE finding_type='mixed_path_convention')         AS mixed_path_findings
  FROM public.storage_rls_audit_findings
),
content AS (
  SELECT COALESCE(jsonb_object_agg(content_class, cnt), '{}'::jsonb) AS findings_by_content_class
  FROM (
    SELECT content_class, count(*) AS cnt
    FROM public.storage_rls_audit_findings
    WHERE status='open'
    GROUP BY content_class
  ) c
)
SELECT
  (SELECT id FROM latest_run)               AS latest_run_id,
  b.total_buckets, b.public_buckets, b.private_buckets,
  b.unclassified_buckets, b.uncl_content_buckets,
  f.open_findings, f.hi_open_findings,
  f.no_tenant_prefix_findings, f.flat_root_findings,
  f.public_bucket_findings, f.mixed_path_findings,
  c.findings_by_content_class
FROM buckets b, fnd f, content c;
GRANT SELECT ON public.v_admin_storage_audit_kpis TO authenticated;
