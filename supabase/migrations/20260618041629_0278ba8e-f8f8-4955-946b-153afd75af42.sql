
-- =============================================================
-- STORAGE.RLS.REALITY.AUDIT — Phase 0 (read-only inventory)
-- =============================================================

-- 1) Bucket inventory
CREATE TABLE IF NOT EXISTS public.storage_bucket_registry (
  bucket_id text PRIMARY KEY,
  purpose text,
  tenant_model text NOT NULL DEFAULT 'unknown'
    CHECK (tenant_model IN ('org','user','public','system','unknown')),
  expected_path_regex text,
  owner_module text,
  risk_level text NOT NULL DEFAULT 'unknown'
    CHECK (risk_level IN ('low','medium','high','critical','unknown')),
  notes text,
  is_public boolean,
  observed_object_count integer,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.storage_bucket_registry TO authenticated;
GRANT ALL ON public.storage_bucket_registry TO service_role;
ALTER TABLE public.storage_bucket_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read bucket registry" ON public.storage_bucket_registry
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service writes bucket registry" ON public.storage_bucket_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) Findings
CREATE TABLE IF NOT EXISTS public.storage_rls_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  bucket_id text NOT NULL,
  finding_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','low','medium','high','critical')),
  path_sample text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','resolved','suppressed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.storage_rls_audit_findings TO authenticated;
GRANT ALL ON public.storage_rls_audit_findings TO service_role;
ALTER TABLE public.storage_rls_audit_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read findings" ON public.storage_rls_audit_findings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update finding status" ON public.storage_rls_audit_findings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service writes findings" ON public.storage_rls_audit_findings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_storage_findings_bucket
  ON public.storage_rls_audit_findings(bucket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_findings_severity
  ON public.storage_rls_audit_findings(severity, status);

-- 3) Attack results (reserved for Phase 1)
CREATE TABLE IF NOT EXISTS public.storage_attack_run_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  bucket_id text NOT NULL,
  attack_type text NOT NULL,
  result text NOT NULL DEFAULT 'unknown'
    CHECK (result IN ('pass','leak','blocked','not_applicable','unknown')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.storage_attack_run_results TO authenticated;
GRANT ALL ON public.storage_attack_run_results TO service_role;
ALTER TABLE public.storage_attack_run_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read attack results" ON public.storage_attack_run_results
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service writes attack results" ON public.storage_attack_run_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_storage_attack_bucket
  ON public.storage_attack_run_results(bucket_id, created_at DESC);

-- 4) Run log
CREATE TABLE IF NOT EXISTS public.storage_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by uuid,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','cron','ci','api')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed')),
  buckets_scanned integer DEFAULT 0,
  objects_sampled integer DEFAULT 0,
  findings_count integer DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.storage_audit_runs TO authenticated;
GRANT ALL ON public.storage_audit_runs TO service_role;
ALTER TABLE public.storage_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read runs" ON public.storage_audit_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service writes runs" ON public.storage_audit_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5) updated_at triggers
CREATE OR REPLACE FUNCTION public.fn_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_storage_bucket_registry_touch ON public.storage_bucket_registry;
CREATE TRIGGER trg_storage_bucket_registry_touch
  BEFORE UPDATE ON public.storage_bucket_registry
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

DROP TRIGGER IF EXISTS trg_storage_findings_touch ON public.storage_rls_audit_findings;
CREATE TRIGGER trg_storage_findings_touch
  BEFORE UPDATE ON public.storage_rls_audit_findings
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_updated_at();

-- 6) Upsert RPC for registry maintenance (admin only)
CREATE OR REPLACE FUNCTION public.admin_storage_bucket_upsert(
  _bucket_id text,
  _purpose text DEFAULT NULL,
  _tenant_model text DEFAULT NULL,
  _expected_path_regex text DEFAULT NULL,
  _owner_module text DEFAULT NULL,
  _risk_level text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS public.storage_bucket_registry
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.storage_bucket_registry;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.storage_bucket_registry(bucket_id, purpose, tenant_model, expected_path_regex, owner_module, risk_level, notes)
  VALUES (_bucket_id, _purpose,
          COALESCE(_tenant_model,'unknown'),
          _expected_path_regex, _owner_module,
          COALESCE(_risk_level,'unknown'), _notes)
  ON CONFLICT (bucket_id) DO UPDATE SET
    purpose = COALESCE(EXCLUDED.purpose, public.storage_bucket_registry.purpose),
    tenant_model = COALESCE(EXCLUDED.tenant_model, public.storage_bucket_registry.tenant_model),
    expected_path_regex = COALESCE(EXCLUDED.expected_path_regex, public.storage_bucket_registry.expected_path_regex),
    owner_module = COALESCE(EXCLUDED.owner_module, public.storage_bucket_registry.owner_module),
    risk_level = COALESCE(EXCLUDED.risk_level, public.storage_bucket_registry.risk_level),
    notes = COALESCE(EXCLUDED.notes, public.storage_bucket_registry.notes)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_storage_bucket_upsert(text,text,text,text,text,text,text) TO authenticated;

-- 7) Enqueue helper (admin only) — creates a run row; edge function reads + processes
CREATE OR REPLACE FUNCTION public.admin_storage_audit_enqueue(_source text DEFAULT 'manual')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.storage_audit_runs(triggered_by, source, status)
  VALUES (auth.uid(), COALESCE(_source,'manual'), 'queued')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_storage_audit_enqueue(text) TO authenticated;

-- 8) Maturity view
CREATE OR REPLACE VIEW public.v_admin_storage_bucket_maturity AS
WITH last_findings AS (
  SELECT bucket_id,
         max(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS max_sev,
         count(*) FILTER (WHERE status='open') AS open_count,
         count(*) FILTER (WHERE severity IN ('high','critical') AND status='open') AS hi_open
  FROM public.storage_rls_audit_findings
  GROUP BY bucket_id
)
SELECT
  r.bucket_id,
  r.purpose,
  r.tenant_model,
  r.expected_path_regex,
  r.owner_module,
  r.risk_level,
  r.is_public,
  r.observed_object_count,
  r.last_seen_at,
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
