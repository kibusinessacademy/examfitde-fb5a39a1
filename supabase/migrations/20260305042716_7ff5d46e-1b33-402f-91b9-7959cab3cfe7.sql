
-- ╔══════════════════════════════════════════════════════════╗
-- ║  ExamFit Autonomous Audit System — Core Tables          ║
-- ╚══════════════════════════════════════════════════════════╝

-- 1) Audit Runs: Each orchestrated audit execution
CREATE TABLE IF NOT EXISTS public.system_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  scope text NOT NULL DEFAULT 'daily',  -- daily | weekly_deep | monthly_forensic | targeted
  mode text NOT NULL DEFAULT 'safe_autofix',  -- report_only | safe_autofix | aggressive_autofix
  target_package_id uuid,  -- null = full system audit
  
  -- Health Scores
  health_score numeric(5,2),
  infra_score numeric(5,2),
  pipeline_score numeric(5,2),
  data_score numeric(5,2),
  content_score numeric(5,2),
  didactic_score numeric(5,2),
  security_score numeric(5,2),
  
  -- Summary
  total_checks integer DEFAULT 0,
  passed_checks integer DEFAULT 0,
  warning_checks integer DEFAULT 0,
  critical_checks integer DEFAULT 0,
  
  -- AutoFix Summary
  autofix_attempted integer DEFAULT 0,
  autofix_applied integer DEFAULT 0,
  autofix_skipped integer DEFAULT 0,
  autofix_failed integer DEFAULT 0,
  
  status text NOT NULL DEFAULT 'running',  -- running | completed | failed | partial
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Audit Findings: Individual check results per run
CREATE TABLE IF NOT EXISTS public.system_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.system_audit_runs(id) ON DELETE CASCADE,
  
  -- Classification
  layer text NOT NULL,  -- infra | pipeline | data | content | didactic | security | e2e
  check_id text NOT NULL,  -- e.g. 'PIPE_001_stalled_steps'
  check_name text NOT NULL,
  
  -- Result
  severity text NOT NULL DEFAULT 'info',  -- info | warning | critical
  passed boolean NOT NULL DEFAULT true,
  metric_value numeric,
  threshold numeric,
  
  -- Root Cause (populated by root-cause engine)
  root_cause_category text,  -- missing_job | artifact_gap | content_not_generated | schema_drift | approval_gap
  root_cause_detail text,
  root_cause_confidence numeric(5,2),
  dependency_chain jsonb,  -- graph path showing causal chain
  
  -- Evidence
  sample_rows jsonb,
  affected_entities jsonb,  -- [{type: 'package', id: '...', title: '...'}, ...]
  
  -- Remediation
  recommended_action text,
  action_risk text,  -- safe | guarded | manual
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_findings_run ON public.system_audit_findings(run_id);
CREATE INDEX idx_audit_findings_severity ON public.system_audit_findings(severity) WHERE NOT passed;
CREATE INDEX idx_audit_findings_layer ON public.system_audit_findings(layer);

-- 3) Audit Actions: Self-heal actions taken
CREATE TABLE IF NOT EXISTS public.system_audit_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.system_audit_runs(id) ON DELETE CASCADE,
  finding_id uuid REFERENCES public.system_audit_findings(id) ON DELETE SET NULL,
  
  -- Action
  action_type text NOT NULL,  -- remove_duplicate_job | reset_stalled_step | enqueue_missing_job | inject_didaktik_steps
  action_risk text NOT NULL DEFAULT 'safe',  -- safe | guarded | manual
  
  -- Before/After snapshots for forensic proof
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb,
  diff jsonb,
  
  -- Result
  status text NOT NULL DEFAULT 'pending',  -- pending | applied | skipped | failed | rollback
  error_message text,
  executed_at timestamptz,
  
  -- Target
  target_type text,  -- package | job | step | question
  target_id text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actions_run ON public.system_audit_actions(run_id);
CREATE INDEX idx_audit_actions_status ON public.system_audit_actions(status);

-- RLS: All tables service-role only (system audit = internal ops)
ALTER TABLE public.system_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_audit_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_audit_actions ENABLE ROW LEVEL SECURITY;

-- Service role policies (admin reads via admin-ops edge function)
CREATE POLICY "service_role_full_access" ON public.system_audit_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.system_audit_findings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.system_audit_actions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users can read (for admin dashboard)
CREATE POLICY "admin_read_audit_runs" ON public.system_audit_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_read_audit_findings" ON public.system_audit_findings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_read_audit_actions" ON public.system_audit_actions
  FOR SELECT TO authenticated USING (true);
