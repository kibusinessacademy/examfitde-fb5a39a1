
-- Council 6 Phase 2: Remediation Workflow + Report Builder

-- 1) Add columns to compliance_findings for council linkage
ALTER TABLE public.compliance_findings
ADD COLUMN IF NOT EXISTS council_version_id uuid NULL,
ADD COLUMN IF NOT EXISTS patch_plan_id uuid NULL;

-- 2) Helper: set finding status
CREATE OR REPLACE FUNCTION public.set_compliance_finding_status(
  p_finding_id uuid,
  p_status public.compliance_status
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.compliance_findings
  SET status = p_status,
      updated_at = now()
  WHERE id = p_finding_id;
END $$;

-- 3) Helper: attach remediation_json to finding
CREATE OR REPLACE FUNCTION public.attach_finding_remediation(
  p_finding_id uuid,
  p_remediation jsonb,
  p_council_version_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.compliance_findings
  SET remediation_json = p_remediation,
      council_version_id = p_council_version_id,
      updated_at = now()
  WHERE id = p_finding_id;
END $$;

-- 4) Helper: create patch plan from finding (approved remediation)
CREATE OR REPLACE FUNCTION public.create_patch_plan_from_finding(
  p_finding_id uuid,
  p_title text,
  p_severity text,
  p_patches jsonb,
  p_council_version_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.admin_patch_plans(title, severity, affected_area, patches_json, council_version_id, status)
  VALUES (p_title, p_severity, 'compliance', coalesce(p_patches,'[]'::jsonb), p_council_version_id, 'approved')
  RETURNING id INTO v_id;

  UPDATE public.compliance_findings
  SET patch_plan_id = v_id,
      council_version_id = p_council_version_id,
      updated_at = now()
  WHERE id = p_finding_id;

  RETURN v_id;
END $$;

-- 5) Report generator: snapshot summary from current findings
CREATE OR REPLACE FUNCTION public.generate_compliance_report(p_report_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_summary jsonb;
BEGIN
  SELECT jsonb_build_object(
    'generated_at', now(),
    'open_counts', (
      SELECT coalesce(jsonb_object_agg(severity, cnt), '{}'::jsonb)
      FROM (
        SELECT severity::text, count(*) cnt
        FROM public.compliance_findings
        WHERE status = 'open'
        GROUP BY severity
      ) t
    ),
    'open_by_area', (
      SELECT coalesce(jsonb_object_agg(area, cnt), '{}'::jsonb)
      FROM (
        SELECT area, count(*) cnt
        FROM public.compliance_findings
        WHERE status = 'open'
        GROUP BY area
      ) t
    ),
    'critical_items', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'area', area,
        'severity', severity,
        'title', title,
        'updated_at', updated_at,
        'patch_plan_id', patch_plan_id
      )), '[]'::jsonb)
      FROM (
        SELECT id, area, severity, title, updated_at, patch_plan_id
        FROM public.compliance_findings
        WHERE status = 'open' AND severity = 'critical'
        ORDER BY updated_at DESC
        LIMIT 20
      ) sub
    ),
    'remediated_count', (
      SELECT count(*)
      FROM public.compliance_findings
      WHERE patch_plan_id IS NOT NULL
    )
  ) INTO v_summary;

  INSERT INTO public.compliance_reports(report_type, scope_json, summary_json)
  VALUES (p_report_type, '{}'::jsonb, coalesce(v_summary,'{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
