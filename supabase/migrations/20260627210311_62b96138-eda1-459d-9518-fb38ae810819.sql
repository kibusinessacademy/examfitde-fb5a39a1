
CREATE TABLE IF NOT EXISTS public.store_ops_intelligence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  risk_total int NOT NULL,
  risk_level text NOT NULL,
  risk_technical int NOT NULL,
  risk_governance int NOT NULL,
  risk_operational int NOT NULL,
  confidence_score numeric NOT NULL,
  confidence_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation_codes text[] NOT NULL DEFAULT '{}',
  warnings text[] NOT NULL DEFAULT '{}',
  input_batches_count int NOT NULL DEFAULT 0,
  input_runs_count int NOT NULL DEFAULT 0,
  input_kpi_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_ops_intelligence_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.store_ops_intelligence_runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  key text NOT NULL,
  value_numeric numeric,
  value_text text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_ops_intelligence_runs TO authenticated;
GRANT ALL ON public.store_ops_intelligence_runs TO service_role;
GRANT SELECT ON public.store_ops_intelligence_findings TO authenticated;
GRANT ALL ON public.store_ops_intelligence_findings TO service_role;

ALTER TABLE public.store_ops_intelligence_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_ops_intelligence_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intel_runs_admin_read"
  ON public.store_ops_intelligence_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "intel_findings_admin_read"
  ON public.store_ops_intelligence_findings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Append-only guards: block UPDATE and DELETE on both tables.
CREATE OR REPLACE FUNCTION public.fn_store_ops_intel_no_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'store_ops_intelligence_% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_intel_runs_no_update
  BEFORE UPDATE OR DELETE ON public.store_ops_intelligence_runs
  FOR EACH ROW EXECUTE FUNCTION public.fn_store_ops_intel_no_mutation();

CREATE TRIGGER trg_intel_findings_no_update
  BEFORE UPDATE OR DELETE ON public.store_ops_intelligence_findings
  FOR EACH ROW EXECUTE FUNCTION public.fn_store_ops_intel_no_mutation();

CREATE INDEX IF NOT EXISTS idx_intel_runs_evaluated_at
  ON public.store_ops_intelligence_runs (evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_intel_findings_run_kind
  ON public.store_ops_intelligence_findings (run_id, kind);
