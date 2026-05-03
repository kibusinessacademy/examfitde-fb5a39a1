
-- 1) Erweiterte Caller-Forensik im Reverter-Guard
CREATE OR REPLACE FUNCTION public.fn_guard_block_building_to_queued_revert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_check jsonb;
  v_source text;
  v_recent_audit timestamptz;
  v_pid int := pg_backend_pid();
  v_query text;
  v_app text;
  v_user text;
  v_client_addr text;
BEGIN
  IF NOT (OLD.status = 'building' AND NEW.status = 'queued') THEN RETURN NEW; END IF;
  IF current_setting('session_replication_role', true) = 'replica' THEN RETURN NEW; END IF;

  v_source := COALESCE(current_setting('app.transition_source', true), 'unknown_trigger');
  IF v_source IN ('admin_manual','admin_soft_reset','admin_force_rebuild','admin_force_publish') THEN
    RETURN NEW;
  END IF;

  v_check := public.fn_package_demote_protected(NEW.id);

  IF (v_check->>'protected')::boolean THEN
    SELECT max(created_at) INTO v_recent_audit
      FROM public.auto_heal_log
     WHERE target_id = NEW.id::text
       AND action_type = 'guard_block_building_revert'
       AND created_at > now() - interval '15 minutes';

    IF v_recent_audit IS NULL THEN
      BEGIN
        SELECT query, application_name, usename, client_addr::text
          INTO v_query, v_app, v_user, v_client_addr
          FROM pg_stat_activity WHERE pid = v_pid;
      EXCEPTION WHEN OTHERS THEN NULL; END;

      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, trigger_source,
         result_status, result_detail, metadata)
      VALUES (
        'guard_block_building_revert', 'package', NEW.id::text, v_source,
        'blocked',
        format('Blocked building→queued revert (approved=%s progress=%s tail=%s) [throttled 15min]',
          v_check->>'approved_questions', v_check->>'build_progress', v_check->>'pending_tail_jobs'),
        jsonb_build_object(
          'protection', v_check,
          'transition_source', v_source,
          'attempted_at', now(),
          'backend_pid', v_pid,
          'caller_query', left(coalesce(v_query,''), 500),
          'application_name', v_app,
          'usename', v_user,
          'client_addr', v_client_addr,
          'throttle_window', '15 minutes'
        )
      );
    END IF;

    NEW.status := 'building';
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$function$;

-- 2) Force-Publish Admin-Action
CREATE OR REPLACE FUNCTION public.admin_force_publish_package(
  p_package_id uuid,
  p_reason text DEFAULT 'manual_force_publish'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg record;
  v_cancelled int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT id, title, status, build_progress, is_published, curriculum_id
    INTO v_pkg FROM course_packages WHERE id = p_package_id;
  IF v_pkg IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;
  IF v_pkg.is_published THEN
    RETURN jsonb_build_object('ok', true, 'already_published', true, 'package_id', p_package_id);
  END IF;

  PERFORM set_config('app.transition_source', 'admin_force_publish', true);

  -- Cancel offene Jobs
  WITH cx AS (
    UPDATE job_queue
       SET status='cancelled', completed_at=now(),
           last_error='admin_force_publish: package manually published'
     WHERE package_id = p_package_id
       AND status IN ('pending','queued','processing','running','batch_pending','retry_scheduled')
     RETURNING 1
  ) SELECT count(*) INTO v_cancelled FROM cx;

  -- Tail-Steps schliessen
  UPDATE package_steps
     SET status='done'::step_status, finished_at=now(),
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('force_published_at', now()::text, 'reason', p_reason)
   WHERE package_id = p_package_id
     AND step_key IN ('auto_publish','quality_council','run_integrity_check')
     AND status NOT IN ('done'::step_status,'skipped'::step_status);

  UPDATE course_packages
     SET status = 'published',
         is_published = true,
         published_at = COALESCE(published_at, now()),
         blocked_reason = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE id = p_package_id;

  INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('admin_force_publish','admin_force_publish','package', p_package_id::text,'applied',
          format('Force-published package "%s" (was status=%s, progress=%s, reason=%s)',
                 v_pkg.title, v_pkg.status, v_pkg.build_progress, p_reason),
          jsonb_build_object('package_id', p_package_id, 'reason', p_reason,
                             'cancelled_jobs', v_cancelled, 'previous_status', v_pkg.status,
                             'build_progress', v_pkg.build_progress, 'admin_user', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'cancelled_jobs', v_cancelled);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_publish_package(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_force_publish_package(uuid, text) TO authenticated;
