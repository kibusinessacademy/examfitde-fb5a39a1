-- Dedupe-safe Resume: reuse active package_quality_council jobs instead of inserting

-- Overload 1: single package
CREATE OR REPLACE FUNCTION public.admin_resolve_council_deferred(
  p_package_id uuid, p_action text, p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_defer_id uuid;
  v_admin uuid := auth.uid();
  v_result jsonb;
  v_existing_job uuid;
  v_job_id uuid;
  v_job_action text;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_action NOT IN ('retry_council','force_pass','mark_content_gap') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_action');
  END IF;

  SELECT id INTO v_defer_id
  FROM public.council_defer_log
  WHERE package_id = p_package_id AND cleared_at IS NULL
  ORDER BY deferred_at DESC LIMIT 1;

  IF v_defer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_open_defer_for_package');
  END IF;

  IF p_action = 'retry_council' THEN
    UPDATE public.council_defer_log SET cleared_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cleared_by', v_admin, 'cleared_action', 'retry_council', 'reason', p_reason)
     WHERE id = v_defer_id;

    UPDATE public.package_steps
       SET status = 'queued', last_error = NULL, updated_at = now(),
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('council_resume_at', now(), 'council_resume_by', v_admin)
     WHERE package_id = p_package_id AND step_key = 'quality_council';

    -- DEDUPE: reuse existing active job if present
    SELECT id INTO v_existing_job
    FROM public.job_queue
    WHERE package_id = p_package_id
      AND job_type = 'package_quality_council'
      AND status IN ('pending','queued','processing')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_job IS NOT NULL THEN
      UPDATE public.job_queue
         SET status = 'pending',
             run_after = now(),
             priority = GREATEST(COALESCE(priority,5), 5),
             attempts = 0,
             last_error_code = NULL,
             last_error_message = NULL,
             locked_by = NULL,
             locked_at = NULL,
             last_heartbeat_at = NULL,
             liveness_status = 'healthy',
             updated_at = now(),
             payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object(
               'source','admin_resolve_council_deferred',
               'admin_id', v_admin,
               'resumed_at', now(),
               'manual_resume', true
             )
       WHERE id = v_existing_job
       RETURNING id INTO v_job_id;
      v_job_action := 'reused_active_job';
    ELSE
      INSERT INTO public.job_queue (package_id, job_type, status, payload, created_at, updated_at)
      VALUES (p_package_id, 'package_quality_council', 'pending',
              jsonb_build_object('source','admin_resolve_council_deferred','admin_id', v_admin, 'manual_resume', true),
              now(), now())
      RETURNING id INTO v_job_id;
      v_job_action := 'new_job_inserted';
    END IF;

    v_result := jsonb_build_object('ok', true, 'action', 'retry_council', 'package_id', p_package_id, 'job_id', v_job_id, 'job_action', v_job_action);

  ELSIF p_action = 'force_pass' THEN
    UPDATE public.package_steps
       SET status = 'done', last_error = NULL,
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('force_pass', true, 'force_pass_at', now(), 'force_pass_by', v_admin, 'reason', p_reason),
           updated_at = now()
     WHERE package_id = p_package_id AND step_key = 'quality_council';

    UPDATE public.council_defer_log SET cleared_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cleared_by', v_admin, 'cleared_action', 'force_pass', 'reason', p_reason)
     WHERE id = v_defer_id;

    UPDATE public.heal_permanent_fix_tasks SET status = 'done', completed_at = now(), completed_by = v_admin, updated_at = now()
     WHERE pattern_key = 'COUNCIL_DEFERRED_STALE_WORKER_3X' AND package_id = p_package_id AND status IN ('open','in_progress');

    v_result := jsonb_build_object('ok', true, 'action', 'force_pass', 'package_id', p_package_id);

  ELSE  -- mark_content_gap
    UPDATE public.course_packages
       SET status = 'archived',
           blocked_reason = COALESCE(blocked_reason, 'COUNCIL_DEFERRED_MANUAL_REVIEW'),
           updated_at = now()
     WHERE id = p_package_id;

    UPDATE public.council_defer_log SET cleared_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cleared_by', v_admin, 'cleared_action', 'mark_content_gap', 'reason', p_reason)
     WHERE id = v_defer_id;

    UPDATE public.heal_permanent_fix_tasks SET status = 'done', completed_at = now(), completed_by = v_admin, updated_at = now()
     WHERE pattern_key = 'COUNCIL_DEFERRED_STALE_WORKER_3X' AND package_id = p_package_id AND status IN ('open','in_progress');

    v_result := jsonb_build_object('ok', true, 'action', 'mark_content_gap', 'package_id', p_package_id);
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('admin_resolve_council_deferred', 'package', p_package_id::text, 'success',
    jsonb_build_object('action', p_action, 'reason', p_reason, 'admin_id', v_admin, 'result', v_result));

  RETURN v_result;
END;
$function$;

-- Overload 2: bulk (uuid[]) — patch its INSERT path likewise
CREATE OR REPLACE FUNCTION public.admin_resolve_council_deferred(
  p_package_ids uuid[],
  p_mode text DEFAULT 'retry_council'::text,
  p_reason text DEFAULT 'manual_stop_loop_fix'::text
)
RETURNS TABLE(package_id uuid, action text, job_id uuid, note text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg uuid;
  v_admin uuid := auth.uid();
  v_existing_job uuid;
  v_job_id uuid;
  v_cleared int;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.has_role(v_admin, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  IF p_mode <> 'retry_council' THEN
    RAISE EXCEPTION 'unsupported mode: %', p_mode;
  END IF;

  FOREACH v_pkg IN ARRAY p_package_ids LOOP
    -- clear active defers
    UPDATE public.council_defer_log
       SET cleared_at = now(),
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('cleared_by', v_admin, 'cleared_action', 'retry_council', 'reason', p_reason)
     WHERE package_id = v_pkg AND cleared_at IS NULL;
    GET DIAGNOSTICS v_cleared = ROW_COUNT;

    IF v_cleared = 0 THEN
      package_id := v_pkg; action := 'skipped'; job_id := NULL; note := 'no_active_defer';
      RETURN NEXT; CONTINUE;
    END IF;

    -- reset step
    UPDATE public.package_steps
       SET status = 'queued', last_error = NULL, updated_at = now(),
           meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('council_resume_at', now(), 'council_resume_by', v_admin)
     WHERE package_id = v_pkg AND step_key = 'quality_council';

    -- DEDUPE: reuse vs insert
    SELECT id INTO v_existing_job
    FROM public.job_queue
    WHERE package_id = v_pkg
      AND job_type = 'package_quality_council'
      AND status IN ('pending','queued','processing')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_job IS NOT NULL THEN
      UPDATE public.job_queue
         SET status = 'pending',
             run_after = now(),
             priority = GREATEST(COALESCE(priority,5), 5),
             attempts = 0,
             last_error_code = NULL,
             last_error_message = NULL,
             locked_by = NULL,
             locked_at = NULL,
             last_heartbeat_at = NULL,
             liveness_status = 'healthy',
             updated_at = now(),
             payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object(
               'source','admin_resolve_council_deferred',
               'admin_id', v_admin,
               'resumed_at', now(),
               'manual_resume', true
             )
       WHERE id = v_existing_job
       RETURNING id INTO v_job_id;

      package_id := v_pkg; action := 'reused_active_job'; job_id := v_job_id; note := 'dedupe_hit';
    ELSE
      INSERT INTO public.job_queue (package_id, job_type, status, payload, created_at, updated_at)
      VALUES (v_pkg, 'package_quality_council', 'pending',
              jsonb_build_object('source','admin_resolve_council_deferred','admin_id', v_admin, 'manual_resume', true),
              now(), now())
      RETURNING id INTO v_job_id;

      package_id := v_pkg; action := 'new_job_inserted'; job_id := v_job_id; note := 'no_active_job';
    END IF;

    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES ('admin_resolve_council_deferred', 'package', v_pkg::text, 'success',
      jsonb_build_object('action', action, 'job_id', v_job_id, 'reason', p_reason, 'admin_id', v_admin));

    RETURN NEXT;
  END LOOP;
END;
$function$;