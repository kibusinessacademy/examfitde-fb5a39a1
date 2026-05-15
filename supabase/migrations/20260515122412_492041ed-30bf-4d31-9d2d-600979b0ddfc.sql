-- Fix B (DB layer): central park-helper + 3 requeue paths

-- 1) Helper: fn_is_step_parked
CREATE OR REPLACE FUNCTION public.fn_is_step_parked(_package_id uuid, _step_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.package_steps ps
    WHERE ps.package_id = _package_id
      AND ps.step_key   = _step_key
      AND (
            ps.status::text = 'manual_review_required'
         OR COALESCE(ps.last_error,'') ILIKE 'manual_bypass:%'
         OR COALESCE(ps.last_error,'') ILIKE '%operator review%'
         OR COALESCE(ps.last_error,'') ILIKE '%dormant phantom%'
         OR COALESCE((ps.meta->>'parked')::boolean, false) = true
         OR (ps.meta ? 'parked_reason')
         OR (ps.meta ? 'manual_bypass_reason')
      )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_step_parked(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_is_step_parked(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_is_step_parked(uuid, text) IS
'SSOT Park-Helper. true wenn step manuell geparkt ist (manual_bypass / operator review / dormant phantom / meta.parked / manual_review_required). Tail-/Integrity-/Publish-Heals MÜSSEN vor Requeue prüfen.';


-- 2a) Patch admin_safe_requeue_integrity_check — Park-Gate
CREATE OR REPLACE FUNCTION public.admin_safe_requeue_integrity_check(_package_id uuid, _reason text DEFAULT 'manual_admin_requeue'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _step             public.package_steps%ROWTYPE;
  _ric_step_order   integer;
  _active_count     integer := 0;
  _upstream_pending integer := 0;
  _new_job_id       uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden_admin_only');
  END IF;

  SELECT * INTO _step
    FROM public.package_steps
   WHERE package_id = _package_id
     AND step_key   = 'run_integrity_check';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_missing');
  END IF;

  -- Park-Gate (Fix B)
  IF public.fn_is_step_parked(_package_id, 'run_integrity_check') THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('requeue_skipped_park','admin_safe_requeue_integrity_check','course_package',_package_id::text,
            'skipped','Step parked — requeue refused',
            jsonb_build_object('step_key','run_integrity_check','reason',_reason,'last_error',_step.last_error));
    RETURN jsonb_build_object('ok', false, 'error', 'step_parked');
  END IF;

  IF _step.status NOT IN ('queued', 'failed', 'manual_review_required') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_not_eligible', 'current_status', _step.status);
  END IF;

  _ric_step_order := COALESCE(_step.step_order, 0);

  SELECT count(*) INTO _active_count
    FROM public.job_queue
   WHERE package_id = _package_id
     AND job_type   = 'package_run_integrity_check'
     AND status IN ('pending', 'queued', 'processing', 'running');

  IF _active_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_job_exists', 'active', _active_count);
  END IF;

  SELECT count(*) INTO _upstream_pending
    FROM public.package_steps
   WHERE package_id = _package_id
     AND step_key   <> 'run_integrity_check'
     AND step_order < _ric_step_order
     AND status NOT IN ('done', 'skipped');

  IF _upstream_pending > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'upstream_steps_pending', 'pending', _upstream_pending);
  END IF;

  UPDATE public.package_steps
     SET status = 'queued', updated_at = now(),
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('safe_requeue_reason', _reason)
   WHERE id = _step.id;

  _new_job_id := gen_random_uuid();
  INSERT INTO public.job_queue (id, job_type, package_id, status, payload, attempts, created_at, updated_at, meta)
  VALUES (
    _new_job_id, 'package_run_integrity_check', _package_id, 'queued',
    jsonb_build_object('package_id', _package_id), 0, now(), now(),
    jsonb_build_object('safe_requeue', true, 'safe_requeue_reason', _reason)
  );

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids, reason)
  VALUES ('safe_requeue_integrity_check',
          jsonb_build_object('package_id', _package_id, 'new_job_id', _new_job_id),
          'job_queue', ARRAY[_new_job_id::text], _reason);

  RETURN jsonb_build_object('ok', true, 'job_id', _new_job_id);
END;
$function$;


-- 2b) Patch guardian_heal_shadow_stalled — Park-Gate vor Retry
CREATE OR REPLACE FUNCTION public.guardian_heal_shadow_stalled(p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_age_hours numeric;
  v_recent_heal_attempts int;
  v_oldest_step text;
  v_retry_result jsonb;
  v_task_id uuid;
BEGIN
  SELECT EXTRACT(EPOCH FROM (now() - created_at))/3600
    INTO v_pkg_age_hours
  FROM course_packages WHERE id = p_package_id AND status = 'building';

  IF v_pkg_age_hours IS NULL THEN
    RETURN jsonb_build_object('action','skip','reason','not_building_or_missing');
  END IF;

  IF v_pkg_age_hours > 168 THEN
    RETURN jsonb_build_object('action','skip','reason','pkg_too_old_for_auto_heal','age_hours',v_pkg_age_hours);
  END IF;

  SELECT COUNT(*) INTO v_recent_heal_attempts
  FROM auto_heal_log
  WHERE action_type = 'shadow_stalled_auto_heal'
    AND target_id = p_package_id::text
    AND created_at > now() - interval '6 hours';

  IF v_recent_heal_attempts >= 3 THEN
    BEGIN
      v_task_id := admin_create_permanent_fix_task(
        p_pattern_key := encode(extensions.digest('shadow_stalled|'||p_package_id::text,'sha1'),'hex'),
        p_cluster := 'shadow_stalled_auto_heal',
        p_package_id := p_package_id,
        p_title := 'SHADOW_STALLED: Auto-Heal erschöpft (3× erfolglos)',
        p_description := 'Paket '||p_package_id||' war wiederholt SHADOW_STALLED, 3 Auto-Heal-Versuche in 6h ohne Erfolg.',
        p_priority := 'high',
        p_recommendation_id := NULL
      );
    EXCEPTION WHEN OTHERS THEN v_task_id := NULL; END;

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('shadow_stalled_auto_heal','guardian_heal_shadow_stalled','course_package',p_package_id::text,
      'escalated','Escalated to permanent_fix_backlog after 3 failed attempts',
      jsonb_build_object('attempts_6h',v_recent_heal_attempts,'task_id',v_task_id));

    RETURN jsonb_build_object('action','escalate','task_id',v_task_id,'attempts_6h',v_recent_heal_attempts);
  END IF;

  -- Oldest actionable step that is NOT parked (Fix B)
  SELECT step_key INTO v_oldest_step
  FROM package_steps
  WHERE package_id = p_package_id
    AND status::text IN ('queued','processing','failed')
    AND NOT public.fn_is_step_parked(p_package_id, step_key)
  ORDER BY updated_at ASC
  LIMIT 1;

  IF v_oldest_step IS NULL THEN
    -- Audit Park-Skip if there IS a step but all are parked
    IF EXISTS (
      SELECT 1 FROM package_steps
      WHERE package_id = p_package_id
        AND status::text IN ('queued','processing','failed')
    ) THEN
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('requeue_skipped_park','guardian_heal_shadow_stalled','course_package',p_package_id::text,
              'skipped','All actionable steps are parked',
              jsonb_build_object('package_id',p_package_id));
      RETURN jsonb_build_object('action','skip','reason','all_actionable_steps_parked');
    END IF;
    RETURN jsonb_build_object('action','skip','reason','no_actionable_step');
  END IF;

  BEGIN
    v_retry_result := admin_retry_failed_step(p_package_id, v_oldest_step, 'guardian_shadow_heal');
  EXCEPTION WHEN OTHERS THEN
    v_retry_result := jsonb_build_object('error',SQLERRM);
  END;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('shadow_stalled_auto_heal','guardian_heal_shadow_stalled','course_package',p_package_id::text,
    CASE WHEN v_retry_result ? 'error' THEN 'failed' ELSE 'applied' END,
    'Auto-retry oldest step: '||v_oldest_step,
    jsonb_build_object('step_key',v_oldest_step,'retry_result',v_retry_result,'attempt_no',v_recent_heal_attempts+1));

  RETURN jsonb_build_object('action','retry','step_key',v_oldest_step,'attempt_no',v_recent_heal_attempts+1,'result',v_retry_result);
END $function$;


-- 2c) Patch fn_auto_heal_stale_tail_after_approve — Park-Gate
CREATE OR REPLACE FUNCTION public.fn_auto_heal_stale_tail_after_approve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_last_heal timestamptz;
  v_cooldown_minutes int := 5;
  v_stale_count int;
  v_steps_reset int := 0;
  v_validate_job_id uuid;
  v_curriculum_id uuid;
  v_active_jobs int;
  v_parked_hits int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.qc_status IS NOT DISTINCT FROM OLD.qc_status THEN RETURN NEW; END IF;
    IF NEW.qc_status <> 'approved' THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.qc_status <> 'approved' THEN RETURN NEW; END IF;
  END IF;

  v_pkg_id := NEW.package_id;
  IF v_pkg_id IS NULL THEN RETURN NEW; END IF;

  SELECT MAX(created_at) INTO v_last_heal
  FROM public.auto_heal_log
  WHERE target_type = 'course_package'
    AND target_id = v_pkg_id::text
    AND action_type = 'auto_heal_stale_tail_after_approve'
    AND created_at > now() - (v_cooldown_minutes || ' minutes')::interval;

  IF v_last_heal IS NOT NULL THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_stale_count
  FROM public.v_stale_done_steps WHERE package_id = v_pkg_id;

  IF v_stale_count = 0 THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_active_jobs
  FROM public.job_queue
  WHERE package_id = v_pkg_id
    AND job_type IN ('package_validate_exam_pool','package_run_integrity_check',
                     'package_quality_council','package_auto_publish')
    AND status IN ('pending','queued','processing');

  IF v_active_jobs > 0 THEN RETURN NEW; END IF;

  -- Park-Gate (Fix B): if ANY of the stale-or-tail targets is parked → skip + audit
  SELECT count(*) INTO v_parked_hits
  FROM public.package_steps ps
  WHERE ps.package_id = v_pkg_id
    AND (
      ps.step_key IN (SELECT step_key FROM public.v_stale_done_steps WHERE package_id = v_pkg_id)
      OR ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
    )
    AND public.fn_is_step_parked(v_pkg_id, ps.step_key);

  IF v_parked_hits > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('requeue_skipped_park','fn_auto_heal_stale_tail_after_approve','course_package',v_pkg_id::text,
            'skipped','Stale-tail heal refused — parked steps in cascade',
            jsonb_build_object('package_id',v_pkg_id,'parked_hits',v_parked_hits,'stale_count',v_stale_count));
    RETURN NEW;
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM public.course_packages WHERE id = v_pkg_id;

  WITH stale AS (
    SELECT step_key FROM public.v_stale_done_steps WHERE package_id = v_pkg_id
  )
  UPDATE public.package_steps ps
  SET status = 'queued', started_at = NULL, updated_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by', 'repair_rpc',
        'reset_by', 'fn_auto_heal_stale_tail_after_approve',
        'reset_at', now()::text,
        'reset_reason', 'new_approved_questions_after_validation_done'
      )
  WHERE ps.package_id = v_pkg_id
    AND (
      ps.step_key IN (SELECT step_key FROM stale)
      OR (ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
          AND ps.status IN ('done','failed','blocked','skipped')
          AND EXISTS (SELECT 1 FROM stale WHERE step_key = 'validate_exam_pool'))
    );

  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  IF v_steps_reset > 0 THEN
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta)
    VALUES (
      'package_validate_exam_pool', v_pkg_id, 'pending', 20, 3,
      jsonb_build_object(
        'package_id', v_pkg_id, 'curriculum_id', v_curriculum_id,
        'step_key', 'validate_exam_pool',
        'enqueue_source', 'auto_heal_after_approve_trigger'
      ),
      jsonb_build_object('origin', 'auto_heal_after_approve')
    )
    RETURNING id INTO v_validate_job_id;
  END IF;

  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'auto_heal_stale_tail_after_approve','course_package', v_pkg_id::text,
    CASE WHEN v_steps_reset > 0 THEN 'success' ELSE 'noop' END,
    format('triggered by approve of question %s; reset %s stale steps', NEW.id, v_steps_reset),
    jsonb_build_object(
      'package_id', v_pkg_id, 'trigger_question_id', NEW.id,
      'stale_count_before', v_stale_count,
      'steps_reset', v_steps_reset,
      'validate_job_id', v_validate_job_id
    )
  );

  RETURN NEW;
END;
$function$;


-- 3) Audit anchor for the SSOT-helper rollout
INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, result_status, result_detail, metadata)
VALUES ('park_helper_ssot_rollout','fix_b_db_layer','system','success',
        'fn_is_step_parked deployed + 3 DB requeue paths gated',
        jsonb_build_object(
          'helper','fn_is_step_parked',
          'patched',jsonb_build_array(
            'admin_safe_requeue_integrity_check',
            'guardian_heal_shadow_stalled',
            'fn_auto_heal_stale_tail_after_approve'
          ),
          'edge_followup',jsonb_build_array(
            'progress_guard_shadow_stalled',
            'guardian_stale_fail',
            'step_to_job_reconciliation'
          )
        ));