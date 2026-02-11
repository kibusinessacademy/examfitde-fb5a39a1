
-- Council 6: Compliance & Data Protection Council
-- Tables: compliance_findings, compliance_reports + publish gate

-- 1) Custom types
DO $$ BEGIN
  CREATE TYPE public.compliance_severity AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_status AS ENUM ('open','in_progress','resolved','accepted_risk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) compliance_findings
CREATE TABLE IF NOT EXISTS public.compliance_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL CHECK (area IN ('pii','rls','retention','ai_act','azav_iso','exports')),
  severity public.compliance_severity NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  remediation_json jsonb NULL,
  status public.compliance_status NOT NULL DEFAULT 'open',
  created_by text NOT NULL DEFAULT 'council',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_findings_open
ON public.compliance_findings(status, severity, area);

-- 3) compliance_reports
CREATE TABLE IF NOT EXISTS public.compliance_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type text NOT NULL CHECK (report_type IN ('weekly','release','azav','iso29993','ai_act')),
  scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4) RLS (admin-only)
ALTER TABLE public.compliance_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_compliance_findings"
ON public.compliance_findings FOR ALL
USING (public.is_admin_user(auth.uid()));

CREATE POLICY "admin_compliance_reports"
ON public.compliance_reports FOR ALL
USING (public.is_admin_user(auth.uid()));

-- 5) Publish gate: compliance_blocked on courses
ALTER TABLE public.courses
ADD COLUMN IF NOT EXISTS compliance_blocked boolean NOT NULL DEFAULT false;

-- 6) Recompute function
CREATE OR REPLACE FUNCTION public.recompute_compliance_block(p_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_critical int;
BEGIN
  SELECT COUNT(*) INTO v_critical
  FROM public.compliance_findings
  WHERE status = 'open' AND severity = 'critical';

  UPDATE public.courses
  SET compliance_blocked = (v_critical > 0)
  WHERE id = p_course_id;
END $$;

-- 7) updated_at trigger
CREATE OR REPLACE FUNCTION public.trg_compliance_findings_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_compliance_findings_updated ON public.compliance_findings;
CREATE TRIGGER trg_compliance_findings_updated
BEFORE UPDATE ON public.compliance_findings
FOR EACH ROW EXECUTE FUNCTION public.trg_compliance_findings_updated();
