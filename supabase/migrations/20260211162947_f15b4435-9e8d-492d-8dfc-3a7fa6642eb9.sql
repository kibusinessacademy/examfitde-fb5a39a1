
-- ═══════════════════════════════════════════════════════════════════
-- Tech Council Phase 1: admin_patch_plans + tech_council_findings
-- ═══════════════════════════════════════════════════════════════════

-- 1) Tech Council Findings (scanner results)
CREATE TABLE IF NOT EXISTS public.tech_council_findings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_type text NOT NULL CHECK (scan_type IN ('rls_audit','edge_function_audit','queue_health','db_migration_audit','performance_audit','frontend_ssot_audit')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  title text NOT NULL,
  description text,
  evidence jsonb NOT NULL DEFAULT '{}',
  affected_entity text, -- e.g. table name, function name, file path
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','patched','dismissed','wont_fix')),
  council_version_id uuid NULL, -- FK to content_versions if a patch proposal exists
  scanned_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);

ALTER TABLE public.tech_council_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on tech_council_findings"
  ON public.tech_council_findings FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tcf_status ON public.tech_council_findings (status);
CREATE INDEX IF NOT EXISTS idx_tcf_scan_type ON public.tech_council_findings (scan_type);
CREATE INDEX IF NOT EXISTS idx_tcf_severity ON public.tech_council_findings (severity);

-- 2) Admin Patch Plans (council-approved remediation)
CREATE TABLE IF NOT EXISTS public.admin_patch_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  finding_id uuid REFERENCES public.tech_council_findings(id) ON DELETE SET NULL,
  title text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  affected_area text NOT NULL CHECK (affected_area IN ('rls','edge','db','ui','queue','performance')),
  patches_json jsonb NOT NULL DEFAULT '[]', -- array of {type: 'sql'|'code', path?: string, content: string, description: string}
  council_version_id uuid NULL,
  proposer_model text, -- e.g. 'gpt-4.1'
  validator_model text, -- e.g. 'claude-sonnet-4'
  proposer_reasoning text,
  validator_reasoning text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','applied','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  applied_at timestamptz,
  applied_by text
);

ALTER TABLE public.admin_patch_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on admin_patch_plans"
  ON public.admin_patch_plans FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_app_status ON public.admin_patch_plans (status);

-- 3) Publish gate: only approved patch plans can be applied
CREATE OR REPLACE FUNCTION public.guard_patch_plan_apply()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'applied' AND OLD.status != 'approved' THEN
    RAISE EXCEPTION 'PATCH_PLAN_GATE: Only approved plans can be applied. Current status: %', OLD.status;
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_patch_apply'
    AND tgrelid = 'public.admin_patch_plans'::regclass
  ) THEN
    CREATE TRIGGER trg_guard_patch_apply
      BEFORE UPDATE ON public.admin_patch_plans
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_patch_plan_apply();
  END IF;
END $$;
