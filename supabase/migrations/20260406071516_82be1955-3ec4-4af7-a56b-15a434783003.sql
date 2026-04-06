
-- DB-side SSOT for QC coverage eligibility
-- Mirrors: supabase/functions/_shared/qc-status.ts → QC_COVERAGE_ELIGIBLE
-- Mirrors: src/lib/qcStatus.ts → isCoverageEligible()

CREATE OR REPLACE FUNCTION public.fn_is_qc_coverage_eligible(
  p_qc_status text,
  p_status text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    CASE
      WHEN p_qc_status IN ('approved', 'tier1_passed') THEN true
      WHEN p_qc_status IS NULL AND p_status = 'approved' THEN true
      ELSE false
    END;
$$;

COMMENT ON FUNCTION public.fn_is_qc_coverage_eligible(text, text) IS
'SSOT: Returns true if a question counts toward structural coverage metrics (LF, competency, pool size). '
'Coverage-eligible statuses: approved, tier1_passed. '
'Legacy fallback: NULL qc_status with status=approved. '
'Mirrors: supabase/functions/_shared/qc-status.ts and src/lib/qcStatus.ts';
