
-- Council 6 Upgrade: Catalog Scan RPCs + UNIQUE constraint + security area

-- 1) Add 'security' to the allowed area values (re-create check)
ALTER TABLE public.compliance_findings DROP CONSTRAINT IF EXISTS compliance_findings_area_check;
ALTER TABLE public.compliance_findings ADD CONSTRAINT compliance_findings_area_check 
  CHECK (area IN ('pii','rls','retention','ai_act','azav_iso','exports','security'));

-- 2) Add UNIQUE constraint on (area, title) for idempotent upserts
DO $$ BEGIN
  ALTER TABLE public.compliance_findings ADD CONSTRAINT compliance_findings_area_title_key UNIQUE (area, title);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Add findings_snapshot column to compliance_reports if missing
ALTER TABLE public.compliance_reports
ADD COLUMN IF NOT EXISTS findings_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 4) Idempotent upsert RPC
CREATE OR REPLACE FUNCTION public.upsert_compliance_finding(
  p_area text,
  p_severity public.compliance_severity,
  p_title text,
  p_description text,
  p_evidence jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.compliance_findings(area, severity, title, description, evidence_json, status, updated_at)
  VALUES (p_area, p_severity, p_title, p_description, coalesce(p_evidence, '{}'::jsonb), 'open', now())
  ON CONFLICT (area, title)
  DO UPDATE SET
    severity = EXCLUDED.severity,
    description = EXCLUDED.description,
    evidence_json = EXCLUDED.evidence_json,
    updated_at = now(),
    status = CASE
      WHEN public.compliance_findings.status IN ('resolved','accepted_risk') THEN public.compliance_findings.status
      ELSE 'open'
    END
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 5) Catalog scan: RLS status for given tables
CREATE OR REPLACE FUNCTION public.compliance_rls_status(p_tables text[])
RETURNS TABLE (schemaname text, tablename text, rls_enabled boolean, force_rls boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    n.nspname::text AS schemaname,
    c.relname::text AS tablename,
    c.relrowsecurity AS rls_enabled,
    c.relforcerowsecurity AS force_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname = 'public'
    AND c.relname = ANY(p_tables);
$$;

-- 6) Catalog scan: policies for given tables
CREATE OR REPLACE FUNCTION public.compliance_policies(p_tables text[])
RETURNS TABLE (
  schemaname text,
  tablename text,
  policyname text,
  permissive text,
  roles text[],
  cmd text,
  qual text,
  with_check text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.schemaname::text,
    p.tablename::text,
    p.policyname::text,
    p.permissive::text,
    p.roles::text[],
    p.cmd::text,
    p.qual::text,
    p.with_check::text
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = ANY(p_tables);
$$;
