
CREATE TABLE IF NOT EXISTS public.nightly_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms int,
  status text NOT NULL DEFAULT 'running',
  verdict text NOT NULL DEFAULT 'unknown',
  audit_version text NOT NULL DEFAULT 'v2',
  total_findings int NOT NULL DEFAULT 0,
  critical_findings int NOT NULL DEFAULT 0,
  warning_findings int NOT NULL DEFAULT 0,
  info_findings int NOT NULL DEFAULT 0,
  healed_count int NOT NULL DEFAULT 0,
  module_count int NOT NULL DEFAULT 0,
  module_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.nightly_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.nightly_audit_runs(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  severity text NOT NULL,
  finding_code text NOT NULL,
  finding_class text NOT NULL DEFAULT 'symptom',
  actionability text NOT NULL DEFAULT 'investigate',
  entity_type text,
  entity_id text,
  title text NOT NULL,
  detail text,
  metric_value numeric,
  healed boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nar_started ON public.nightly_audit_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_nar_verdict ON public.nightly_audit_runs(verdict);
CREATE INDEX IF NOT EXISTS idx_naf_run_id ON public.nightly_audit_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_naf_finding_code ON public.nightly_audit_findings(finding_code);
CREATE INDEX IF NOT EXISTS idx_naf_entity_ref ON public.nightly_audit_findings(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_naf_sev_date ON public.nightly_audit_findings(severity, created_at DESC);

ALTER TABLE public.nightly_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nightly_audit_findings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'nightly_audit_runs' AND policyname = 'svc_audit_runs') THEN
    CREATE POLICY "svc_audit_runs" ON public.nightly_audit_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'nightly_audit_findings' AND policyname = 'svc_audit_findings') THEN
    CREATE POLICY "svc_audit_findings" ON public.nightly_audit_findings FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE VIEW public.v_audit_finding_trends AS
WITH recent_runs AS (
  SELECT id, started_at, ROW_NUMBER() OVER (ORDER BY started_at DESC) AS run_rank
  FROM public.nightly_audit_runs WHERE status = 'completed'
  ORDER BY started_at DESC LIMIT 14
),
fh AS (
  SELECT f.finding_code, f.entity_type, f.entity_id, f.severity, f.finding_class,
    r.run_rank, r.started_at AS run_date, f.metric_value, f.healed
  FROM public.nightly_audit_findings f JOIN recent_runs r ON r.id = f.run_id
)
SELECT finding_code, entity_type, entity_id,
  MAX(severity) AS max_severity, MAX(finding_class) AS finding_class,
  COUNT(*) AS occurrence_count,
  COUNT(*) FILTER (WHERE run_rank = 1) AS in_latest,
  COUNT(*) FILTER (WHERE run_rank <= 3) AS in_last_3,
  MIN(run_date) AS first_seen, MAX(run_date) AS last_seen,
  CASE
    WHEN COUNT(*) FILTER (WHERE run_rank = 1) > 0 AND COUNT(*) >= 3 THEN 'persistent'
    WHEN COUNT(*) FILTER (WHERE run_rank = 1) > 0 AND COUNT(*) < 3 THEN 'new'
    WHEN COUNT(*) FILTER (WHERE run_rank = 1) = 0 AND COUNT(*) FILTER (WHERE run_rank <= 3) > 0 THEN 'healed'
    WHEN COUNT(*) FILTER (WHERE run_rank = 1) > 0 
      AND COUNT(*) FILTER (WHERE run_rank BETWEEN 2 AND 4) = 0
      AND COUNT(*) FILTER (WHERE run_rank > 4) > 0 THEN 'relapsed'
    ELSE 'resolved'
  END AS trend_status,
  BOOL_OR(healed) AS was_ever_healed
FROM fh GROUP BY finding_code, entity_type, entity_id;
