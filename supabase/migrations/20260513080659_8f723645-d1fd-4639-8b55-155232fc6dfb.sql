
-- =====================================================================
-- 1) BUCKET D: STUCK_VALIDATE_EXAM_POOL_BLOCKS_INTEGRITY
-- =====================================================================
CREATE OR REPLACE VIEW public.v_stuck_validate_exam_pool_blocking_integrity AS
WITH base AS (
  SELECT
    ps.package_id,
    cp.title,
    cp.status AS pkg_status,
    cp.feature_flags->'bronze' AS bronze_flag,
    public.fn_is_bronze_locked(ps.package_id) AS bronze_locked,
    ps.status AS step_status,
    ps.updated_at AS step_updated_at,
    (SELECT count(*) FROM public.exam_questions eq
       WHERE eq.package_id = ps.package_id AND eq.qc_status = 'approved') AS approved_q,
    (SELECT count(*) FROM public.exam_questions eq
       WHERE eq.package_id = ps.package_id AND eq.qc_status = 'draft') AS draft_q,
    (SELECT status FROM public.package_steps
       WHERE package_id = ps.package_id AND step_key = 'generate_exam_pool') AS upstream_pool_status,
    (SELECT count(*) FROM public.job_queue jq
       WHERE jq.package_id = ps.package_id AND jq.job_type = 'package_validate_exam_pool'
         AND jq.status IN ('pending','queued','processing','running')) AS active_validate_jobs,
    (SELECT count(*) FROM public.job_queue jq
       WHERE jq.package_id = ps.package_id AND jq.job_type = 'package_run_integrity_check'
         AND jq.status IN ('pending','queued','processing','running')) AS active_integrity_jobs,
    (SELECT count(*) FROM public.job_queue jq
       WHERE jq.package_id = ps.package_id AND jq.job_type = 'package_validate_exam_pool'
         AND jq.status = 'cancelled' AND jq.updated_at > now() - interval '6 hours') AS cancelled_validate_6h,
    (SELECT count(*) FROM public.job_queue jq
       WHERE jq.package_id = ps.package_id
         AND jq.job_type IN ('package_generate_exam_pool','package_generate_blueprint_variants','package_generate_competency_questions')
         AND jq.status IN ('pending','queued','processing','running')) AS active_upstream_gen_jobs
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE ps.step_key = 'validate_exam_pool' AND ps.status = 'queued'
    AND cp.status IN ('building','queued')
)
SELECT package_id, title, pkg_status, bronze_flag, bronze_locked,
  step_status, step_updated_at, approved_q, draft_q, upstream_pool_status,
  active_validate_jobs, active_integrity_jobs, cancelled_validate_6h, active_upstream_gen_jobs,
  CASE
    WHEN active_upstream_gen_jobs > 0 THEN 'WAIT_UPSTREAM_GEN'
    WHEN upstream_pool_status IS DISTINCT FROM 'done' THEN 'UPSTREAM_NOT_DONE'
    WHEN approved_q < 50 THEN 'POOL_TOO_SMALL'
    WHEN cancelled_validate_6h >= 5 THEN 'ELIGIBLE_REQUEUE'
    WHEN step_updated_at < now() - interval '30 minutes' AND active_validate_jobs <= 1 THEN 'ELIGIBLE_REQUEUE'
    ELSE 'WAIT_OBSERVE'
  END AS heal_class
FROM base;

REVOKE ALL ON public.v_stuck_validate_exam_pool_blocking_integrity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_stuck_validate_exam_pool_blocking_integrity TO service_role;

CREATE OR REPLACE FUNCTION public.admin_reconcile_stuck_validate_exam_pool(
  p_limit int DEFAULT 1, p_dry_run boolean DEFAULT true, p_package_id uuid DEFAULT NULL
)
RETURNS TABLE(package_id uuid, title text, heal_class text, action_taken text, reason text, job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _run_id uuid := gen_random_uuid();
  _enq int := 0; _skip int := 0; _dry int := 0; _err int := 0;
  _is_admin boolean := false;
  rec record; _new_job_id uuid; _action text; _reason text;
BEGIN
  SELECT (auth.jwt()->>'role' = 'service_role') OR public.has_role(auth.uid(),'admin') INTO _is_admin;
  IF NOT _is_admin THEN RAISE EXCEPTION 'permission denied (service_role or admin required)'; END IF;

  FOR rec IN
    SELECT * FROM public.v_stuck_validate_exam_pool_blocking_integrity v
    WHERE (p_package_id IS NULL OR v.package_id = p_package_id)
    ORDER BY step_updated_at ASC LIMIT p_limit
  LOOP
    _action := NULL; _reason := NULL; _new_job_id := NULL;

    IF rec.heal_class <> 'ELIGIBLE_REQUEUE' THEN
      _action := 'SKIPPED'; _reason := rec.heal_class; _skip := _skip + 1;

    ELSIF p_dry_run THEN
      _action := 'DRY_RUN_WOULD_REQUEUE'; _reason := 'cancel_stale_then_enqueue_fresh_validate'; _dry := _dry + 1;
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('stuck_validate_exam_pool_reconcile_dryrun','package',rec.package_id::text,'success',
        jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,'approved_q',rec.approved_q,
          'cancelled_validate_6h',rec.cancelled_validate_6h,'active_validate_jobs',rec.active_validate_jobs));
    ELSE
      BEGIN
        UPDATE public.job_queue
           SET status='cancelled', updated_at=now(),
               last_error = COALESCE(last_error,'') || ' | STUCK_VALIDATE_RECONCILER_AUTOCANCEL run='|| _run_id::text
         WHERE package_id = rec.package_id AND job_type = 'package_validate_exam_pool'
           AND status IN ('pending','queued') AND locked_at IS NULL
           AND updated_at < now() - interval '15 minutes';

        INSERT INTO public.job_queue(job_type,status,priority,payload,package_id,attempts,max_attempts,job_name,correlation_id)
        VALUES('package_validate_exam_pool','pending',50,
          jsonb_build_object('package_id',rec.package_id,'_origin','stuck_validate_exam_pool_reconciler',
                             '_run_id',_run_id,'bronze_lock_override',COALESCE(rec.bronze_locked,false)),
          rec.package_id,0,8,
          'stuck_validate_reconciler:'||rec.package_id::text,_run_id)
        RETURNING id INTO _new_job_id;

        IF _new_job_id IS NULL THEN
          _action := 'SILENT_DROPPED'; _reason := 'INSERT_returned_no_id'; _err := _err + 1;
        ELSE
          _action := 'REQUEUED'; _reason := 'fresh_validate_enqueued'; _enq := _enq + 1;
        END IF;

        INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
        VALUES('stuck_validate_exam_pool_reconcile_enqueued','package',rec.package_id::text,
          CASE WHEN _new_job_id IS NULL THEN 'silent_drop' ELSE 'success' END,
          jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,'approved_q',rec.approved_q,
            'job_id',_new_job_id,'enqueued','package_validate_exam_pool',
            'bronze_lock_override',COALESCE(rec.bronze_locked,false)));
      EXCEPTION WHEN OTHERS THEN
        _action := 'ERROR'; _reason := SQLERRM; _err := _err + 1;
        INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
        VALUES('stuck_validate_exam_pool_reconcile_error','package',rec.package_id::text,'error',
          jsonb_build_object('run_id',_run_id,'error',SQLERRM));
      END;
    END IF;

    package_id := rec.package_id; title := rec.title; heal_class := rec.heal_class;
    action_taken := _action; reason := _reason; job_id := _new_job_id;
    RETURN NEXT;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES('stuck_validate_exam_pool_reconcile_summary','system',NULL,'success',
    jsonb_build_object('run_id',_run_id,'p_limit',p_limit,'dry_run',p_dry_run,
      'p_package_id',p_package_id,'enqueued',_enq,'dryrun',_dry,'skipped',_skip,'errors',_err));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_stuck_validate_exam_pool(int,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_stuck_validate_exam_pool(int,boolean,uuid) TO service_role, authenticated;

-- =====================================================================
-- 2) fn_enforce_global_fanout_cap: Audit-Mirror Patch
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_enforce_global_fanout_cap()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE _pkg_id text; _pending_count int; _cap int := 3;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;
  _pkg_id := NEW.payload->>'package_id';
  IF _pkg_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO _pending_count FROM public.job_queue
   WHERE payload->>'package_id' = _pkg_id AND job_type = NEW.job_type
     AND status IN ('pending','processing') AND id <> NEW.id;
  IF _pending_count >= _cap THEN
    PERFORM public.fn_log_guardrail_event('fanout_cap_blocked',
      jsonb_build_object('package_id',_pkg_id,'job_type',NEW.job_type,
                         'pending_count',_pending_count,'cap',_cap));
    BEGIN
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('job_queue_insert_suppressed_fanout_cap','package',_pkg_id,'skipped',
        jsonb_build_object('reason','FANOUT_CAP_REACHED','job_type',NEW.job_type,
          'pending_count',_pending_count,'cap',_cap,'attempted_status',NEW.status));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- =====================================================================
-- 3) SILENT-DROP FORENSIK
-- =====================================================================
CREATE OR REPLACE VIEW public.v_audit_enqueue_silent_drops AS
SELECT
  ahl.id AS audit_id,
  ahl.action_type,
  CASE WHEN ahl.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN ahl.target_id::uuid ELSE NULL END AS package_id,
  ahl.created_at AS audit_at,
  ahl.metadata->>'run_id' AS run_id,
  CASE WHEN (ahl.metadata->>'job_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN (ahl.metadata->>'job_id')::uuid ELSE NULL END AS claimed_job_id,
  ahl.metadata->>'enqueued' AS enqueued_job_type,
  CASE
    WHEN (ahl.metadata->>'job_id') IS NOT NULL
         AND (ahl.metadata->>'job_id') ~* '^[0-9a-f-]{36}$'
         AND EXISTS (SELECT 1 FROM public.job_queue jq WHERE jq.id = (ahl.metadata->>'job_id')::uuid)
      THEN 'PRESENT'
    WHEN ahl.target_id ~* '^[0-9a-f-]{36}$'
         AND EXISTS (
           SELECT 1 FROM public.job_queue jq
            WHERE jq.package_id = ahl.target_id::uuid
              AND (ahl.metadata->>'enqueued' IS NULL OR jq.job_type = ahl.metadata->>'enqueued')
              AND jq.created_at BETWEEN ahl.created_at - interval '5 seconds'
                                    AND ahl.created_at + interval '60 seconds')
      THEN 'PRESENT_BY_TIME_WINDOW'
    ELSE 'SILENT_DROP'
  END AS verdict
FROM public.auto_heal_log ahl
WHERE ahl.action_type LIKE '%\_enqueued' ESCAPE '\'
  AND ahl.result_status = 'success'
  AND ahl.created_at > now() - interval '7 days';

REVOKE ALL ON public.v_audit_enqueue_silent_drops FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_audit_enqueue_silent_drops TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_audit_enqueue_silent_drops(
  p_window_minutes int DEFAULT 60, p_action_type text DEFAULT NULL
)
RETURNS TABLE(audit_id uuid, action_type text, package_id uuid, audit_at timestamptz,
              run_id text, claimed_job_id uuid, enqueued_job_type text, verdict text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT ((auth.jwt()->>'role' = 'service_role') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  RETURN QUERY
  SELECT v.audit_id, v.action_type, v.package_id, v.audit_at,
         v.run_id, v.claimed_job_id, v.enqueued_job_type, v.verdict
  FROM public.v_audit_enqueue_silent_drops v
  WHERE v.audit_at > now() - make_interval(mins => p_window_minutes)
    AND (p_action_type IS NULL OR v.action_type = p_action_type)
  ORDER BY v.audit_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_audit_enqueue_silent_drops(int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_audit_enqueue_silent_drops(int,text) TO service_role, authenticated;

-- =====================================================================
-- 4) ALERT
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_check_audit_silent_drops_and_alert(
  p_window_minutes int DEFAULT 30, p_threshold int DEFAULT 1
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _drops jsonb; _drop_count int; _alert_key text; _dest record; _inserted int := 0;
BEGIN
  SELECT jsonb_agg(to_jsonb(d)), count(*) INTO _drops, _drop_count
  FROM public.v_audit_enqueue_silent_drops d
  WHERE d.verdict = 'SILENT_DROP'
    AND d.audit_at > now() - make_interval(mins => p_window_minutes);

  IF _drop_count IS NULL OR _drop_count < p_threshold THEN
    RETURN jsonb_build_object('checked_at',now(),'drops',COALESCE(_drop_count,0),'alerts_emitted',0);
  END IF;

  _alert_key := 'audit_enqueue_silent_drops:'||to_char(now(),'YYYY-MM-DD"T"HH24');

  FOR _dest IN
    SELECT id, channel, target FROM public.heal_alert_destinations
    WHERE COALESCE(enabled, true) = true
  LOOP
    BEGIN
      INSERT INTO public.heal_alert_notifications(
        destination_id, channel, target, alert_key, severity, payload, status, attempts, max_attempts
      ) VALUES (_dest.id, _dest.channel, _dest.target, _alert_key, 'P1',
        jsonb_build_object(
          'summary', format('%s silent enqueue-drop(s) in last %s min', _drop_count, p_window_minutes),
          'window_minutes', p_window_minutes, 'drop_count', _drop_count,
          'samples', (SELECT jsonb_agg(d) FROM (SELECT * FROM jsonb_array_elements(_drops) LIMIT 5) d)),
        'pending', 0, 5);
      _inserted := _inserted + 1;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES('audit_silent_drop_alert_check','system',NULL,'success',
    jsonb_build_object('window_minutes',p_window_minutes,'drop_count',_drop_count,
                       'alerts_emitted',_inserted,'alert_key',_alert_key));

  RETURN jsonb_build_object('checked_at',now(),'drops',_drop_count,'alerts_emitted',_inserted,'alert_key',_alert_key);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_audit_silent_drops_and_alert(int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_audit_silent_drops_and_alert(int,int) TO service_role;
