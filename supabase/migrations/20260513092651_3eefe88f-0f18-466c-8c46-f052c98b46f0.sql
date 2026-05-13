
-- ═══════════════════════════════════════════════════════════════════
-- 1. SSOT RPC: fn_record_exam_pool_validation_snapshot
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_record_exam_pool_validation_snapshot(
  p_package_id    uuid,
  p_curriculum_id uuid,
  p_job_id        uuid,
  p_gate_class    text,
  p_reason_code   text,
  p_metrics       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_id uuid;
  v_total_lfs   int := COALESCE((p_metrics->>'total_lfs')::int, 0);
  v_covered_lfs int := COALESCE((p_metrics->>'covered_lfs')::int, 0);
  v_total_comp  int := COALESCE((p_metrics->>'total_competencies')::int, 0);
  v_covered_comp int := COALESCE((p_metrics->>'covered_competencies')::int, 0);
  v_repair_24h  int := COALESCE((p_metrics->>'repair_attempts_24h')::int, 0);
  v_guard_state text;
BEGIN
  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'fn_record_exam_pool_validation_snapshot: p_package_id is required';
  END IF;

  -- Map gate_class → guard_state default (overridden later by classify_validate_guard if needed)
  v_guard_state := CASE
    WHEN p_gate_class = 'PASS' THEN 'healthy'
    WHEN p_gate_class = 'WAITING_FOR_MATERIALIZATION' THEN 'recovering'
    WHEN p_gate_class = 'REPAIRABLE' THEN 'soft_stalled'
    WHEN p_gate_class = 'HARD_FAIL' THEN 'hard_stalled'
    WHEN p_gate_class IN ('ERROR','NO_QUESTIONS','T1_FAIL') THEN 'recovering'
    ELSE 'healthy'
  END;

  INSERT INTO public.exam_pool_validation_snapshots (
    package_id, curriculum_id, job_id,
    approved_count, review_count, draft_count, rejected_count,
    unresolved_quality_flags,
    missing_lf_coverage, missing_competency_coverage,
    missing_trap_metadata, missing_bloom_metadata,
    repairable_issue_count,
    guard_state, reason_code, gate_class, repair_attempts_24h
  ) VALUES (
    p_package_id, p_curriculum_id, p_job_id,
    COALESCE((p_metrics->>'approved_count')::int, 0),
    COALESCE((p_metrics->>'review_count')::int, 0),
    COALESCE((p_metrics->>'draft_count')::int, 0),
    COALESCE((p_metrics->>'rejected_count')::int, 0),
    COALESCE((p_metrics->>'unresolved_quality_flags')::int, 0),
    GREATEST(v_total_lfs - v_covered_lfs, 0),
    GREATEST(v_total_comp - v_covered_comp, 0),
    COALESCE((p_metrics->>'missing_trap_metadata')::int, 0),
    COALESCE((p_metrics->>'missing_bloom_metadata')::int, 0),
    COALESCE((p_metrics->>'repairable_issue_count')::int, 0),
    v_guard_state, p_reason_code, p_gate_class, v_repair_24h
  )
  RETURNING id INTO v_snapshot_id;

  -- Audit (best-effort)
  BEGIN
    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, metadata
    ) VALUES (
      'exam_pool_snapshot_recorded', 'package', p_package_id, 'success',
      jsonb_build_object(
        'snapshot_id', v_snapshot_id,
        'gate_class', p_gate_class,
        'reason_code', p_reason_code,
        'job_id', p_job_id,
        'guard_state', v_guard_state
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_snapshot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_exam_pool_validation_snapshot(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_exam_pool_validation_snapshot(uuid,uuid,uuid,text,text,jsonb) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 2. GRANT lookup für Heal-Class (View-Read)
-- ═══════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.fn_validate_exam_pool_heal_class(
  uuid, integer, text, integer, integer, timestamp with time zone, integer
) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 3. Backfill: 1 Recovery-Snapshot pro Paket mit validate_exam_pool-Aktivität
--    in 24h ohne Snapshot
-- ═══════════════════════════════════════════════════════════════════
DO $backfill$
DECLARE
  r record;
  v_curriculum_id uuid;
  v_gate jsonb;
  v_metrics jsonb;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT jq.package_id
    FROM public.job_queue jq
    WHERE jq.job_type = 'package_validate_exam_pool'
      AND jq.updated_at > now() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1 FROM public.exam_pool_validation_snapshots s
        WHERE s.package_id = jq.package_id
          AND s.created_at > now() - interval '24 hours'
      )
  LOOP
    BEGIN
      SELECT COALESCE(cp.curriculum_id,
               (SELECT cu.id FROM public.curricula cu
                  WHERE cu.certification_id = cp.certification_id LIMIT 1))
      INTO v_curriculum_id
      FROM public.course_packages cp
      WHERE cp.id = r.package_id;

      v_gate := public.fn_classify_exam_pool_gate(r.package_id);
      v_metrics := COALESCE(v_gate->'metrics', '{}'::jsonb);

      PERFORM public.fn_record_exam_pool_validation_snapshot(
        r.package_id,
        v_curriculum_id,
        NULL,
        v_gate->>'gate_status',
        COALESCE((v_gate->'reason_codes'->>0), 'BACKFILL_RECOVERY'),
        v_metrics
      );

      -- Tag as backfill
      INSERT INTO public.auto_heal_log (
        action_type, target_type, target_id, result_status, metadata
      ) VALUES (
        'exam_pool_snapshot_backfill', 'package', r.package_id, 'success',
        jsonb_build_object('source', 'bucket_e_migration', 'gate_status', v_gate->>'gate_status')
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log (
        action_type, target_type, target_id, result_status, metadata
      ) VALUES (
        'exam_pool_snapshot_backfill', 'package', r.package_id, 'error',
        jsonb_build_object('error', SQLERRM)
      );
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log (
    action_type, target_type, result_status, metadata
  ) VALUES (
    'exam_pool_snapshot_backfill_summary', 'system', 'success',
    jsonb_build_object('backfilled_count', v_count, 'window', '24h')
  );
END;
$backfill$;

-- ═══════════════════════════════════════════════════════════════════
-- 4. Drift View + Admin RPC + Alert Function
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.v_gate_snapshot_drift AS
WITH validate_runs AS (
  SELECT
    jq.package_id,
    jq.id AS job_id,
    jq.status,
    jq.updated_at AS run_at,
    jq.last_error_code
  FROM public.job_queue jq
  WHERE jq.job_type = 'package_validate_exam_pool'
    AND jq.updated_at > now() - interval '6 hours'
    AND jq.status IN ('completed','failed','cancelled')
)
SELECT
  vr.package_id,
  vr.job_id,
  vr.status AS job_status,
  vr.last_error_code,
  vr.run_at,
  (SELECT max(s.created_at) FROM public.exam_pool_validation_snapshots s
     WHERE s.package_id = vr.package_id
       AND s.created_at BETWEEN vr.run_at - interval '5 minutes' AND vr.run_at + interval '5 minutes'
  ) AS matched_snapshot_at,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.exam_pool_validation_snapshots s
      WHERE s.package_id = vr.package_id
        AND s.created_at BETWEEN vr.run_at - interval '5 minutes' AND vr.run_at + interval '5 minutes'
    ) THEN 'PRESENT'
    ELSE 'SNAPSHOT_DRIFT'
  END AS verdict
FROM validate_runs vr;

REVOKE ALL ON public.v_gate_snapshot_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_gate_snapshot_drift TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_gate_snapshot_drift(
  p_window_minutes int DEFAULT 360
)
RETURNS TABLE (
  package_id uuid,
  job_id uuid,
  job_status text,
  last_error_code text,
  run_at timestamptz,
  matched_snapshot_at timestamptz,
  verdict text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'admin_get_gate_snapshot_drift: admin or service_role required';
  END IF;

  RETURN QUERY
  SELECT d.package_id, d.job_id, d.job_status, d.last_error_code,
         d.run_at, d.matched_snapshot_at, d.verdict
  FROM public.v_gate_snapshot_drift d
  WHERE d.run_at > now() - make_interval(mins => p_window_minutes)
  ORDER BY d.run_at DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_gate_snapshot_drift(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_gate_snapshot_drift(int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_check_gate_snapshot_drift_and_alert(
  p_window_minutes int DEFAULT 60,
  p_threshold int DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_drift_count int := 0;
  v_alert_key text;
BEGIN
  SELECT count(*) INTO v_drift_count
  FROM public.v_gate_snapshot_drift d
  WHERE d.run_at > now() - make_interval(mins => p_window_minutes)
    AND d.verdict = 'SNAPSHOT_DRIFT';

  -- Always audit (even noop)
  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES (
    'gate_snapshot_drift_check', 'system',
    CASE WHEN v_drift_count >= p_threshold THEN 'alert' ELSE 'success' END,
    jsonb_build_object('drift_count', v_drift_count, 'window_minutes', p_window_minutes, 'threshold', p_threshold)
  );

  IF v_drift_count >= p_threshold THEN
    v_alert_key := 'gate_snapshot_drift:' || to_char(now(), 'YYYYMMDDHH24');
    BEGIN
      INSERT INTO public.heal_alert_notifications (alert_key, severity, title, body, metadata)
      VALUES (
        v_alert_key, 'P1',
        'Gate-Snapshot-Drift erkannt',
        format('%s validate_exam_pool runs in last %s min ohne Snapshot.', v_drift_count, p_window_minutes),
        jsonb_build_object('drift_count', v_drift_count, 'window_minutes', p_window_minutes)
      )
      ON CONFLICT (alert_key) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('drift_count', v_drift_count, 'alert_raised', v_drift_count >= p_threshold);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_gate_snapshot_drift_and_alert(int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_check_gate_snapshot_drift_and_alert(int,int) TO service_role;
