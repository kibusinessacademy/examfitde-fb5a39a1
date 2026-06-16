
-- ============================================================
-- KIMI.INTELLIGENCE.1 — Quality Intelligence Layer
-- Read-only diagnostic layer over the production pipeline
-- ============================================================

-- 1) SNAPSHOTS: one row per cron run / per module
CREATE TABLE public.quality_intelligence_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  module TEXT NOT NULL CHECK (module IN ('failure','coverage','drift','council','curriculum','didaktik','promotion','seo')),
  run_id UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','partial')),
  model TEXT,
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  finding_count INTEGER NOT NULL DEFAULT 0,
  recommendation_count INTEGER NOT NULL DEFAULT 0,
  tokens_input INTEGER,
  tokens_output INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qis_module_started ON public.quality_intelligence_snapshots(module, started_at DESC);
CREATE INDEX idx_qis_status ON public.quality_intelligence_snapshots(status);

GRANT SELECT ON public.quality_intelligence_snapshots TO authenticated;
GRANT ALL ON public.quality_intelligence_snapshots TO service_role;
ALTER TABLE public.quality_intelligence_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qis_admin_read" ON public.quality_intelligence_snapshots
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "qis_service_all" ON public.quality_intelligence_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- 2) FINDINGS: individual diagnostic findings
CREATE TABLE public.quality_intelligence_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES public.quality_intelligence_snapshots(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  cluster_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  root_cause TEXT,
  affected_count INTEGER NOT NULL DEFAULT 1,
  affected_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed','superseded')),
  acknowledged_by UUID,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qif_snapshot ON public.quality_intelligence_findings(snapshot_id);
CREATE INDEX idx_qif_module_status ON public.quality_intelligence_findings(module, status);
CREATE INDEX idx_qif_cluster ON public.quality_intelligence_findings(cluster_key);
CREATE INDEX idx_qif_severity ON public.quality_intelligence_findings(severity, status);

GRANT SELECT, UPDATE ON public.quality_intelligence_findings TO authenticated;
GRANT ALL ON public.quality_intelligence_findings TO service_role;
ALTER TABLE public.quality_intelligence_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qif_admin_read" ON public.quality_intelligence_findings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "qif_admin_update" ON public.quality_intelligence_findings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "qif_service_all" ON public.quality_intelligence_findings
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- 3) RECOMMENDATIONS: actionable repair proposals
CREATE TABLE public.quality_intelligence_recommendations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES public.quality_intelligence_snapshots(id) ON DELETE CASCADE,
  finding_id UUID REFERENCES public.quality_intelligence_findings(id) ON DELETE SET NULL,
  module TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
  action_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  proposed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_table TEXT,
  target_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_impact JSONB NOT NULL DEFAULT '{}'::jsonb,
  estimated_effort TEXT CHECK (estimated_effort IN ('xs','s','m','l','xl')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','enqueued','done','superseded')),
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  enqueued_job_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_qir_snapshot ON public.quality_intelligence_recommendations(snapshot_id);
CREATE INDEX idx_qir_status_priority ON public.quality_intelligence_recommendations(status, priority);
CREATE INDEX idx_qir_module ON public.quality_intelligence_recommendations(module);
CREATE INDEX idx_qir_finding ON public.quality_intelligence_recommendations(finding_id);

GRANT SELECT, UPDATE ON public.quality_intelligence_recommendations TO authenticated;
GRANT ALL ON public.quality_intelligence_recommendations TO service_role;
ALTER TABLE public.quality_intelligence_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qir_admin_read" ON public.quality_intelligence_recommendations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "qir_admin_update" ON public.quality_intelligence_recommendations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "qir_service_all" ON public.quality_intelligence_recommendations
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- 4) updated_at triggers
CREATE TRIGGER trg_qif_updated_at
  BEFORE UPDATE ON public.quality_intelligence_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_qir_updated_at
  BEFORE UPDATE ON public.quality_intelligence_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 5) Helper: list open high-priority recommendations for the admin inbox
CREATE OR REPLACE FUNCTION public.fn_qil_open_recommendations(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id UUID,
  module TEXT,
  priority TEXT,
  action_kind TEXT,
  title TEXT,
  rationale TEXT,
  target_table TEXT,
  target_ids JSONB,
  estimated_impact JSONB,
  estimated_effort TEXT,
  finding_severity TEXT,
  finding_cluster TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.module, r.priority, r.action_kind, r.title, r.rationale,
         r.target_table, r.target_ids, r.estimated_impact, r.estimated_effort,
         f.severity, f.cluster_key, r.created_at
  FROM public.quality_intelligence_recommendations r
  LEFT JOIN public.quality_intelligence_findings f ON f.id = r.finding_id
  WHERE r.status = 'pending'
  ORDER BY
    CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
    r.created_at DESC
  LIMIT p_limit
$$;

GRANT EXECUTE ON FUNCTION public.fn_qil_open_recommendations(INT) TO authenticated;
