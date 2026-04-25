-- =====================================================================
-- 1. HEALER REGRESSION GUARD on package_steps
-- =====================================================================
-- Blocks any UPDATE that transitions a step to 'done' without the
-- required invariants (finished_at IS NOT NULL AND meta->>'ok' = 'true').
-- Logs the attempted bad update into step_done_meta_audit with
-- blocked=true and a human-readable block_reason, then RAISES.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_healer_done_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text := COALESCE(current_setting('app.source_fn', true), 'unknown');
  v_missing text[] := ARRAY[]::text[];
  v_meta_ok text;
  v_reason text;
BEGIN
  -- Only act on transitions INTO done from a non-done status
  IF NEW.status::text <> 'done' THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = 'done' THEN
    RETURN NEW;
  END IF;

  v_meta_ok := COALESCE(NEW.meta->>'ok', '');

  IF NEW.finished_at IS NULL THEN
    v_missing := array_append(v_missing, 'finished_at');
  END IF;
  IF v_meta_ok <> 'true' THEN
    v_missing := array_append(v_missing, 'meta.ok');
  END IF;

  -- Allow explicit operator bypasses (admin_force_steps_done, etc.)
  IF (NEW.meta ? 'emergency_bypass') AND (NEW.meta->>'emergency_bypass' = 'true') THEN
    RETURN NEW;
  END IF;

  IF array_length(v_missing, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_reason := 'Healer regression blocked: missing required field(s) [' ||
              array_to_string(v_missing, ', ') ||
              '] when transitioning step "' || NEW.step_key || '" → done. ' ||
              'Source: ' || v_source || '. ' ||
              'Required invariant: finished_at IS NOT NULL AND meta.ok = ''true''.';

  -- Best-effort audit row (do not fail the rollback because audit insert fails)
  BEGIN
    INSERT INTO public.step_done_meta_audit (
      package_id, step_key, prev_status, prev_meta, new_meta,
      meta_ok, meta_executed, source_fn, trigger_op, blocked, block_reason
    ) VALUES (
      NEW.package_id,
      NEW.step_key,
      OLD.status::text,
      OLD.meta,
      NEW.meta,
      (v_meta_ok = 'true'),
      NULLIF(NEW.meta->>'executed','')::boolean,
      v_source,
      TG_OP,
      true,
      v_reason
    );
  EXCEPTION WHEN OTHERS THEN
    -- swallow audit errors; the RAISE below is what matters
    NULL;
  END;

  RAISE EXCEPTION 'HEALER_REGRESSION_BLOCKED: %', v_reason
    USING ERRCODE = 'check_violation',
          HINT    = 'Set finished_at and meta.ok=''true'' before marking done, '
                 || 'or set meta.emergency_bypass=''true'' for an explicit operator override.';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_healer_done_invariants ON public.package_steps;
CREATE TRIGGER trg_guard_healer_done_invariants
BEFORE UPDATE ON public.package_steps
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_healer_done_invariants();

-- =====================================================================
-- 2. TARGETED SINGLE-JOB RECOVERY RPC
-- =====================================================================
-- Re-runs artifact-aware recovery for a single job_id and syncs the
-- related package_step. Returns a JSON diff describing what changed.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_recover_single_job(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_step_before RECORD;
  v_step_after RECORD;
  v_job_after RECORD;
  v_changes jsonb := '[]'::jsonb;
  v_step_key text;
BEGIN
  -- Admin guard
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT * INTO v_job FROM public.job_queue WHERE id = p_job_id;
  IF v_job IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found', 'job_id', p_job_id);
  END IF;

  v_step_key := regexp_replace(v_job.job_type, '^package_', '');

  SELECT * INTO v_step_before
  FROM public.package_steps
  WHERE package_id = v_job.package_id
    AND step_key = v_step_key
  LIMIT 1;

  -- 1) Run artifact-aware lock release if a function for it exists
  BEGIN
    PERFORM public.fn_release_stale_job_locks();
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  -- 2) Re-trigger the sync path for this specific job by touching it.
  --    The sync trigger fires on completion transitions; we mark
  --    a sync attempt by bumping updated_at.
  UPDATE public.job_queue
     SET updated_at = now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'admin_targeted_recovery_at', now(),
           'admin_targeted_recovery_by', COALESCE(auth.uid()::text, 'system')
         )
   WHERE id = p_job_id;

  SELECT * INTO v_job_after FROM public.job_queue WHERE id = p_job_id;

  SELECT * INTO v_step_after
  FROM public.package_steps
  WHERE package_id = v_job.package_id
    AND step_key = v_step_key
  LIMIT 1;

  -- Build diff
  IF v_step_before IS NOT NULL THEN
    IF v_step_before.status::text IS DISTINCT FROM v_step_after.status::text THEN
      v_changes := v_changes || jsonb_build_object(
        'field', 'package_steps.status',
        'before', v_step_before.status::text,
        'after',  v_step_after.status::text
      );
    END IF;
    IF v_step_before.finished_at IS DISTINCT FROM v_step_after.finished_at THEN
      v_changes := v_changes || jsonb_build_object(
        'field', 'package_steps.finished_at',
        'before', v_step_before.finished_at,
        'after',  v_step_after.finished_at
      );
    END IF;
    IF (v_step_before.meta->>'ok') IS DISTINCT FROM (v_step_after.meta->>'ok') THEN
      v_changes := v_changes || jsonb_build_object(
        'field', 'package_steps.meta.ok',
        'before', v_step_before.meta->>'ok',
        'after',  v_step_after.meta->>'ok'
      );
    END IF;
  END IF;

  IF v_job.status IS DISTINCT FROM v_job_after.status THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'job_queue.status',
      'before', v_job.status,
      'after',  v_job_after.status
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', p_job_id,
    'package_id', v_job.package_id,
    'step_key', v_step_key,
    'job_type', v_job.job_type,
    'changes', v_changes,
    'no_op', (jsonb_array_length(v_changes) = 0),
    'job_status', v_job_after.status,
    'step_status', COALESCE(v_step_after.status::text, NULL),
    'recovered_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recover_single_job(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_recover_single_job(uuid) TO authenticated;

-- =====================================================================
-- 3. RETRY-LOOP DETECTOR
-- =====================================================================
-- A view of jobs caught in a deterministic retry loop, plus a function
-- that writes a warning admin notification per detected loop.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_retry_loop_candidates AS
SELECT
  jq.id                                AS job_id,
  jq.package_id,
  jq.job_type,
  jq.status,
  jq.attempts,
  jq.max_attempts,
  jq.last_error,
  jq.last_error_code,
  jq.updated_at,
  EXTRACT(EPOCH FROM (now() - jq.created_at))::int AS age_seconds,
  -- Extract guard condition from common error shapes
  CASE
    WHEN jq.last_error ILIKE '%REQUEUE_LOOP%'        THEN 'REQUEUE_LOOP_COOLDOWN'
    WHEN jq.last_error ILIKE '%STALE_PROCESSING%'    THEN 'STALE_PROCESSING_GUARD'
    WHEN jq.last_error ILIKE '%QUALITY_THRESHOLD%'   THEN 'QUALITY_THRESHOLD_NOT_MET'
    WHEN jq.last_error ILIKE '%HEALER_REGRESSION%'   THEN 'HEALER_REGRESSION_BLOCKED'
    WHEN jq.last_error ILIKE '%producer_evidence%'   THEN 'PRODUCER_EVIDENCE_MISSING'
    WHEN jq.last_error ILIKE '%missing source%'      THEN 'MISSING_SOURCE_DATA'
    WHEN jq.last_error_code IS NOT NULL              THEN jq.last_error_code
    ELSE 'UNKNOWN_GUARD'
  END AS guard_condition,
  jq.job_type AS involved_function
FROM public.job_queue jq
WHERE jq.attempts >= 4
  AND jq.updated_at > now() - interval '1 hour'
  AND jq.status IN ('pending','processing','failed')
  AND jq.last_error IS NOT NULL;

CREATE OR REPLACE FUNCTION public.detect_retry_loops()
RETURNS TABLE(
  job_id uuid,
  package_id uuid,
  job_type text,
  attempts int,
  guard_condition text,
  notified boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_existing uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.v_retry_loop_candidates
    ORDER BY attempts DESC
    LIMIT 50
  LOOP
    -- de-dupe by entity_id within last hour
    SELECT id INTO v_existing
      FROM public.admin_notifications
     WHERE entity_type = 'job_retry_loop'
       AND entity_id   = r.job_id
       AND created_at  > now() - interval '1 hour'
     LIMIT 1;

    IF v_existing IS NULL THEN
      INSERT INTO public.admin_notifications (
        title, body, category, severity, metadata,
        entity_type, entity_id
      ) VALUES (
        'Retry-loop detected: ' || r.job_type,
        'Job ' || r.job_id || ' has ' || r.attempts || ' attempts. '
          || 'Guard: ' || r.guard_condition || '. '
          || 'Last error: ' || COALESCE(left(r.last_error, 240), '(none)'),
        'pipeline_health',
        'warning',
        jsonb_build_object(
          'job_id', r.job_id,
          'package_id', r.package_id,
          'job_type', r.job_type,
          'attempts', r.attempts,
          'guard_condition', r.guard_condition,
          'involved_function', r.involved_function,
          'last_error', r.last_error,
          'last_error_code', r.last_error_code
        ),
        'job_retry_loop',
        r.job_id
      );

      job_id := r.job_id;
      package_id := r.package_id;
      job_type := r.job_type;
      attempts := r.attempts;
      guard_condition := r.guard_condition;
      notified := true;
      RETURN NEXT;
    ELSE
      job_id := r.job_id;
      package_id := r.package_id;
      job_type := r.job_type;
      attempts := r.attempts;
      guard_condition := r.guard_condition;
      notified := false;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_retry_loops() FROM public;
GRANT EXECUTE ON FUNCTION public.detect_retry_loops() TO authenticated;

-- =====================================================================
-- 4. INTEGRITY REPORT VERSION DIFF
-- =====================================================================
-- Compares two integrity_check_history rows for one package and returns
-- a structured diff plus a plain-language explanation.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_integrity_report_diff(
  p_package_id uuid,
  p_version_a int DEFAULT NULL,
  p_version_b int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows RECORD;
  v_a RECORD;
  v_b RECORD;
  v_added text[];
  v_removed text[];
  v_explanation text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  -- Default: compare the two newest reports for this package
  IF p_version_a IS NULL OR p_version_b IS NULL THEN
    SELECT * INTO v_b
    FROM public.integrity_check_history
    WHERE package_id = p_package_id
    ORDER BY created_at DESC
    LIMIT 1;

    SELECT * INTO v_a
    FROM public.integrity_check_history
    WHERE package_id = p_package_id
      AND id <> COALESCE(v_b.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY created_at DESC
    LIMIT 1;
  ELSE
    -- Use rownum-style version numbering (1 = oldest)
    WITH ordered AS (
      SELECT *, row_number() OVER (ORDER BY created_at ASC) AS v
      FROM public.integrity_check_history
      WHERE package_id = p_package_id
    )
    SELECT * INTO v_a FROM ordered WHERE v = p_version_a;
    WITH ordered AS (
      SELECT *, row_number() OVER (ORDER BY created_at ASC) AS v
      FROM public.integrity_check_history
      WHERE package_id = p_package_id
    )
    SELECT * INTO v_b FROM ordered WHERE v = p_version_b;
  END IF;

  IF v_a IS NULL OR v_b IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'insufficient_history',
      'package_id', p_package_id,
      'have_versions', (SELECT count(*) FROM public.integrity_check_history WHERE package_id = p_package_id)
    );
  END IF;

  v_added := COALESCE(
    (SELECT array_agg(r) FROM unnest(COALESCE(v_b.hard_fail_reasons, ARRAY[]::text[])) r
     WHERE r <> ALL(COALESCE(v_a.hard_fail_reasons, ARRAY[]::text[]))),
    ARRAY[]::text[]
  );
  v_removed := COALESCE(
    (SELECT array_agg(r) FROM unnest(COALESCE(v_a.hard_fail_reasons, ARRAY[]::text[])) r
     WHERE r <> ALL(COALESCE(v_b.hard_fail_reasons, ARRAY[]::text[]))),
    ARRAY[]::text[]
  );

  v_explanation := CASE
    WHEN v_b.passed AND NOT COALESCE(v_a.passed, false) THEN
      'Package now PASSES quality. ' || array_length(v_removed,1) ||
      ' hard-fail reason(s) were resolved between v' || to_char(v_a.created_at,'YYYY-MM-DD HH24:MI') ||
      ' and v' || to_char(v_b.created_at,'YYYY-MM-DD HH24:MI') || '.'
    WHEN NOT v_b.passed AND COALESCE(v_a.passed, false) THEN
      'Regression: package previously passed but is now QUALITY_FAILED. New hard-fail(s): ' ||
      COALESCE(array_to_string(v_added, ', '), '(none)') || '.'
    WHEN v_b.passed THEN
      'Package PASSES (score ' || v_b.score || '). No regression vs previous run.'
    ELSE
      'Package marked QUALITY_FAILED with ' || COALESCE(v_b.hard_fail_count, 0) ||
      ' hard-fail reason(s): ' ||
      COALESCE(array_to_string(v_b.hard_fail_reasons, ', '), '(unknown)') || '.'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'a', jsonb_build_object(
      'id', v_a.id,
      'created_at', v_a.created_at,
      'score', v_a.score,
      'passed', v_a.passed,
      'hard_fail_count', v_a.hard_fail_count,
      'hard_fail_reasons', to_jsonb(COALESCE(v_a.hard_fail_reasons, ARRAY[]::text[]))
    ),
    'b', jsonb_build_object(
      'id', v_b.id,
      'created_at', v_b.created_at,
      'score', v_b.score,
      'passed', v_b.passed,
      'hard_fail_count', v_b.hard_fail_count,
      'hard_fail_reasons', to_jsonb(COALESCE(v_b.hard_fail_reasons, ARRAY[]::text[]))
    ),
    'diff', jsonb_build_object(
      'score_delta', COALESCE(v_b.score,0) - COALESCE(v_a.score,0),
      'reasons_added', to_jsonb(v_added),
      'reasons_removed', to_jsonb(v_removed),
      'passed_changed', (v_a.passed IS DISTINCT FROM v_b.passed)
    ),
    'explanation', v_explanation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_integrity_report_diff(uuid, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_integrity_report_diff(uuid, int, int) TO authenticated;