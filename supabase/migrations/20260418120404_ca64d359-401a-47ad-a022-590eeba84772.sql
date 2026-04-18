
CREATE OR REPLACE FUNCTION public.fn_check_hot_loop_quarantine(
  p_package_id uuid, p_job_type text,
  p_window_minutes integer DEFAULT 30,
  p_threshold integer DEFAULT 5,
  p_block_minutes integer DEFAULT 30
)
RETURNS TABLE(quarantined boolean, signature text, fail_count integer, reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start timestamptz := now() - make_interval(mins => p_window_minutes);
  v_latest_sig text;
  v_identical_count integer;
  v_completes integer;
BEGIN
  IF p_package_id IS NULL OR p_job_type IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 0, NULL::text; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.package_job_quarantine
    WHERE package_id = p_package_id AND job_type = p_job_type
      AND cleared_at IS NULL AND blocked_until > now()
  ) THEN
    RETURN QUERY SELECT false, NULL::text, 0, 'already_quarantined'::text; RETURN;
  END IF;

  SELECT public.fn_extract_failure_signature(jq.last_error::text)
    INTO v_latest_sig
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id AND jq.job_type = p_job_type
     AND jq.updated_at >= v_window_start
     AND (
       jq.status = 'failed'
       OR (jq.status = 'cancelled' AND jq.last_error IS NOT NULL
           AND COALESCE(jq.meta->>'cancel_reason','') NOT IN (
             'ssot_applicability_guard','step_finalized','step_finalized_job_obsoleted',
             'BLOCKED_BY_MATERIALIZATION','package_exit_building','package_not_executable','unsigned_cancel'
           )
           AND COALESCE(jq.meta->>'cancel_reason','') NOT LIKE 'BLOCKED_BY_MATERIALIZATION%')
     )
   ORDER BY jq.updated_at DESC LIMIT 1;

  IF v_latest_sig IS NULL OR v_latest_sig = 'OBSOLETE_RACE' THEN
    RETURN QUERY SELECT false, v_latest_sig, 0, 'no_real_failure'::text; RETURN;
  END IF;

  SELECT COUNT(*)::integer INTO v_identical_count
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id AND jq.job_type = p_job_type
     AND jq.updated_at >= v_window_start
     AND (
       jq.status = 'failed'
       OR (jq.status = 'cancelled' AND jq.last_error IS NOT NULL
           AND COALESCE(jq.meta->>'cancel_reason','') NOT IN (
             'ssot_applicability_guard','step_finalized','step_finalized_job_obsoleted',
             'BLOCKED_BY_MATERIALIZATION','package_exit_building','package_not_executable','unsigned_cancel'
           )
           AND COALESCE(jq.meta->>'cancel_reason','') NOT LIKE 'BLOCKED_BY_MATERIALIZATION%')
     )
     AND public.fn_extract_failure_signature(jq.last_error::text) = v_latest_sig;

  SELECT COUNT(*)::integer INTO v_completes
    FROM public.job_queue jq
   WHERE jq.package_id = p_package_id AND jq.job_type = p_job_type
     AND jq.status = 'completed' AND jq.updated_at >= v_window_start;

  IF v_identical_count >= p_threshold AND v_completes = 0 THEN
    INSERT INTO public.package_job_quarantine (
      package_id, job_type, failure_signature, identical_fail_count,
      reason, blocked_until, created_at, metadata
    ) VALUES (
      p_package_id, p_job_type, v_latest_sig, v_identical_count,
      format('hot_loop:%s_failures_in_%smin', v_identical_count, p_window_minutes),
      now() + make_interval(mins => p_block_minutes), now(),
      jsonb_build_object('source','fn_check_hot_loop_quarantine','threshold',p_threshold)
    )
    ON CONFLICT (package_id, job_type) WHERE cleared_at IS NULL
    DO UPDATE SET
      failure_signature = EXCLUDED.failure_signature,
      identical_fail_count = EXCLUDED.identical_fail_count,
      reason = EXCLUDED.reason,
      blocked_until = EXCLUDED.blocked_until;

    BEGIN
      INSERT INTO public.admin_notifications (title, body, category, severity, entity_type, entity_id, metadata)
      VALUES (
        'Hot-Loop Quarantine triggered',
        format('Package %s job_type=%s blocked for %s min (sig=%s, count=%s)',
          p_package_id, p_job_type, p_block_minutes, v_latest_sig, v_identical_count),
        'pipeline','warning','package', p_package_id::text,
        jsonb_build_object('signature',v_latest_sig,'count',v_identical_count,'job_type',p_job_type)
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;

    RETURN QUERY SELECT true, v_latest_sig, v_identical_count, 'quarantined'::text;
  ELSE
    RETURN QUERY SELECT false, v_latest_sig, v_identical_count, 'below_threshold'::text;
  END IF;
END;
$function$;
