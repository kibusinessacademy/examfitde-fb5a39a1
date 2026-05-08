
-- 1) Phantom-Guard erweitern: bronze_targeted_repair als legitimer Repair-Origin
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_by_types(
  p_job_types text[], p_limit integer, p_worker_id text, p_worker_pool text DEFAULT 'default'::text
) RETURNS SETOF job_queue
  LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  WITH phantoms AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
      AND COALESCE(jq.payload->>'_origin','') NOT IN ('competency_coverage_repair','targeted_fill_blueprint_recovery','bronze_targeted_repair')
      AND COALESCE(jq.payload->>'mode','')    NOT IN ('targeted_competency_fill','targeted_blueprint_fill','bronze_targeted_repair')
      AND COALESCE(jq.payload->>'enqueue_source','') NOT IN ('competency_coverage_repair','targeted_fill_blueprint_recovery','bronze_targeted_repair')
      AND COALESCE(jq.meta->>'enqueue_source','')    NOT IN ('bronze_targeted_repair')
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = (jq.payload->>'package_id')::uuid
          AND ps.step_key = regexp_replace(jq.job_type, '^package_', '')
          AND ps.status IN ('done','skipped')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq2
        WHERE jq2.package_id = (jq.payload->>'package_id')::uuid
          AND jq2.job_type IN ('package_validate_exam_pool','package_auto_publish')
          AND jq2.status = 'processing'
      )
    LIMIT 100
  )
  UPDATE public.job_queue jq
  SET status = 'cancelled', completed_at = now(),
      last_error = 'STEP_ALREADY_DONE_PHANTOM: target step already done/skipped',
      last_error_code = 'STEP_ALREADY_DONE_PHANTOM',
      meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
        'cancelled_by','claim_phantom_guard','cancelled_at', now()::text)
  FROM phantoms p
  WHERE jq.id = p.id;

  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id, jq.job_type, (jq.payload->>'package_id')::uuid AS pkg_id
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE WHEN p_worker_pool IS NOT NULL THEN
             COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
        ELSE COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (cp.id IS NULL OR cp.status = 'building' OR COALESCE(jtp.can_run_when_not_building, false))
      AND NOT EXISTS (
        SELECT 1 FROM public.package_job_quarantine q
        WHERE q.package_id = (jq.payload->>'package_id')::uuid
          AND q.job_type = jq.job_type AND q.cleared_at IS NULL AND q.blocked_until > now()
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit * 4
  )
  UPDATE public.job_queue q
  SET status='processing', locked_at=now(), locked_by=p_worker_id,
      started_at=now(), attempts=COALESCE(q.attempts,0)+1, updated_at=now(),
      liveness_status='healthy'
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$function$;

-- 2) Dispatch v3 — neue Idempotency, Payload trägt _origin/mode/bronze_lock_override,
--    Re-Dispatch erlaubt wenn kein aktiver Job mehr läuft.
CREATE OR REPLACE FUNCTION public.admin_bronze_targeted_repair_dispatch(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_is_admin boolean; v_pkg record; v_council record;
  v_score numeric; v_badge text; v_verdict text; v_rules_failed int;
  v_attempts int; v_failed_rules jsonb; v_repair_vector jsonb;
  v_job_id uuid; v_curriculum_id uuid; v_idem text;
  v_active_job uuid;
BEGIN
  v_caller_is_admin := has_role(auth.uid(), 'admin'::app_role);
  IF NOT v_caller_is_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT cp.* INTO v_pkg FROM course_packages cp WHERE cp.id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id; END IF;
  v_curriculum_id := v_pkg.curriculum_id;
  IF v_curriculum_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_CURRICULUM_ID for package %', p_package_id;
  END IF;

  SELECT ps.* INTO v_council FROM package_steps ps
   WHERE ps.package_id = p_package_id AND ps.step_key = 'quality_council'
   ORDER BY ps.updated_at DESC LIMIT 1;

  v_score := COALESCE((v_council.meta->>'score')::numeric,
                      (v_council.meta->'verdict'->>'score')::numeric);
  v_badge := COALESCE(v_council.meta->>'badge', v_council.meta->'verdict'->>'badge');
  v_verdict := COALESCE(v_council.meta->'verdict'->>'status', v_council.meta->>'verdict');
  v_rules_failed := COALESCE((v_council.meta->>'rules_failed')::int, 999);

  IF v_badge IS DISTINCT FROM 'bronze' OR v_score IS NULL OR v_score < 75 OR v_rules_failed > 2 THEN
    RETURN jsonb_build_object('skipped', true, 'reason','NOT_BRONZE',
      'badge', v_badge, 'score', v_score, 'rules_failed', v_rules_failed, 'verdict', v_verdict);
  END IF;

  v_attempts := COALESCE((v_pkg.feature_flags->'bronze'->>'repair_attempts')::int, 0);

  -- Re-Dispatch erlaubt, wenn repair_active=true ABER kein aktiver Job mehr existiert
  IF (v_pkg.feature_flags->'bronze'->>'repair_active')::boolean = true THEN
    SELECT id INTO v_active_job FROM job_queue
     WHERE package_id = p_package_id
       AND job_type = 'package_elite_harden'
       AND status IN ('pending','processing')
       AND COALESCE(meta->>'bronze_repair','') = 'true'
     LIMIT 1;
    IF v_active_job IS NOT NULL THEN
      RETURN jsonb_build_object('skipped', true, 'reason','REPAIR_ALREADY_ACTIVE',
        'attempts', v_attempts, 'active_job_id', v_active_job);
    END IF;
    -- stale repair_active → clear and continue
    UPDATE course_packages
       SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze,repair_active}','false'::jsonb,true)
     WHERE id = p_package_id;
  END IF;

  IF v_attempts >= 1 THEN
    UPDATE course_packages
       SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
             COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
               'requires_review', true, 'final_state','requires_review',
               'final_state_at', now(), 'last_score', v_score), true)
     WHERE id = p_package_id;
    RETURN jsonb_build_object('terminal', true, 'attempts', v_attempts, 'score', v_score);
  END IF;

  v_failed_rules  := COALESCE(v_council.meta->'failed_rules', '[]'::jsonb);
  v_repair_vector := COALESCE(v_council.meta->'repair_vector', '{}'::jsonb);

  v_idem := 'bronze_repair:v3:' || p_package_id::text || ':' || (v_attempts + 1)::text;

  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
    VALUES (
      'package_elite_harden', p_package_id, 'pending', 7,
      jsonb_build_object(
        'package_id', p_package_id,
        'curriculum_id', v_curriculum_id,
        '_origin','bronze_targeted_repair',
        'mode','bronze_targeted_repair',
        'phase','bronze_repair',
        'enqueue_source','bronze_targeted_repair',
        'bronze_lock_override', true,
        'failed_rules', v_failed_rules,
        'repair_vector', v_repair_vector,
        'bronze_attempt', v_attempts + 1,
        'origin_council_score', v_score,
        'origin_council_rules_failed', v_rules_failed
      ),
      jsonb_build_object('bronze_repair', true, 'attempt', v_attempts + 1,
        'enqueue_source','bronze_targeted_repair', 'bronze_lock_override', true,
        'idem_version','v3'),
      v_idem
    )
    RETURNING id INTO v_job_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_job_id FROM job_queue WHERE idempotency_key = v_idem LIMIT 1;
    RETURN jsonb_build_object('skipped', true, 'reason','JOB_ALREADY_ENQUEUED',
      'job_id', v_job_id, 'attempt', v_attempts + 1);
  END;

  UPDATE course_packages
     SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
           COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
             'repair_active', true,
             'requires_review', true,
             'repair_attempts', v_attempts + 1,
             'repair_dispatched_at', now(),
             'repair_idem_version','v3',
             'last_repair_job_id', v_job_id), true)
   WHERE id = p_package_id;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('admin_bronze_targeted_repair_dispatch','bronze_repair_dispatched_v3',
          p_package_id::text,'package','success',
          format('Bronze v3 dispatched job %s attempt %s', v_job_id, v_attempts + 1),
          jsonb_build_object('package_id', p_package_id,'job_id', v_job_id,
            'attempt', v_attempts + 1,'score', v_score,'rules_failed', v_rules_failed));

  RETURN jsonb_build_object('dispatched', true,'job_id', v_job_id,
    'attempt', v_attempts + 1,'score', v_score,'rules_failed', v_rules_failed,'idem_version','v3');
END;
$function$;

-- 3) Finalize-RPC: nach erfolgreichem Bronze-Repair durch Edge-Fn aufgerufen.
--    Schaltet repair_active=false, setzt run_integrity_check zurück auf queued
--    und enqueued den Integrity-Job mit Bronze-Source (whitelisted).
CREATE OR REPLACE FUNCTION public.admin_bronze_repair_finalize(
  p_package_id uuid, p_repair_summary jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg record; v_curriculum_id uuid; v_step_id uuid; v_job_id uuid;
  v_idem text;
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO v_pkg FROM course_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id; END IF;
  v_curriculum_id := v_pkg.curriculum_id;

  -- Clear repair_active (requires_review bleibt true bis Council bestanden)
  UPDATE course_packages
     SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
           COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
             'repair_active', false,
             'last_repair_completed_at', now(),
             'last_repair_summary', p_repair_summary), true)
   WHERE id = p_package_id;

  -- Reset run_integrity_check step → queued (bypass any revert guards)
  PERFORM set_config('session_replication_role','replica', true);
  UPDATE package_steps
     SET status='queued', updated_at=now(), started_at=NULL, finished_at=NULL,
         last_error=NULL,
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'reset_by','admin_bronze_repair_finalize',
           'reset_at', now(),
           'reset_reason','bronze_targeted_repair_completed')
   WHERE package_id = p_package_id AND step_key = 'run_integrity_check'
   RETURNING id INTO v_step_id;
  PERFORM set_config('session_replication_role','origin', true);

  v_idem := 'bronze_repair_integrity:v3:' || p_package_id::text || ':' ||
            COALESCE((v_pkg.feature_flags->'bronze'->>'repair_attempts'),'1');

  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
    VALUES (
      'package_run_integrity_check', p_package_id, 'pending', 6,
      jsonb_build_object(
        'package_id', p_package_id,
        'curriculum_id', v_curriculum_id,
        '_origin','bronze_targeted_repair',
        'mode','bronze_targeted_repair',
        'enqueue_source','bronze_targeted_repair',
        'bronze_lock_override', true),
      jsonb_build_object('bronze_repair_followup', true,
        'enqueue_source','bronze_targeted_repair','bronze_lock_override', true),
      v_idem
    ) RETURNING id INTO v_job_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_job_id FROM job_queue WHERE idempotency_key = v_idem LIMIT 1;
  END;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('admin_bronze_repair_finalize','bronze_repair_finalized',
          p_package_id::text,'package','success',
          format('Bronze repair finalized; integrity_check requeued (job %s)', v_job_id),
          jsonb_build_object('package_id', p_package_id,'integrity_job_id', v_job_id,
            'step_id', v_step_id,'summary', p_repair_summary));

  RETURN jsonb_build_object('ok', true,'integrity_job_id', v_job_id,'step_reset', v_step_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_bronze_repair_finalize(uuid,jsonb) TO service_role;
