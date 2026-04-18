-- Phase 2 Härtung — Fix #2: Hot-Loop-Quarantäne auf deterministische cancelled-Failures erweitern
-- Erfasst jetzt auch error-like cancelled (z.B. HTTP 500), nicht nur failed.
-- Schließt harmlose Cancels (SSOT-Guard, step_finalized, BLOCKED_BY_MATERIALIZATION) explizit aus.

CREATE OR REPLACE FUNCTION public.fn_check_hot_loop_quarantine(
  p_package_id uuid,
  p_job_type text,
  p_window_minutes integer DEFAULT 30,
  p_threshold integer DEFAULT 5,
  p_block_minutes integer DEFAULT 30
)
RETURNS TABLE(quarantined boolean, signature text, fail_count integer, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start timestamptz := now() - make_interval(mins => p_window_minutes);
  v_latest_sig text;
  v_identical_count integer;
  v_completes integer;
  v_reason text;
BEGIN
  IF p_package_id IS NULL OR p_job_type IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 0, NULL::text;
    RETURN;
  END IF;

  -- Skip wenn schon aktive Quarantäne
  IF EXISTS (
    SELECT 1 FROM public.package_job_quarantine
    WHERE package_id = p_package_id
      AND job_type = p_job_type
      AND cleared_at IS NULL
      AND blocked_until > now()
  ) THEN
    RETURN QUERY SELECT false, NULL::text, 0, 'already_quarantined'::text;
    RETURN;
  END IF;

  -- Letzte Signatur extrahieren (jetzt failed ODER error-like cancelled)
  -- Harmlose Cancel-Reasons werden ausgeschlossen
  SELECT public.fn_extract_failure_signature(jq.last_error::text)
    INTO v_latest_sig
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id
     AND jq.job_type = p_job_type
     AND jq.updated_at >= v_window_start
     AND (
       jq.status = 'failed'
       OR (
         jq.status = 'cancelled'
         AND jq.last_error IS NOT NULL
         AND COALESCE(jq.meta->>'cancel_reason','') NOT IN (
           'ssot_applicability_guard',
           'step_finalized',
           'step_finalized_job_obsoleted',
           'BLOCKED_BY_MATERIALIZATION',
           'package_exit_building',
           'package_not_executable'
         )
         AND COALESCE(jq.meta->>'cancel_reason','') NOT LIKE 'BLOCKED_BY_MATERIALIZATION%'
       )
     )
   ORDER BY jq.updated_at DESC
   LIMIT 1;

  IF v_latest_sig IS NULL OR v_latest_sig = 'OBSOLETE_RACE' THEN
    RETURN QUERY SELECT false, v_latest_sig, 0, 'no_real_failure'::text;
    RETURN;
  END IF;

  -- Identische Failure-Signaturen zählen (failed + error-like cancelled)
  SELECT COUNT(*)::integer INTO v_identical_count
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id
     AND jq.job_type = p_job_type
     AND jq.updated_at >= v_window_start
     AND (
       jq.status = 'failed'
       OR (
         jq.status = 'cancelled'
         AND jq.last_error IS NOT NULL
         AND COALESCE(jq.meta->>'cancel_reason','') NOT IN (
           'ssot_applicability_guard',
           'step_finalized',
           'step_finalized_job_obsoleted',
           'BLOCKED_BY_MATERIALIZATION',
           'package_exit_building',
           'package_not_executable'
         )
         AND COALESCE(jq.meta->>'cancel_reason','') NOT LIKE 'BLOCKED_BY_MATERIALIZATION%'
       )
     )
     AND public.fn_extract_failure_signature(jq.last_error::text) = v_latest_sig;

  -- Completions im selben Fenster zählen
  SELECT COUNT(*)::integer INTO v_completes
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id
     AND jq.job_type = p_job_type
     AND jq.status = 'completed'
     AND jq.updated_at >= v_window_start;

  IF v_identical_count >= p_threshold AND v_completes = 0 THEN
    -- Quarantäne setzen
    INSERT INTO public.package_job_quarantine (
      package_id, job_type, failure_signature, failure_count,
      blocked_until, last_failure_at, created_at
    )
    VALUES (
      p_package_id, p_job_type, v_latest_sig, v_identical_count,
      now() + make_interval(mins => p_block_minutes), now(), now()
    )
    ON CONFLICT (package_id, job_type) WHERE cleared_at IS NULL
    DO UPDATE SET
      failure_signature = EXCLUDED.failure_signature,
      failure_count = EXCLUDED.failure_count,
      blocked_until = EXCLUDED.blocked_until,
      last_failure_at = EXCLUDED.last_failure_at;

    -- Admin-Notification (best-effort)
    BEGIN
      INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
      VALUES (
        'Hot-Loop Quarantine triggered',
        format('Package %s job_type=%s blocked for %s min (sig=%s, count=%s)',
          p_package_id, p_job_type, p_block_minutes, v_latest_sig, v_identical_count),
        'pipeline', 'warning', 'package', p_package_id::text,
        jsonb_build_object(
          'job_type', p_job_type,
          'failure_signature', v_latest_sig,
          'failure_count', v_identical_count,
          'block_minutes', p_block_minutes,
          'includes_cancelled', true
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Auto-Heal-Log
    BEGIN
      INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES (
        'hot_loop_quarantine_set', 'fn_check_hot_loop_quarantine', 'package_job',
        p_package_id, 'applied',
        format('Quarantine set: %s identical failures (sig=%s)', v_identical_count, v_latest_sig),
        jsonb_build_object('job_type', p_job_type, 'signature', v_latest_sig, 'count', v_identical_count)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN QUERY SELECT true, v_latest_sig, v_identical_count, 'quarantine_set'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, v_latest_sig, v_identical_count,
    format('below_threshold:%s/%s_completes=%s', v_identical_count, p_threshold, v_completes)::text;
END;
$function$;