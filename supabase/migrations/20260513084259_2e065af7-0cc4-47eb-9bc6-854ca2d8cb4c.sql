-- Helper
CREATE OR REPLACE FUNCTION public.fn_validate_exam_pool_heal_class(
  p_package_id uuid,
  p_active_upstream_gen int,
  p_upstream_pool_status text,
  p_approved_q int,
  p_cancelled_validate_6h int,
  p_step_updated_at timestamptz,
  p_active_validate_jobs int
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _gate jsonb; _action text; _reasons text; _heal text;
BEGIN
  IF p_active_upstream_gen > 0 THEN RETURN jsonb_build_object('heal_class','WAIT_UPSTREAM_GEN'); END IF;
  IF p_upstream_pool_status IS DISTINCT FROM 'done' THEN RETURN jsonb_build_object('heal_class','UPSTREAM_NOT_DONE'); END IF;
  IF p_approved_q < 50 THEN RETURN jsonb_build_object('heal_class','POOL_TOO_SMALL'); END IF;
  BEGIN _gate := public.fn_classify_exam_pool_gate(p_package_id);
  EXCEPTION WHEN OTHERS THEN _gate := NULL; END;
  _action  := COALESCE(_gate->>'recommended_action','');
  _reasons := COALESCE((_gate->'reason_codes')::text,'');
  IF _action = 'repair_lf_coverage' OR _reasons ILIKE '%LF_COVERAGE%' THEN
    _heal := 'NEEDS_LF_COVERAGE_REPAIR';
  ELSIF _action = 'repair_competency_coverage' OR _reasons ILIKE '%COMPETENCY_COVERAGE%' THEN
    _heal := 'NEEDS_COMPETENCY_COVERAGE_REPAIR';
  ELSIF p_cancelled_validate_6h >= 5 THEN
    _heal := 'ELIGIBLE_REQUEUE';
  ELSIF p_step_updated_at < now() - interval '30 minutes' AND p_active_validate_jobs <= 1
        AND _action IN ('','revalidate','passthrough') THEN
    _heal := 'ELIGIBLE_REQUEUE';
  ELSE
    _heal := 'WAIT_OBSERVE';
  END IF;
  RETURN jsonb_build_object('heal_class',_heal,'gate_class',_gate->>'gate_class',
    'recommended_action',_action,'reason_codes',_gate->'reason_codes');
END;
$$;
REVOKE ALL ON FUNCTION public.fn_validate_exam_pool_heal_class(uuid,int,text,int,int,timestamptz,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_validate_exam_pool_heal_class(uuid,int,text,int,int,timestamptz,int) TO service_role, authenticated;

-- View (drop+recreate to allow column type change)
DROP VIEW IF EXISTS public.v_stuck_validate_exam_pool_blocking_integrity;
CREATE VIEW public.v_stuck_validate_exam_pool_blocking_integrity AS
WITH base AS (
  SELECT
    ps.package_id, cp.title, cp.status AS pkg_status,
    cp.feature_flags->'bronze' AS bronze_flag,
    public.fn_is_bronze_locked(ps.package_id) AS bronze_locked,
    ps.status AS step_status, ps.updated_at AS step_updated_at,
    (SELECT count(*)::int FROM public.exam_questions eq
       WHERE eq.package_id = ps.package_id AND eq.qc_status = 'approved') AS approved_q,
    (SELECT count(*)::int FROM public.exam_questions eq
       WHERE eq.package_id = ps.package_id AND eq.qc_status = 'draft') AS draft_q,
    (SELECT status::text FROM public.package_steps
       WHERE package_id = ps.package_id AND step_key = 'generate_exam_pool') AS upstream_pool_status,
    (SELECT count(*)::int FROM public.job_queue jq
       WHERE jq.package_id = ps.package_id AND jq.job_type = 'package_validate_exam_pool'
         AND jq.status IN ('pending','queued','processing','running')) AS active_validate_jobs,
    (SELECT count(*)::int FROM public.job_queue jq
       WHERE jq.package_id = ps.package_id AND jq.job_type = 'package_run_integrity_check'
         AND jq.status IN ('pending','queued','processing','running')) AS active_integrity_jobs,
    (SELECT count(*)::int FROM public.job_queue jq
       WHERE jq.package_id = ps.package_id AND jq.job_type = 'package_validate_exam_pool'
         AND jq.status = 'cancelled' AND jq.updated_at > now() - interval '6 hours') AS cancelled_validate_6h,
    (SELECT count(*)::int FROM public.job_queue jq
       WHERE jq.package_id = ps.package_id
         AND jq.job_type IN ('package_generate_exam_pool','package_generate_blueprint_variants','package_generate_competency_questions')
         AND jq.status IN ('pending','queued','processing','running')) AS active_upstream_gen_jobs
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE ps.step_key = 'validate_exam_pool' AND ps.status = 'queued'
    AND cp.status IN ('building','queued')
),
classified AS (
  SELECT b.*,
    public.fn_validate_exam_pool_heal_class(
      b.package_id, b.active_upstream_gen_jobs, b.upstream_pool_status,
      b.approved_q, b.cancelled_validate_6h, b.step_updated_at, b.active_validate_jobs
    ) AS gate
  FROM base b
)
SELECT package_id, title, pkg_status, bronze_flag, bronze_locked,
  step_status, step_updated_at, approved_q, draft_q, upstream_pool_status,
  active_validate_jobs, active_integrity_jobs, cancelled_validate_6h, active_upstream_gen_jobs,
  gate->>'heal_class' AS heal_class,
  gate->>'gate_class' AS gate_class,
  gate->>'recommended_action' AS recommended_action,
  gate->'reason_codes' AS reason_codes
FROM classified;

REVOKE ALL ON public.v_stuck_validate_exam_pool_blocking_integrity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_stuck_validate_exam_pool_blocking_integrity TO service_role;

-- Reconciler: gate-aware
CREATE OR REPLACE FUNCTION public.admin_reconcile_stuck_validate_exam_pool(
  p_limit int DEFAULT 1, p_dry_run boolean DEFAULT true, p_package_id uuid DEFAULT NULL
)
RETURNS TABLE(package_id uuid, title text, heal_class text, action_taken text, reason text, job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _run_id uuid := gen_random_uuid();
  _enq int := 0; _skip int := 0; _dry int := 0; _err int := 0; _skip_repair int := 0;
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

    IF rec.heal_class IN ('NEEDS_LF_COVERAGE_REPAIR','NEEDS_COMPETENCY_COVERAGE_REPAIR') THEN
      _action := 'SKIPPED_NEEDS_REPAIR'; _reason := rec.heal_class; _skip_repair := _skip_repair + 1;
      INSERT INTO public.auto_heal_log(action_type,target_type,target_id,result_status,metadata)
      VALUES('validate_exam_pool_requeue_skipped_needs_repair','package',rec.package_id::text,'skipped',
        jsonb_build_object('run_id',_run_id,'heal_class',rec.heal_class,
          'recommended_action',rec.recommended_action,'reason_codes',rec.reason_codes,
          'hint','use admin_dispatch_exam_pool_repair'));
    ELSIF rec.heal_class <> 'ELIGIBLE_REQUEUE' THEN
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
      'p_package_id',p_package_id,'enqueued',_enq,'dryrun',_dry,
      'skipped',_skip,'skipped_needs_repair',_skip_repair,'errors',_err));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reconcile_stuck_validate_exam_pool(int,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_stuck_validate_exam_pool(int,boolean,uuid) TO service_role, authenticated;

-- Dispatch RPC
CREATE OR REPLACE FUNCTION public.admin_dispatch_exam_pool_repair(
  p_limit int DEFAULT 3, p_dry_run boolean DEFAULT true, p_package_id uuid DEFAULT NULL
)
RETURNS TABLE(package_id uuid, title text, heal_class text, recommended_action text,
  job_type text, action_taken text, reason text, job_id uuid, idempotency_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
    ORDER BY step_updated_at ASC LIMIT p_limit
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
      FROM public.job_queue
      WHERE package_id = rec.package_id AND job_type = _job_type
        AND status IN ('pending','queued','processing','running');
    SELECT count(*)::int INTO _existing_idem
      FROM public.job_queue
      WHERE package_id = rec.package_id AND job_type = _job_type
        AND payload->>'_idempotency_key' = _idem;

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
$$;
REVOKE ALL ON FUNCTION public.admin_dispatch_exam_pool_repair(int,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_exam_pool_repair(int,boolean,uuid) TO service_role, authenticated;