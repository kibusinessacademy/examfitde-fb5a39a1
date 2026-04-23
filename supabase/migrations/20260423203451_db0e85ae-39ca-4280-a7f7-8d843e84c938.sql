-- ============================================================
-- HEAL HARDENING PHASE 1
-- Snapshots, verification reports, hardened RPCs
-- ============================================================

-- ── 1. SNAPSHOTS TABLE ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.heal_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  created_by TEXT,
  reason TEXT NOT NULL,
  steps_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  jobs_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  package_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by TEXT,
  rollback_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heal_snapshots_package_id 
  ON public.heal_snapshots (package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heal_snapshots_rollback 
  ON public.heal_snapshots (rolled_back_at) WHERE rolled_back_at IS NULL;

ALTER TABLE public.heal_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage heal snapshots" ON public.heal_snapshots;
CREATE POLICY "Admins manage heal snapshots"
ON public.heal_snapshots
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ── 2. VERIFICATION REPORTS TABLE ────────────────────────────
CREATE TABLE IF NOT EXISTS public.heal_verification_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  snapshot_id UUID REFERENCES public.heal_snapshots(id) ON DELETE SET NULL,
  heal_mode TEXT NOT NULL,
  reason TEXT NOT NULL,
  package_status_before TEXT,
  package_status_after TEXT,
  blocked_reason_before TEXT,
  blocked_reason_after TEXT,
  steps_reset JSONB NOT NULL DEFAULT '[]'::jsonb,
  jobs_cancelled INTEGER NOT NULL DEFAULT 0,
  recovery_jobs_planned INTEGER NOT NULL DEFAULT 0,
  recovery_job_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  verify_passed BOOLEAN NOT NULL DEFAULT true,
  verify_findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heal_verification_reports_package
  ON public.heal_verification_reports (package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heal_verification_reports_failed
  ON public.heal_verification_reports (verify_passed, created_at DESC)
  WHERE verify_passed = false;

ALTER TABLE public.heal_verification_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read heal verification reports" ON public.heal_verification_reports;
CREATE POLICY "Admins read heal verification reports"
ON public.heal_verification_reports
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins write heal verification reports" ON public.heal_verification_reports;
CREATE POLICY "Admins write heal verification reports"
ON public.heal_verification_reports
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- ── 3. CONFLICT CHECK RPC ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_check_heal_conflicts(
  p_package_id UUID,
  p_planned_job_types TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_jobs JSONB;
  v_active_count INTEGER;
  v_conflicts JSONB;
  v_recommendation TEXT;
BEGIN
  -- Active jobs für Paket (pending/processing)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'job_id', id,
    'job_type', job_type,
    'status', status,
    'attempts', attempts,
    'created_at', created_at,
    'locked_at', locked_at
  ) ORDER BY created_at DESC), '[]'::jsonb), COUNT(*)
  INTO v_active_jobs, v_active_count
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND status IN ('pending','processing');

  -- Konflikte: aktive Jobs vom selben Typ wie geplante Jobs
  IF p_planned_job_types IS NOT NULL AND array_length(p_planned_job_types, 1) > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'job_id', id,
      'job_type', job_type,
      'status', status,
      'reason', 'duplicate_planned_job_type'
    )), '[]'::jsonb)
    INTO v_conflicts
    FROM public.job_queue
    WHERE package_id = p_package_id
      AND status IN ('pending','processing')
      AND job_type = ANY(p_planned_job_types);
  ELSE
    v_conflicts := '[]'::jsonb;
  END IF;

  v_recommendation := CASE
    WHEN jsonb_array_length(v_conflicts) > 0 THEN 'cancel_conflicts_first'
    WHEN v_active_count > 0 THEN 'cancel_active_jobs_recommended'
    ELSE 'proceed'
  END;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'active_job_count', v_active_count,
    'active_jobs', v_active_jobs,
    'conflict_count', jsonb_array_length(v_conflicts),
    'conflicts', v_conflicts,
    'recommendation', v_recommendation,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_check_heal_conflicts(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_check_heal_conflicts(UUID, TEXT[]) TO authenticated;

-- ── 4. DETAILED STEP RESET RPC ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_step_reset_detailed(
  p_package_id UUID,
  p_step_keys TEXT[],
  p_reason TEXT,
  p_operator TEXT DEFAULT NULL,
  p_allow_regression BOOLEAN DEFAULT true,
  p_clear_exhaustion BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results JSONB := '[]'::jsonb;
  v_step RECORD;
  v_op TEXT := COALESCE(p_operator, 'admin_manual');
  v_now TIMESTAMPTZ := now();
  v_meta_before JSONB;
  v_meta_after JSONB;
BEGIN
  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'admin_step_reset_detailed: p_package_id is required';
  END IF;
  IF p_step_keys IS NULL OR array_length(p_step_keys, 1) IS NULL THEN
    RAISE EXCEPTION 'admin_step_reset_detailed: p_step_keys must be non-empty';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'admin_step_reset_detailed: p_reason is required';
  END IF;

  FOR v_step IN
    SELECT id, step_key, status, meta
    FROM public.package_steps
    WHERE package_id = p_package_id
      AND step_key = ANY(p_step_keys)
    ORDER BY step_key
  LOOP
    v_meta_before := COALESCE(v_step.meta, '{}'::jsonb);
    v_meta_after := v_meta_before;

    IF p_clear_exhaustion THEN
      v_meta_after := v_meta_after - 'exhausted' - 'repair_exhausted' - 'hard_fail_count';
    END IF;

    v_meta_after := v_meta_after || jsonb_build_object(
      'allow_regression', p_allow_regression,
      'allow_regression_by', v_op,
      'allow_regression_at', v_now,
      'admin_bypass_reset_at', v_now,
      'admin_bypass_reason', p_reason
    );

    UPDATE public.package_steps
    SET status = 'queued'::step_status,
        meta = v_meta_after,
        last_error = NULL,
        started_at = NULL,
        finished_at = NULL,
        last_heartbeat_at = NULL,
        runner_id = NULL,
        attempts = 0,
        updated_at = v_now
    WHERE id = v_step.id;

    v_results := v_results || jsonb_build_object(
      'step_key', v_step.step_key,
      'previous_status', v_step.status,
      'meta_diff', jsonb_build_object(
        'cleared_exhaustion', p_clear_exhaustion,
        'allow_regression_set', p_allow_regression
      ),
      'reset_at', v_now
    );
  END LOOP;

  -- Audit
  INSERT INTO public.system_heal_log (heal_type, package_id, step_key, details)
  VALUES (
    'manual_step_reset_detailed',
    p_package_id,
    NULL,
    jsonb_build_object(
      'operator', v_op,
      'reason', p_reason,
      'step_keys', p_step_keys,
      'results', v_results
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'reset_count', jsonb_array_length(v_results),
    'results', v_results,
    'operator', v_op,
    'reset_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_step_reset_detailed(UUID, TEXT[], TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_step_reset_detailed(UUID, TEXT[], TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- ── 5. MANUAL HEAL v2 (Snapshot + Verify-Gate) ───────────────
CREATE OR REPLACE FUNCTION public.admin_manual_heal_package_v2(
  p_package_id UUID,
  p_reset_step_keys TEXT[],
  p_reason TEXT,
  p_cancel_active_jobs BOOLEAN DEFAULT true,
  p_planned_job_types TEXT[] DEFAULT NULL,
  p_operator TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_op TEXT := COALESCE(p_operator, 'admin_manual');
  v_snapshot_id UUID;
  v_pkg RECORD;
  v_steps_snap JSONB;
  v_jobs_snap JSONB;
  v_pkg_snap JSONB;
  v_status_before TEXT;
  v_blocked_before TEXT;
  v_status_after TEXT;
  v_blocked_after TEXT;
  v_conflicts JSONB;
  v_jobs_cancelled INTEGER := 0;
  v_reset_result JSONB;
  v_verify_findings JSONB := '[]'::jsonb;
  v_verify_passed BOOLEAN := true;
  v_report_id UUID;
  v_duration_ms INTEGER;
BEGIN
  -- 1. Lock & load
  SELECT * INTO v_pkg
  FROM public.course_packages
  WHERE id = p_package_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_manual_heal_package_v2: package % not found', p_package_id;
  END IF;

  v_status_before := v_pkg.status;
  v_blocked_before := v_pkg.blocked_reason;

  -- 2. Conflict check
  v_conflicts := public.admin_check_heal_conflicts(p_package_id, p_planned_job_types);

  -- 3. Snapshot
  SELECT COALESCE(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb)
  INTO v_steps_snap
  FROM public.package_steps s
  WHERE s.package_id = p_package_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'job_type', job_type, 'status', status,
    'payload', payload, 'attempts', attempts, 'created_at', created_at
  )), '[]'::jsonb)
  INTO v_jobs_snap
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND status IN ('pending','processing');

  v_pkg_snap := jsonb_build_object(
    'status', v_pkg.status,
    'blocked_reason', v_pkg.blocked_reason,
    'blocked_by', v_pkg.blocked_by,
    'blocked_at', v_pkg.blocked_at,
    'last_error', v_pkg.last_error
  );

  INSERT INTO public.heal_snapshots
    (package_id, created_by, reason, steps_snapshot, jobs_snapshot, package_snapshot)
  VALUES
    (p_package_id, v_op, p_reason, v_steps_snap, v_jobs_snap, v_pkg_snap)
  RETURNING id INTO v_snapshot_id;

  -- 4. Cancel active jobs if requested
  IF p_cancel_active_jobs THEN
    WITH cancelled AS (
      UPDATE public.job_queue
      SET status = 'cancelled',
          last_error = 'cancelled by admin_manual_heal_package_v2: ' || p_reason,
          completed_at = now(),
          updated_at = now()
      WHERE package_id = p_package_id
        AND status IN ('pending','processing')
      RETURNING id
    )
    SELECT COUNT(*) INTO v_jobs_cancelled FROM cancelled;
  END IF;

  -- 5. Detailed step reset
  v_reset_result := public.admin_step_reset_detailed(
    p_package_id,
    p_reset_step_keys,
    p_reason,
    v_op,
    true,  -- allow_regression
    true   -- clear_exhaustion
  );

  -- 6. Clear blocked_reason and force status=building
  UPDATE public.course_packages
  SET status = 'building',
      blocked_reason = NULL,
      blocked_by = NULL,
      blocked_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE id = p_package_id;

  -- 7. VERIFY GATE
  SELECT status, blocked_reason
  INTO v_status_after, v_blocked_after
  FROM public.course_packages
  WHERE id = p_package_id;

  IF v_status_after <> 'building' THEN
    v_verify_passed := false;
    v_verify_findings := v_verify_findings || jsonb_build_object(
      'check', 'package_status',
      'expected', 'building',
      'actual', v_status_after
    );
  END IF;

  IF v_blocked_after IS NOT NULL THEN
    v_verify_passed := false;
    v_verify_findings := v_verify_findings || jsonb_build_object(
      'check', 'blocked_reason_cleared',
      'expected', NULL,
      'actual', v_blocked_after
    );
  END IF;

  -- Verify steps were reset
  PERFORM 1 FROM public.package_steps
  WHERE package_id = p_package_id
    AND step_key = ANY(p_reset_step_keys)
    AND status NOT IN ('queued','enqueued');
  IF FOUND THEN
    v_verify_passed := false;
    v_verify_findings := v_verify_findings || jsonb_build_object(
      'check', 'all_target_steps_reset',
      'expected', 'queued',
      'actual', 'one_or_more_steps_not_queued'
    );
  END IF;

  v_duration_ms := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_started_at))::INTEGER;

  -- 8. Persist report
  INSERT INTO public.heal_verification_reports (
    package_id, snapshot_id, heal_mode, reason,
    package_status_before, package_status_after,
    blocked_reason_before, blocked_reason_after,
    steps_reset, jobs_cancelled, recovery_jobs_planned, recovery_job_types,
    conflicts, verify_passed, verify_findings,
    created_by, duration_ms
  ) VALUES (
    p_package_id, v_snapshot_id, 'hard_bypass_v2', p_reason,
    v_status_before, v_status_after,
    v_blocked_before, v_blocked_after,
    v_reset_result->'results', v_jobs_cancelled,
    COALESCE(array_length(p_planned_job_types, 1), 0),
    COALESCE(to_jsonb(p_planned_job_types), '[]'::jsonb),
    v_conflicts, v_verify_passed, v_verify_findings,
    v_op, v_duration_ms
  ) RETURNING id INTO v_report_id;

  -- 9. Audit log
  INSERT INTO public.system_heal_log (heal_type, package_id, details)
  VALUES (
    CASE WHEN v_verify_passed THEN 'manual_bypass_v2_ok' ELSE 'manual_bypass_v2_verify_failed' END,
    p_package_id,
    jsonb_build_object(
      'operator', v_op,
      'reason', p_reason,
      'snapshot_id', v_snapshot_id,
      'report_id', v_report_id,
      'verify_passed', v_verify_passed,
      'verify_findings', v_verify_findings,
      'jobs_cancelled', v_jobs_cancelled,
      'duration_ms', v_duration_ms
    )
  );

  -- 10. If verify failed → raise (Postgres will rollback the transaction)
  IF NOT v_verify_passed THEN
    RAISE EXCEPTION 'HEAL_VERIFY_FAILED: %', v_verify_findings::text
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'snapshot_id', v_snapshot_id,
    'report_id', v_report_id,
    'jobs_cancelled', v_jobs_cancelled,
    'steps_reset', v_reset_result,
    'conflicts', v_conflicts,
    'verify_passed', v_verify_passed,
    'duration_ms', v_duration_ms,
    'package_status_after', v_status_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_manual_heal_package_v2(UUID, TEXT[], TEXT, BOOLEAN, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_manual_heal_package_v2(UUID, TEXT[], TEXT, BOOLEAN, TEXT[], TEXT) TO authenticated;

-- ── 6. ROLLBACK RPC ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_rollback_heal(
  p_snapshot_id UUID,
  p_operator TEXT DEFAULT NULL,
  p_restore_jobs BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap RECORD;
  v_op TEXT := COALESCE(p_operator, 'admin_manual');
  v_step JSONB;
  v_steps_restored INTEGER := 0;
  v_pkg_snap JSONB;
  v_result JSONB;
BEGIN
  SELECT * INTO v_snap FROM public.heal_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_rollback_heal: snapshot % not found', p_snapshot_id;
  END IF;
  IF v_snap.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'admin_rollback_heal: snapshot % already rolled back at %',
      p_snapshot_id, v_snap.rolled_back_at;
  END IF;

  -- Restore steps
  FOR v_step IN SELECT * FROM jsonb_array_elements(v_snap.steps_snapshot)
  LOOP
    UPDATE public.package_steps
    SET status = (v_step->>'status')::step_status,
        meta = COALESCE(v_step->'meta', '{}'::jsonb),
        last_error = v_step->>'last_error',
        attempts = COALESCE((v_step->>'attempts')::int, 0),
        updated_at = now()
    WHERE id = (v_step->>'id')::uuid;
    v_steps_restored := v_steps_restored + 1;
  END LOOP;

  -- Restore package status fields
  v_pkg_snap := v_snap.package_snapshot;
  UPDATE public.course_packages
  SET status = COALESCE(v_pkg_snap->>'status', status),
      blocked_reason = v_pkg_snap->>'blocked_reason',
      blocked_by = v_pkg_snap->>'blocked_by',
      blocked_at = NULLIF(v_pkg_snap->>'blocked_at','')::timestamptz,
      last_error = v_pkg_snap->>'last_error',
      updated_at = now()
  WHERE id = v_snap.package_id;

  v_result := jsonb_build_object(
    'snapshot_id', p_snapshot_id,
    'package_id', v_snap.package_id,
    'steps_restored', v_steps_restored,
    'jobs_restored', false,
    'restored_at', now(),
    'restored_by', v_op
  );

  -- Note: jobs_restored=false because re-creating cancelled jobs cleanly
  -- requires the original lane/priority/run_after — handled via re-enqueue
  -- in the service layer if needed.

  UPDATE public.heal_snapshots
  SET rolled_back_at = now(),
      rolled_back_by = v_op,
      rollback_result = v_result
  WHERE id = p_snapshot_id;

  INSERT INTO public.system_heal_log (heal_type, package_id, details)
  VALUES ('manual_heal_rollback', v_snap.package_id,
    jsonb_build_object('snapshot_id', p_snapshot_id, 'operator', v_op, 'result', v_result));

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_rollback_heal(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_rollback_heal(UUID, TEXT, BOOLEAN) TO authenticated;

-- ── 7. AUTO-REPAIR LIMIT GUARD ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_auto_repair_limit_status(
  p_package_id UUID DEFAULT NULL,
  p_warn_threshold_pct INTEGER DEFAULT 70,
  p_critical_threshold_pct INTEGER DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_attempts_default INTEGER := 5;
  v_result JSONB;
BEGIN
  WITH steps AS (
    SELECT
      ps.package_id,
      cp.title AS package_title,
      ps.step_key,
      ps.status,
      ps.attempts,
      COALESCE(NULLIF(ps.max_attempts,0), v_max_attempts_default) AS max_attempts,
      COALESCE((ps.meta->>'hard_fail_count')::int, 0) AS hard_fail_count,
      COALESCE((ps.meta->>'exhausted')::boolean, false) AS exhausted,
      COALESCE((ps.meta->>'repair_exhausted')::boolean, false) AS repair_exhausted
    FROM public.package_steps ps
    JOIN public.course_packages cp ON cp.id = ps.package_id
    WHERE (p_package_id IS NULL OR ps.package_id = p_package_id)
  ),
  scored AS (
    SELECT
      *,
      CASE WHEN max_attempts > 0 THEN ROUND(100.0 * attempts / max_attempts) ELSE 0 END AS attempts_pct,
      CASE
        WHEN exhausted OR repair_exhausted THEN 'exhausted'
        WHEN max_attempts > 0 AND attempts::numeric / max_attempts >= p_critical_threshold_pct/100.0 THEN 'critical'
        WHEN max_attempts > 0 AND attempts::numeric / max_attempts >= p_warn_threshold_pct/100.0 THEN 'warn'
        ELSE 'ok'
      END AS severity
    FROM steps
  )
  SELECT jsonb_build_object(
    'thresholds', jsonb_build_object('warn_pct', p_warn_threshold_pct, 'critical_pct', p_critical_threshold_pct),
    'summary', jsonb_build_object(
      'total_steps', COUNT(*),
      'exhausted', COUNT(*) FILTER (WHERE severity='exhausted'),
      'critical', COUNT(*) FILTER (WHERE severity='critical'),
      'warn', COUNT(*) FILTER (WHERE severity='warn'),
      'ok', COUNT(*) FILTER (WHERE severity='ok')
    ),
    'steps_at_risk', COALESCE(jsonb_agg(jsonb_build_object(
      'package_id', package_id,
      'package_title', package_title,
      'step_key', step_key,
      'status', status,
      'attempts', attempts,
      'max_attempts', max_attempts,
      'attempts_pct', attempts_pct,
      'hard_fail_count', hard_fail_count,
      'severity', severity
    ) ORDER BY 
      CASE severity WHEN 'exhausted' THEN 0 WHEN 'critical' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END,
      attempts_pct DESC
    ) FILTER (WHERE severity <> 'ok'), '[]'::jsonb),
    'checked_at', now()
  )
  INTO v_result
  FROM scored;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_auto_repair_limit_status(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_auto_repair_limit_status(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 8. ROOT CAUSE ANALYSIS ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.analyze_package_root_cause(
  p_package_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_triggers JSONB := '[]'::jsonb;
  v_recommended JSONB;
  v_missing_blueprints INTEGER := 0;
  v_missing_questions INTEGER := 0;
  v_exhausted_steps INTEGER := 0;
  v_hard_fail_steps INTEGER := 0;
  v_queued_no_job INTEGER := 0;
  v_stale_locks INTEGER := 0;
  v_active_jobs INTEGER := 0;
  v_top_step TEXT;
  v_recommended_mode TEXT := 'soft';
  v_recommended_step TEXT := 'run_integrity_check';
  v_recommended_enqueue JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO v_pkg FROM public.course_packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analyze_package_root_cause: package % not found', p_package_id;
  END IF;

  -- Signal 1: missing blueprints (only if table exists with relevant cols)
  BEGIN
    EXECUTE format($q$
      SELECT COUNT(*)
      FROM public.competencies c
      JOIN public.learning_fields lf ON lf.id = c.learning_field_id
      WHERE lf.curriculum_id = %L
        AND NOT EXISTS (
          SELECT 1 FROM public.blueprint_questions bq
          WHERE bq.competency_id = c.id
        )
    $q$, v_pkg.curriculum_id) INTO v_missing_blueprints;
  EXCEPTION WHEN OTHERS THEN
    v_missing_blueprints := 0;
  END;

  -- Signal 2: missing exam questions per competency
  BEGIN
    EXECUTE format($q$
      SELECT COUNT(*)
      FROM public.competencies c
      JOIN public.learning_fields lf ON lf.id = c.learning_field_id
      WHERE lf.curriculum_id = %L
        AND NOT EXISTS (
          SELECT 1 FROM public.exam_questions eq
          WHERE eq.competency_id = c.id AND eq.package_id = %L
        )
    $q$, v_pkg.curriculum_id, p_package_id) INTO v_missing_questions;
  EXCEPTION WHEN OTHERS THEN
    v_missing_questions := 0;
  END;

  -- Signal 3-5: step health
  SELECT
    COUNT(*) FILTER (WHERE COALESCE((meta->>'exhausted')::boolean, false) OR COALESCE((meta->>'repair_exhausted')::boolean, false)),
    COUNT(*) FILTER (WHERE COALESCE((meta->>'hard_fail_count')::int, 0) >= 3),
    COUNT(*) FILTER (WHERE status = 'queued' AND job_id IS NULL),
    COUNT(*) FILTER (WHERE status = 'running' AND last_heartbeat_at IS NOT NULL AND last_heartbeat_at < now() - interval '10 minutes')
  INTO v_exhausted_steps, v_hard_fail_steps, v_queued_no_job, v_stale_locks
  FROM public.package_steps
  WHERE package_id = p_package_id;

  SELECT COUNT(*) INTO v_active_jobs
  FROM public.job_queue
  WHERE package_id = p_package_id AND status IN ('pending','processing');

  -- Top failing step (heuristic)
  SELECT step_key INTO v_top_step
  FROM public.package_steps
  WHERE package_id = p_package_id
    AND (status IN ('failed','blocked','timeout')
         OR COALESCE((meta->>'exhausted')::boolean,false)
         OR COALESCE((meta->>'hard_fail_count')::int,0) >= 1)
  ORDER BY COALESCE((meta->>'hard_fail_count')::int,0) DESC, attempts DESC
  LIMIT 1;

  -- Build prioritized triggers (score: 0-100)
  IF v_missing_blueprints > 0 THEN
    v_triggers := v_triggers || jsonb_build_object(
      'code', 'MISSING_BLUEPRINTS',
      'severity', 'high',
      'score', LEAST(100, 60 + v_missing_blueprints),
      'count', v_missing_blueprints,
      'description', format('%s Kompetenzen ohne Blueprint-Fragen', v_missing_blueprints),
      'recommended_action', 'enqueue:repair_exam_pool_competency_coverage'
    );
  END IF;

  IF v_missing_questions > 0 THEN
    v_triggers := v_triggers || jsonb_build_object(
      'code', 'MISSING_EXAM_QUESTIONS',
      'severity', 'high',
      'score', LEAST(100, 55 + v_missing_questions),
      'count', v_missing_questions,
      'description', format('%s Kompetenzen ohne Prüfungsfragen', v_missing_questions),
      'recommended_action', 'enqueue:repair_exam_pool_competency_coverage'
    );
  END IF;

  IF v_exhausted_steps > 0 THEN
    v_triggers := v_triggers || jsonb_build_object(
      'code', 'EXHAUSTION_LIMIT',
      'severity', 'critical',
      'score', 95,
      'count', v_exhausted_steps,
      'description', format('%s Schritte mit exhausted/repair_exhausted Flag', v_exhausted_steps),
      'recommended_action', 'manual_bypass:reset_exhaustion'
    );
  END IF;

  IF v_hard_fail_steps > 0 THEN
    v_triggers := v_triggers || jsonb_build_object(
      'code', 'HARD_FAIL_BREAKER',
      'severity', 'critical',
      'score', 90,
      'count', v_hard_fail_steps,
      'description', format('%s Schritte mit hard_fail_count >= 3', v_hard_fail_steps),
      'recommended_action', 'manual_bypass:hard_heal'
    );
  END IF;

  IF v_queued_no_job > 0 THEN
    v_triggers := v_triggers || jsonb_build_object(
      'code', 'QUEUED_WITHOUT_JOB',
      'severity', 'medium',
      'score', 70,
      'count', v_queued_no_job,
      'description', format('%s queued Schritte ohne Job', v_queued_no_job),
      'recommended_action', 'enqueue:retry_stalled_step'
    );
  END IF;

  IF v_stale_locks > 0 THEN
    v_triggers := v_triggers || jsonb_build_object(
      'code', 'STALE_LOCK',
      'severity', 'medium',
      'score', 65,
      'count', v_stale_locks,
      'description', format('%s Schritte mit Heartbeat > 10min', v_stale_locks),
      'recommended_action', 'force_unlock'
    );
  END IF;

  IF v_pkg.blocked_reason IS NOT NULL THEN
    v_triggers := v_triggers || jsonb_build_object(
      'code', 'BLOCKED_REASON_SET',
      'severity', 'high',
      'score', 80,
      'count', 1,
      'description', format('blocked_reason=%s', v_pkg.blocked_reason),
      'recommended_action', 'manual_bypass:clear_block'
    );
  END IF;

  -- Recommendation derivation
  IF v_exhausted_steps > 0 OR v_hard_fail_steps > 0 OR v_pkg.blocked_reason IS NOT NULL THEN
    v_recommended_mode := 'hard';
    v_recommended_step := COALESCE(v_top_step, 'run_integrity_check');
    v_recommended_enqueue := jsonb_build_array(
      jsonb_build_object('action', 'repair_exam_pool_quality')
    );
    IF v_missing_blueprints > 0 OR v_missing_questions > 0 THEN
      v_recommended_enqueue := v_recommended_enqueue || jsonb_build_object(
        'action', 'repair_exam_pool_competency_coverage'
      );
    END IF;
  ELSIF v_queued_no_job > 0 OR v_stale_locks > 0 THEN
    v_recommended_mode := 'soft';
    v_recommended_step := COALESCE(v_top_step, 'run_integrity_check');
  END IF;

  v_recommended := jsonb_build_object(
    'mode', v_recommended_mode,
    'reset_from_step', v_recommended_step,
    'enqueue_plan', v_recommended_enqueue,
    'rationale', CASE
      WHEN v_exhausted_steps > 0 THEN 'Exhaustion-Flags vorhanden — Hard Heal mit Reset erforderlich.'
      WHEN v_hard_fail_steps > 0 THEN 'Hard-Fail-Breaker erreicht — manueller Bypass nötig.'
      WHEN v_pkg.blocked_reason IS NOT NULL THEN format('Paket blockiert (%s) — Hard Heal empfohlen.', v_pkg.blocked_reason)
      WHEN v_queued_no_job > 0 THEN 'Queued ohne Job — Soft Heal mit Re-Enqueue.'
      WHEN v_stale_locks > 0 THEN 'Stale Locks — Soft Heal mit Force-Unlock.'
      ELSE 'Keine kritischen Trigger — Soft Heal ausreichend.'
    END
  );

  -- Sort triggers by score desc
  SELECT jsonb_agg(t ORDER BY (t->>'score')::int DESC)
  INTO v_triggers
  FROM jsonb_array_elements(v_triggers) AS t;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'package_title', v_pkg.title,
    'package_status', v_pkg.status,
    'blocked_reason', v_pkg.blocked_reason,
    'active_job_count', v_active_jobs,
    'triggers', COALESCE(v_triggers, '[]'::jsonb),
    'trigger_count', COALESCE(jsonb_array_length(v_triggers), 0),
    'recommended', v_recommended,
    'analyzed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.analyze_package_root_cause(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analyze_package_root_cause(UUID) TO authenticated;
