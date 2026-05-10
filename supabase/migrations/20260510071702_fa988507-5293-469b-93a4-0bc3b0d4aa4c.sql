-- Dauermaßnahme: ops_cancel_pending_non_building_jobs hardening
-- 1) Per-Job Audit on cancel
-- 2) Policy-Race Guard for repair jobs (payload/meta is_repair, policy flags)
-- 3) Audit skipped protected repairs
-- Rollback: DROP FUNCTION + restore previous body from migration 20260510065202

CREATE OR REPLACE FUNCTION public.ops_cancel_pending_non_building_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_skipped int := 0;
  rec record;
  v_is_protected boolean;
  v_protect_reason text;
BEGIN
  FOR rec IN
    SELECT
      jq.id AS job_id,
      jq.job_type,
      jq.package_id,
      jq.status AS previous_status,
      jq.run_after,
      jq.worker_pool,
      jq.lane,
      jq.payload,
      jq.meta,
      cp.status AS package_status,
      COALESCE(jtp.can_run_when_not_building, false) AS can_run_when_not_building,
      COALESCE(jtp.exempt_from_auto_cancel, false)   AS exempt_from_auto_cancel,
      COALESCE((jq.payload->>'is_repair')::boolean, false) AS payload_is_repair,
      COALESCE((jq.meta->>'is_repair')::boolean, false)    AS meta_is_repair
    FROM public.job_queue jq
    JOIN public.course_packages cp
      ON cp.id = jq.package_id
      OR cp.id::text = (jq.payload->>'package_id')
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND cp.status NOT IN ('building','quality_gate_failed','blocked','council_review')
    LIMIT 500
  LOOP
    -- Policy-Race Guard: protect any job that is_repair (payload/meta) or has policy flags
    v_is_protected := rec.can_run_when_not_building
                   OR rec.exempt_from_auto_cancel
                   OR rec.payload_is_repair
                   OR rec.meta_is_repair;

    IF v_is_protected THEN
      v_protect_reason := CASE
        WHEN rec.exempt_from_auto_cancel    THEN 'policy_exempt_from_auto_cancel'
        WHEN rec.can_run_when_not_building  THEN 'policy_can_run_when_not_building'
        WHEN rec.payload_is_repair          THEN 'payload_is_repair'
        WHEN rec.meta_is_repair             THEN 'meta_is_repair'
      END;

      INSERT INTO public.auto_heal_log (
        action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
      ) VALUES (
        'ops_cancel_pending_non_building_job_skipped',
        'ops_cancel_pending_non_building_jobs',
        'job',
        rec.job_id,
        'protected',
        format('Skipped cancel for %s (%s)', rec.job_type, v_protect_reason),
        jsonb_build_object(
          'job_id', rec.job_id,
          'job_type', rec.job_type,
          'package_id', rec.package_id,
          'package_status', rec.package_status,
          'can_run_when_not_building', rec.can_run_when_not_building,
          'exempt_from_auto_cancel', rec.exempt_from_auto_cancel,
          'payload_is_repair', rec.payload_is_repair,
          'meta_is_repair', rec.meta_is_repair,
          'protect_reason', v_protect_reason,
          'previous_status', rec.previous_status,
          'run_after', rec.run_after,
          'worker_pool', rec.worker_pool,
          'lane', rec.lane
        )
      );
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Cancel + per-job audit
    UPDATE public.job_queue jq
    SET status = 'cancelled',
        updated_at = now(),
        last_error = COALESCE(jq.last_error,'') || ' | OPS_GUARD:NON_BUILDING_PACKAGE',
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
          'ops_guard', true,
          'ops_guard_reason', 'NON_BUILDING_PACKAGE',
          'cancel_reason', 'ops_guard_non_building_package',
          'cancel_source', 'ops_cancel_pending_non_building_jobs',
          'ops_guard_at', now(),
          'last_error_reason', 'NON_BUILDING_PACKAGE'
        )
    WHERE jq.id = rec.job_id;

    INSERT INTO public.auto_heal_log (
      action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata
    ) VALUES (
      'ops_cancel_pending_non_building_job',
      'ops_cancel_pending_non_building_jobs',
      'job',
      rec.job_id,
      'cancelled',
      format('Cancelled %s on non-building package (status=%s)', rec.job_type, rec.package_status),
      jsonb_build_object(
        'job_id', rec.job_id,
        'job_type', rec.job_type,
        'package_id', rec.package_id,
        'package_status', rec.package_status,
        'can_run_when_not_building', rec.can_run_when_not_building,
        'exempt_from_auto_cancel', rec.exempt_from_auto_cancel,
        'payload_is_repair', rec.payload_is_repair,
        'meta_is_repair', rec.meta_is_repair,
        'cancel_reason', 'ops_guard_non_building_package',
        'previous_status', rec.previous_status,
        'run_after', rec.run_after,
        'worker_pool', rec.worker_pool,
        'lane', rec.lane
      )
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    PERFORM public.ops_raise_alert(
      'NON_BUILDING_PENDING_CLEANUP',
      CASE WHEN v_count >= 10 THEN 'warn' ELSE 'info' END,
      format('Auto-cancelled %s pending jobs on non-building packages (%s protected skipped)', v_count, v_skipped),
      jsonb_build_object('count', v_count, 'skipped_protected', v_skipped, 'cleaned_at_bucket', date_trunc('hour', now()))
    );
  END IF;

  -- Aggregate run audit (always, even noop) for forensics
  INSERT INTO public.auto_heal_log (
    action_type, trigger_source, target_type, result_status, result_detail, metadata
  ) VALUES (
    'ops_cancel_pending_non_building_jobs_run',
    'ops_cancel_pending_non_building_jobs',
    'system',
    CASE WHEN v_count > 0 THEN 'applied' ELSE 'noop' END,
    format('Cancelled=%s Skipped=%s', v_count, v_skipped),
    jsonb_build_object('cancelled', v_count, 'skipped_protected', v_skipped)
  );

  RETURN v_count;
END;
$function$;