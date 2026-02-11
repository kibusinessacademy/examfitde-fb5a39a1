
-- Council 6 Phase 3: Release Gate Hardening + auto recompute + report pdf metadata

-- 1) Gate rules table (configurable, SSOT)
CREATE TABLE IF NOT EXISTS public.compliance_gate_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL CHECK (area IN ('pii','rls','retention','ai_act','azav_iso','exports','security')),
  min_severity public.compliance_severity NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(area)
);

INSERT INTO public.compliance_gate_rules(area, min_severity, enabled)
VALUES
  ('pii', 'high', true),
  ('rls', 'high', true),
  ('security', 'high', true),
  ('exports', 'critical', true),
  ('retention', 'critical', true),
  ('ai_act', 'critical', true),
  ('azav_iso', 'critical', true)
ON CONFLICT (area) DO NOTHING;

ALTER TABLE public.compliance_gate_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_compliance_gate_rules ON public.compliance_gate_rules;
CREATE POLICY deny_all_compliance_gate_rules
ON public.compliance_gate_rules FOR ALL USING (false);

DROP POLICY IF EXISTS admin_all_compliance_gate_rules ON public.compliance_gate_rules;
CREATE POLICY admin_all_compliance_gate_rules
ON public.compliance_gate_rules FOR ALL USING (public.is_admin_user(auth.uid()));

-- 2) Extend reports table: pdf pointer/metadata
ALTER TABLE public.compliance_reports
ADD COLUMN IF NOT EXISTS pdf_path text NULL,
ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz NULL;

-- 3) Severity ranking helper
CREATE OR REPLACE FUNCTION public.compliance_severity_rank(p public.compliance_severity)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p
    WHEN 'low' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'high' THEN 3
    WHEN 'critical' THEN 4
    ELSE 0 END;
$$;

-- 4) Compute whether release is blocked + reasons
CREATE OR REPLACE FUNCTION public.compute_compliance_release_gate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reasons jsonb := '[]'::jsonb;
BEGIN
  v_reasons := (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'area', r.area,
      'min_severity', r.min_severity,
      'open_findings', f.cnt
    )), '[]'::jsonb)
    FROM public.compliance_gate_rules r
    JOIN LATERAL (
      SELECT COUNT(*) cnt
      FROM public.compliance_findings cf
      WHERE cf.status = 'open'
        AND cf.area = r.area
        AND public.compliance_severity_rank(cf.severity) >= public.compliance_severity_rank(r.min_severity)
    ) f ON true
    WHERE r.enabled = true
      AND f.cnt > 0
  );

  RETURN jsonb_build_object(
    'blocked', (jsonb_array_length(v_reasons) > 0),
    'reasons', v_reasons
  );
END $$;

-- 5) Recompute compliance_blocked on ALL courses
CREATE OR REPLACE FUNCTION public.recompute_compliance_block_all_courses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate jsonb;
  v_blocked boolean;
BEGIN
  v_gate := public.compute_compliance_release_gate();
  v_blocked := COALESCE((v_gate->>'blocked')::boolean, false);
  UPDATE public.courses SET compliance_blocked = v_blocked;
END $$;

-- 6) Trigger to auto-recompute on finding changes
CREATE OR REPLACE FUNCTION public.trg_recompute_compliance_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.recompute_compliance_block_all_courses();
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_recompute_compliance_block_on_findings ON public.compliance_findings;
CREATE TRIGGER trg_recompute_compliance_block_on_findings
AFTER INSERT OR UPDATE OR DELETE ON public.compliance_findings
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_compliance_block();

-- 7) Hard assert function for publish/release flows
CREATE OR REPLACE FUNCTION public.assert_compliance_release_ok()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gate jsonb;
BEGIN
  v_gate := public.compute_compliance_release_gate();
  IF COALESCE((v_gate->>'blocked')::boolean, false) THEN
    RAISE EXCEPTION 'Compliance block: open findings violate gate rules. Details: %', v_gate::text;
  END IF;
END $$;

-- 8) Storage bucket for compliance report PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('compliance-reports', 'compliance-reports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY admin_compliance_reports_select
ON storage.objects FOR SELECT
USING (bucket_id = 'compliance-reports' AND (SELECT public.is_admin_user(auth.uid())));

CREATE POLICY admin_compliance_reports_insert
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'compliance-reports' AND (SELECT public.is_admin_user(auth.uid())));
