-- ============================================================================
-- Migration 1/2: v_publish_readiness_gate (Klassifikations-SSOT)
-- Rollback: DROP VIEW v_publish_readiness_gate; DROP FUNCTION admin_get_publish_readiness_gate;
-- ============================================================================

CREATE OR REPLACE VIEW public.v_publish_readiness_gate AS
WITH base AS (
  SELECT
    cp.id AS package_id,
    cp.package_key,
    cp.title,
    cp.track,
    cp.status AS package_status,
    cp.integrity_passed,
    cp.council_approved,
    COALESCE((cp.integrity_report->>'score')::int, 0) AS score,
    COALESCE(cp.integrity_report->'v3'->'summary'->'hard_fail_reasons', '[]'::jsonb) AS hard_fail_reasons,
    COALESCE((cp.integrity_report->'v3'->'summary'->>'questions_approved_total')::int, 0) AS approved_total,
    NULLIF(cp.integrity_report->>'generated_at','')::timestamptz AS last_integrity_run_at,
    public.fn_is_bronze_locked(cp.id) AS bronze_locked,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending','processing')
    ) AS has_active_integrity_job,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.job_type = 'package_quality_council'
        AND jq.status IN ('pending','processing')
    ) AS has_active_council_job,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = cp.id
        AND jq.job_type = 'package_auto_publish'
        AND jq.status IN ('pending','processing')
    ) AS has_active_auto_publish_job
  FROM public.course_packages cp
  WHERE cp.status IN ('building','queued')
),
classified AS (
  SELECT
    b.*,
    jsonb_array_length(b.hard_fail_reasons) AS hard_fail_count,
    -- helper: does any hard_fail_reasons element match a pattern?
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(b.hard_fail_reasons) r
      WHERE r ILIKE '%TOO_FEW_APPROVED%'
    ) AS has_pool_gap,
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(b.hard_fail_reasons) r
      WHERE r ILIKE '%BLOOM_GATE%' OR r ILIKE '%MISSING_UNDERSTAND%' OR r ILIKE '%MISSING_EVALUATE%'
    ) AS has_bloom_gap,
    EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(b.hard_fail_reasons) r
      WHERE r ILIKE '%TRAP_COVERAGE_BLOCK%' OR r ILIKE '%HARDISH_TOO_LOW%' OR r ILIKE '%ELITE_CONTEXT%' OR r ILIKE '%CONFLICT_TYPE_LOW%'
    ) AS has_trap_gap
  FROM base b
)
SELECT
  c.package_id,
  c.package_key,
  c.title,
  c.track,
  c.package_status,
  c.integrity_passed,
  c.council_approved,
  c.score,
  c.approved_total,
  c.hard_fail_reasons,
  c.hard_fail_count,
  c.bronze_locked,
  c.last_integrity_run_at,
  c.has_active_integrity_job,
  c.has_active_council_job,
  c.has_active_auto_publish_job,
  EXTRACT(EPOCH FROM (now() - COALESCE(c.last_integrity_run_at, '1970-01-01'::timestamptz))) / 3600.0 AS hours_since_integrity,
  CASE
    -- Bronze takes precedence (locked state)
    WHEN c.bronze_locked THEN 'BRONZE_REVIEW_REQUIRED'
    -- Active downstream tail jobs → don't reclassify
    WHEN c.has_active_council_job THEN 'COUNCIL_PENDING'
    WHEN c.has_active_auto_publish_job THEN 'AUTO_PUBLISH_PENDING'
    -- Pool gap is most fundamental — must repair before integrity is meaningful
    WHEN c.has_pool_gap THEN 'POOL_GAP_REPAIR'
    WHEN c.has_bloom_gap THEN 'BLOOM_GAP_REPAIR'
    WHEN c.has_trap_gap THEN 'TRAP_GAP_REPAIR'
    -- No hard fails AND score qualifies
    WHEN c.hard_fail_count = 0 AND c.score >= 85 AND c.integrity_passed = true THEN 'READY'
    WHEN c.hard_fail_count = 0 AND c.score >= 75 AND c.score < 85 THEN 'BRONZE_REVIEW_REQUIRED'
    -- Stale integrity: high score, no hard fails, but flag is false (likely report drift)
    WHEN c.hard_fail_count = 0 AND c.score >= 85 AND c.integrity_passed = false
         AND NOT c.has_active_integrity_job THEN 'STALE_INTEGRITY'
    -- Has report but score below bronze threshold
    WHEN c.score > 0 AND c.score < 75 THEN 'NEEDS_INTEGRITY_FIRST'
    -- No report or score=0
    ELSE 'NEEDS_INTEGRITY_FIRST'
  END AS gate_class
FROM classified c;

REVOKE ALL ON public.v_publish_readiness_gate FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_publish_readiness_gate TO service_role;

COMMENT ON VIEW public.v_publish_readiness_gate IS
  'Publish-Readiness-Gate SSOT. Klassifiziert building/queued Pakete in genau eine Gate-Klasse basierend auf integrity_report.v3.summary.hard_fail_reasons (NICHT Coverage). Coverage ist KEIN Readiness-Signal. Nur via admin_get_publish_readiness_gate lesen.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: Admin-Wrapper mit has_role-Gate
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_publish_readiness_gate(
  p_class text DEFAULT NULL,
  p_limit int DEFAULT 500
)
RETURNS TABLE (
  package_id uuid,
  package_key text,
  title text,
  track text,
  package_status text,
  integrity_passed boolean,
  council_approved boolean,
  score int,
  approved_total int,
  hard_fail_reasons jsonb,
  hard_fail_count int,
  bronze_locked boolean,
  last_integrity_run_at timestamptz,
  has_active_integrity_job boolean,
  has_active_council_job boolean,
  has_active_auto_publish_job boolean,
  hours_since_integrity numeric,
  gate_class text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    v.package_id, v.package_key, v.title, v.track, v.package_status,
    v.integrity_passed, v.council_approved, v.score, v.approved_total,
    v.hard_fail_reasons, v.hard_fail_count, v.bronze_locked,
    v.last_integrity_run_at,
    v.has_active_integrity_job, v.has_active_council_job, v.has_active_auto_publish_job,
    v.hours_since_integrity, v.gate_class
  FROM public.v_publish_readiness_gate v
  WHERE p_class IS NULL OR v.gate_class = p_class
  ORDER BY
    CASE v.gate_class
      WHEN 'READY' THEN 1
      WHEN 'STALE_INTEGRITY' THEN 2
      WHEN 'BRONZE_REVIEW_REQUIRED' THEN 3
      WHEN 'COUNCIL_PENDING' THEN 4
      WHEN 'AUTO_PUBLISH_PENDING' THEN 5
      WHEN 'POOL_GAP_REPAIR' THEN 6
      WHEN 'BLOOM_GAP_REPAIR' THEN 7
      WHEN 'TRAP_GAP_REPAIR' THEN 8
      ELSE 9
    END,
    v.score DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_publish_readiness_gate(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_publish_readiness_gate(text, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_publish_readiness_gate(text, int) IS
  'Lese-Wrapper über v_publish_readiness_gate. has_role-Gate. p_class filtert auf eine Gate-Klasse, NULL = alle.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'publish_readiness_gate_view_created',
  'system',
  NULL,
  'success',
  jsonb_build_object(
    'migration', 'v_publish_readiness_gate_v1',
    'classes', ARRAY['READY','BRONZE_REVIEW_REQUIRED','STALE_INTEGRITY','POOL_GAP_REPAIR','BLOOM_GAP_REPAIR','TRAP_GAP_REPAIR','COUNCIL_PENDING','AUTO_PUBLISH_PENDING','NEEDS_INTEGRITY_FIRST'],
    'score_thresholds', jsonb_build_object('ready', 85, 'bronze', 75),
    'rule', 'Coverage is NOT a readiness signal. integrity_report.v3.summary.hard_fail_reasons is SSOT.'
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Smoke-Test (post-deploy verification)
-- Erwartung: Verteilung über Klassen, kein Fehler.
-- SELECT gate_class, COUNT(*) FROM public.admin_get_publish_readiness_gate(NULL, 1000) GROUP BY 1 ORDER BY 2 DESC;
-- ─────────────────────────────────────────────────────────────────────────────
