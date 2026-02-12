
-- ═══════════════════════════════════════════════════════════
-- 1) ops_health_snapshots: Single source for Ops Dashboard
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.ops_health_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  overall_status TEXT NOT NULL DEFAULT 'green', -- red, yellow, green
  root_causes JSONB NOT NULL DEFAULT '[]'::jsonb,
  checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  guardrails JSONB NOT NULL DEFAULT '{}'::jsonb,
  autofix_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  job_queue_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  edge_function_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_integrity JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INT,
  metadata JSONB
);

ALTER TABLE public.ops_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read ops snapshots" ON public.ops_health_snapshots
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service can insert ops snapshots" ON public.ops_health_snapshots
  FOR INSERT WITH CHECK (true);

CREATE INDEX idx_ops_health_snapshot_at ON public.ops_health_snapshots(snapshot_at DESC);

-- ═══════════════════════════════════════════════════════════
-- 2) auto_heal_policies: SSOT for Auto-Heal configuration
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.auto_heal_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL,
  policy_json JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  notes TEXT
);

ALTER TABLE public.auto_heal_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage auto_heal_policies" ON public.auto_heal_policies
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service can read auto_heal_policies" ON public.auto_heal_policies
  FOR SELECT USING (true);

-- Ensure only one active policy at a time
CREATE UNIQUE INDEX idx_auto_heal_policies_active 
  ON public.auto_heal_policies(is_active) WHERE is_active = true;
