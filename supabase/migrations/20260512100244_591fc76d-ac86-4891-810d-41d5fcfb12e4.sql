-- ============================================================================
-- Migration 2/2 (retry): admin_reconcile_stale_integrity_only + Deprecate v1
-- ============================================================================

-- DROP alte v1 (TABLE return type ≠ jsonb wrapper)
DROP FUNCTION IF EXISTS public.admin_reconcile_coverage_met_integrity_false(int, boolean, int);

-- ── Neue RPC: STALE_INTEGRITY only ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reconcile_stale_integrity_only(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_min_age_hours numeric DEFAULT 6.0,
  p_wip_cap int DEFAULT 35
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_eligible_total int := 0;
  v_active_integrity_total int := 0;
  v_to_enqueue int := 0;
  v_enqueued int := 0;
  v_skipped int := 0;
  v_wip_cap_blocked boolean := false;
  v_results jsonb := '[]'::jsonb;
  r record;
  v_job_id uuid;
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT COUNT(*) INTO v_active_integrity_total
  FROM job_queue
  WHERE job_type = 'package_run_integrity_check'
    AND status IN ('pending','processing');

  IF v_active_integrity_total >= p_wip_cap THEN
    v_wip_cap_blocked := true;
  END IF;

  WITH eligible AS (
    SELECT v.package_id, v.title, v.score, v.hours_since_integrity, v.last_integrity_run_at
    FROM v_publish_readiness_gate v
    WHERE v.gate_class = 'STALE_INTEGRITY'
      AND v.hours_since_integrity >= p_min_age_hours
    ORDER BY v.hours_since_integrity DESC
    LIMIT p_limit
  )
  SELECT jsonb_agg(jsonb_build_object(
    'package_id', package_id,
    'title', title,
    'score', score,
    'hours_since_integrity', round(hours_since_integrity, 2),
    'last_integrity_run_at', last_integrity_run_at
  )), COUNT(*)
  INTO v_results, v_eligible_total
  FROM eligible;

  v_to_enqueue := COALESCE(v_eligible_total, 0);

  IF p_dry_run OR v_wip_cap_blocked THEN
    INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
    VALUES (
      'stale_integrity_reconcile_dry_run',
      'system',
      CASE WHEN v_wip_cap_blocked THEN 'skipped' ELSE 'success' END,
      jsonb_build_object(
        'caller', v_caller, 'p_limit', p_limit, 'p_min_age_hours', p_min_age_hours,
        'p_wip_cap', p_wip_cap, 'eligible_count', v_to_enqueue,
        'active_integrity_total', v_active_integrity_total,
        'wip_cap_blocked', v_wip_cap_blocked,
        'eligible', COALESCE(v_results, '[]'::jsonb)
      )
    );

    RETURN jsonb_build_object(
      'mode', CASE WHEN p_dry_run THEN 'dry_run' ELSE 'wip_cap_blocked' END,
      'eligible_count', v_to_enqueue,
      'active_integrity_total', v_active_integrity_total,
      'wip_cap', p_wip_cap,
      'wip_cap_blocked', v_wip_cap_blocked,
      'eligible', COALESCE(v_results, '[]'::jsonb)
    );
  END IF;

  FOR r IN
    SELECT v.package_id, v.title
    FROM v_publish_readiness_gate v
    WHERE v.gate_class = 'STALE_INTEGRITY'
      AND v.hours_since_integrity >= p_min_age_hours
    ORDER BY v.hours_since_integrity DESC
    LIMIT p_limit
  LOOP
    BEGIN
      INSERT INTO public.job_queue (
        job_type, job_name, package_id, status, priority, payload, created_at, updated_at
      )
      VALUES (
        'package_run_integrity_check',
        'package_run_integrity_check',
        r.package_id,
        'pending',
        50,
        jsonb_build_object(
          'package_id', r.package_id,
          'enqueue_source', 'stale_integrity_reconcile',
          'bronze_lock_override', true,
          'reason', 'stale_integrity_ssot_v2',
          'caller', v_caller,
          'enqueued_at', now()
        ),
        now(), now()
      )
      RETURNING id INTO v_job_id;

      v_enqueued := v_enqueued + 1;

      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES (
        'stale_integrity_reconcile_enqueued',
        'package', r.package_id, 'success',
        jsonb_build_object('job_id', v_job_id, 'title', r.title, 'caller', v_caller)
      );
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
      VALUES (
        'stale_integrity_reconcile_skipped',
        'package', r.package_id, 'skipped',
        jsonb_build_object('error', SQLERRM, 'title', r.title)
      );
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'stale_integrity_reconcile_summary',
    'system', 'success',
    jsonb_build_object(
      'caller', v_caller, 'p_limit', p_limit, 'p_min_age_hours', p_min_age_hours,
      'eligible_count', v_to_enqueue, 'enqueued', v_enqueued, 'skipped', v_skipped
    )
  );

  RETURN jsonb_build_object(
    'mode', 'live',
    'eligible_count', v_to_enqueue,
    'enqueued', v_enqueued,
    'skipped', v_skipped,
    'active_integrity_total_before', v_active_integrity_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_stale_integrity_only(int, boolean, numeric, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_stale_integrity_only(int, boolean, numeric, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_reconcile_stale_integrity_only(int, boolean, numeric, int) IS
  'STALE_INTEGRITY Reconciler v2. Eligibility ausschließlich via v_publish_readiness_gate.gate_class=STALE_INTEGRITY (SSOT). Coverage ist KEIN Signal. p_min_age_hours default 6h.';

-- ── Deprecate v1: redirect to safe SSOT-RPC ────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reconcile_coverage_met_integrity_false(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_wip_cap int DEFAULT 35
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'coverage_only_reconcile_deprecated_call',
    'system', 'success',
    jsonb_build_object(
      'caller', auth.uid(),
      'redirected_to', 'admin_reconcile_stale_integrity_only',
      'reason', 'coverage_is_not_publish_readiness_signal',
      'rule', 'see v_publish_readiness_gate gate_class=STALE_INTEGRITY'
    )
  );

  v_result := public.admin_reconcile_stale_integrity_only(
    p_limit := p_limit,
    p_dry_run := p_dry_run,
    p_min_age_hours := 6.0,
    p_wip_cap := p_wip_cap
  );

  RETURN jsonb_set(
    v_result,
    '{deprecation_notice}',
    to_jsonb('admin_reconcile_coverage_met_integrity_false is DEPRECATED. Use admin_reconcile_stale_integrity_only directly.'::text)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_coverage_met_integrity_false(int, boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_coverage_met_integrity_false(int, boolean, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_reconcile_coverage_met_integrity_false(int, boolean, int) IS
  'DEPRECATED 2026-05-12. Coverage is NOT a publish-readiness signal. Auto-redirects to admin_reconcile_stale_integrity_only (gate_class=STALE_INTEGRITY only).';

-- ── Audit ──────────────────────────────────────────────────────────────────
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'stale_integrity_reconciler_v2_deployed',
  'system', 'success',
  jsonb_build_object(
    'migration', 'admin_reconcile_stale_integrity_only_v1',
    'deprecated', 'admin_reconcile_coverage_met_integrity_false',
    'ssot', 'v_publish_readiness_gate.gate_class',
    'min_age_hours_default', 6.0,
    'wip_cap_default', 35,
    'lesson_learned_batch_1', '50% Coverage-only-selection were POOL_GAP_REPAIR (TOO_FEW_APPROVED), not STALE_INTEGRITY'
  )
);
