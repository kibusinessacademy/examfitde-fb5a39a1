CREATE OR REPLACE FUNCTION public.admin_reconcile_stuck_validate_exam_pool(
  p_limit int DEFAULT 1, p_dry_run boolean DEFAULT true, p_package_id uuid DEFAULT NULL
)
RETURNS TABLE(package_id uuid, title text, heal_class text, action_taken text, reason text, job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _run_id uuid := gen_random_uuid();
  _enq int := 0; _skip int := 0; _dry int := 0; _err int := 0;
  _is_admin boolean := false;
  rec record; _new_job_id uuid; _action text; _reason text; _curriculum_id uuid;
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
        jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,'approved_q',rec.approved_q));
    ELSE
      BEGIN
        SELECT cp.curriculum_id INTO _curriculum_id FROM public.course_packages cp WHERE cp.id = rec.package_id;
        IF _curriculum_id IS NULL THEN
          _action := 'ERROR'; _reason := 'PACKAGE_HAS_NO_CURRICULUM_ID'; _err := _err + 1;
          INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
          VALUES('stuck_validate_exam_pool_reconcile_error','package',rec.package_id::text,'error',
            jsonb_build_object('run_id',_run_id,'error',_reason));
        ELSE
          UPDATE public.job_queue jq
             SET status='cancelled', updated_at=now(),
                 last_error = COALESCE(jq.last_error,'') || ' | STUCK_VALIDATE_RECONCILER_AUTOCANCEL run='|| _run_id::text
           WHERE jq.package_id = rec.package_id AND jq.job_type = 'package_validate_exam_pool'
             AND jq.status IN ('pending','queued') AND jq.locked_at IS NULL
             AND jq.updated_at < now() - interval '15 minutes';

          INSERT INTO public.job_queue(job_type,status,priority,payload,package_id,attempts,max_attempts,job_name,correlation_id)
          VALUES('package_validate_exam_pool','pending',50,
            jsonb_build_object('package_id',rec.package_id,'curriculum_id',_curriculum_id,
                               '_origin','stuck_validate_exam_pool_reconciler',
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
              'curriculum_id',_curriculum_id,'job_id',_new_job_id,'enqueued','package_validate_exam_pool',
              'bronze_lock_override',COALESCE(rec.bronze_locked,false)));
        END IF;
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