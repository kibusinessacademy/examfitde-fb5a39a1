CREATE OR REPLACE FUNCTION public.admin_dispatch_exam_pool_repair(p_limit integer DEFAULT 3, p_dry_run boolean DEFAULT true, p_package_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(package_id uuid, title text, heal_class text, recommended_action text, job_type text, action_taken text, reason text, job_id uuid, idempotency_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _run_id uuid := gen_random_uuid();
  _is_admin boolean := false;
  _enq int := 0; _skip int := 0; _dry int := 0; _err int := 0;
  rec record; _job_type text; _idem text; _new_job_id uuid;
  _active_repair_count int; _existing_idem int;
BEGIN
  SELECT (auth.jwt()->>'role' = 'service_role') OR public.has_role(auth.uid(),'admin') INTO _is_admin;
  IF NOT _is_admin THEN RAISE EXCEPTION 'permission denied (service_role or admin required)'; END IF;

  FOR rec IN
    SELECT * FROM public.v_stuck_validate_exam_pool_blocking_integrity v
    WHERE v.heal_class IN ('NEEDS_LF_COVERAGE_REPAIR','NEEDS_COMPETENCY_COVERAGE_REPAIR')
      AND (p_package_id IS NULL OR v.package_id = p_package_id)
    ORDER BY v.step_updated_at ASC LIMIT p_limit
  LOOP
    _new_job_id := NULL;
    _job_type := CASE rec.heal_class
      WHEN 'NEEDS_LF_COVERAGE_REPAIR' THEN 'package_repair_exam_pool_lf_coverage'
      WHEN 'NEEDS_COMPETENCY_COVERAGE_REPAIR' THEN 'package_repair_exam_pool_competency_coverage'
    END;
    _idem := 'exam_pool_repair:'||rec.package_id::text||':'
             ||COALESCE(rec.recommended_action, lower(rec.heal_class))||':'
             ||to_char(now() AT TIME ZONE 'UTC','YYYYMMDDHH24');

    SELECT count(*)::int INTO _active_repair_count
      FROM public.job_queue jq
      WHERE jq.package_id = rec.package_id AND jq.job_type = _job_type
        AND jq.status IN ('pending','queued','processing','running');
    SELECT count(*)::int INTO _existing_idem
      FROM public.job_queue jq
      WHERE jq.package_id = rec.package_id AND jq.job_type = _job_type
        AND jq.payload->>'_idempotency_key' = _idem;

    IF _active_repair_count > 0 THEN
      action_taken := 'SKIPPED_ACTIVE_REPAIR'; reason := 'repair job already active'; _skip := _skip + 1;
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('exam_pool_repair_skipped','package',rec.package_id::text,'skipped',
        jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,'job_type',_job_type,
          'reason','active_repair_present','active_count',_active_repair_count,'idempotency_key',_idem));
    ELSIF _existing_idem > 0 THEN
      action_taken := 'SKIPPED_IDEMPOTENT'; reason := 'same hour bucket already enqueued'; _skip := _skip + 1;
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('exam_pool_repair_skipped','package',rec.package_id::text,'skipped',
        jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,'job_type',_job_type,
          'reason','idempotency_hit','idempotency_key',_idem));
    ELSIF p_dry_run THEN
      action_taken := 'DRY_RUN_WOULD_DISPATCH'; reason := _job_type; _dry := _dry + 1;
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('exam_pool_repair_dispatch_dryrun','package',rec.package_id::text,'success',
        jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,'job_type',_job_type,
          'recommended_action',rec.recommended_action,'reason_codes',rec.reason_codes,
          'idempotency_key',_idem,'approved_q',rec.approved_q,
          'bronze_locked',COALESCE(rec.bronze_locked,false)));
    ELSE
      BEGIN
        INSERT INTO public.job_queue(job_type,status,priority,payload,package_id,attempts,max_attempts,job_name,correlation_id)
        VALUES(_job_type,'pending',55,
          jsonb_build_object(
            'package_id',rec.package_id,'_origin','admin_dispatch_exam_pool_repair',
            '_run_id',_run_id,'_idempotency_key',_idem,
            'recommended_action',rec.recommended_action,'reason_codes',rec.reason_codes,
            'bronze_lock_override',COALESCE(rec.bronze_locked,false)),
          rec.package_id,0,5,
          'exam_pool_repair_dispatch:'||rec.package_id::text,_run_id)
        RETURNING id INTO _new_job_id;
        IF _new_job_id IS NULL THEN
          action_taken := 'SILENT_DROPPED'; reason := 'INSERT returned no id'; _err := _err + 1;
        ELSE
          action_taken := 'DISPATCHED'; reason := _job_type; _enq := _enq + 1;
        END IF;
        INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
        VALUES('exam_pool_repair_dispatched','package',rec.package_id::text,
          CASE WHEN _new_job_id IS NULL THEN 'silent_drop' ELSE 'success' END,
          jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,'job_type',_job_type,
            'job_id',_new_job_id,'idempotency_key',_idem,
            'recommended_action',rec.recommended_action,
            'bronze_lock_override',COALESCE(rec.bronze_locked,false)));
      EXCEPTION WHEN OTHERS THEN
        action_taken := 'ERROR'; reason := SQLERRM; _err := _err + 1;
        INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
        VALUES('exam_pool_repair_skipped','package',rec.package_id::text,'error',
          jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,'job_type',_job_type,
            'idempotency_key',_idem,'error',SQLERRM));
      END;
    END IF;
    package_id := rec.package_id; title := rec.title; heal_class := rec.heal_class;
    recommended_action := rec.recommended_action; job_type := _job_type;
    job_id := _new_job_id; idempotency_key := _idem;
    RETURN NEXT;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
  VALUES('exam_pool_repair_summary','system',NULL,'success',
    jsonb_build_object('run_id',_run_id,'p_limit',p_limit,'dry_run',p_dry_run,
      'p_package_id',p_package_id,'dispatched',_enq,'dryrun',_dry,'skipped',_skip,'errors',_err));
END;
$function$;