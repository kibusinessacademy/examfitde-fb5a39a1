CREATE TABLE IF NOT EXISTS public.quality_intelligence_ux_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  scope_kind text NOT NULL CHECK (scope_kind IN ('route','journey','component','feature','product')),
  scope_target text NOT NULL,
  persona text,
  product text NOT NULL DEFAULT 'examfit' CHECK (product IN ('examfit','berufos','shared')),
  model text NOT NULL,
  duration_ms integer,
  trust_score integer CHECK (trust_score BETWEEN 0 AND 100),
  conversion_score integer CHECK (conversion_score BETWEEN 0 AND 100),
  activation_score integer CHECK (activation_score BETWEEN 0 AND 100),
  motivation_score integer CHECK (motivation_score BETWEEN 0 AND 100),
  discoverability_score integer CHECK (discoverability_score BETWEEN 0 AND 100),
  workflow_efficiency_score integer CHECK (workflow_efficiency_score BETWEEN 0 AND 100),
  mobile_readiness_score integer CHECK (mobile_readiness_score BETWEEN 0 AND 100),
  cognitive_load_score integer CHECK (cognitive_load_score BETWEEN 0 AND 100),
  overall_grade text,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed','running')),
  error_text text
);

CREATE INDEX IF NOT EXISTS idx_qil_ux_reports_created_at ON public.quality_intelligence_ux_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qil_ux_reports_scope ON public.quality_intelligence_ux_reports(scope_kind, scope_target);
CREATE INDEX IF NOT EXISTS idx_qil_ux_reports_product ON public.quality_intelligence_ux_reports(product);

GRANT SELECT, INSERT, UPDATE ON public.quality_intelligence_ux_reports TO authenticated;
GRANT ALL ON public.quality_intelligence_ux_reports TO service_role;

ALTER TABLE public.quality_intelligence_ux_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ux_reports_admin_select"
  ON public.quality_intelligence_ux_reports
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ux_reports_service_write"
  ON public.quality_intelligence_ux_reports
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);