
-- 1) Whitelist im Hard-Block-Trigger erweitern, damit interne, geprüfte Producer
--    (Stuck-Scan-Zombie, Stuck-Scan-Normalize, Pipeline-Watchdog) zugelassen
--    werden, wenn das Paket nicht protected ist.
CREATE OR REPLACE FUNCTION public.fn_hard_block_building_to_queued()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source       text;
  v_whitelist    text[] := ARRAY[
    'admin_soft_reentry','admin_rebuild','admin_reset','admin_force_publish',
    'admin_ui_reset','admin_nudge_atomic_trigger','admin_heal_pending_enqueue_drift',
    'admin_bulk_promote_queued_to_building','admin_bulk_promote_content_deficient_packages',
    'auto_heal_building_zombies',
    -- Neue interne Producer (immer hinter Protection-Gate):
    'stuck_scan_zombie','stuck_scan_normalize','pipeline_watchdog_zombie_revert'
  ];
  v_protected    boolean := false;
  v_app_name     text;
  v_usename      text;
  v_client_addr  text;
  v_caller_query text;
  v_pid          integer;
  v_recent_log   timestamptz;
  v_block_reason text;
BEGIN
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;
  IF NOT (OLD.status = 'building' AND NEW.status = 'queued') THEN
    RETURN NEW;
  END IF;

  v_source := COALESCE(NULLIF(current_setting('app.transition_source', true), ''), 'unknown_trigger');

  BEGIN
    v_protected := public.fn_package_demote_protected(NEW.id);
  EXCEPTION WHEN OTHERS THEN v_protected := false;
  END;

  IF v_protected THEN
    v_block_reason := 'protected_package';
  ELSIF NOT (v_source = ANY(v_whitelist)) THEN
    v_block_reason := 'source_not_whitelisted';
  ELSE
    RETURN NEW;
  END IF;

  v_pid := pg_backend_pid();
  SELECT application_name, usename, host(client_addr), query
    INTO v_app_name, v_usename, v_client_addr, v_caller_query
    FROM pg_stat_activity WHERE pid = v_pid LIMIT 1;

  SELECT MAX(created_at) INTO v_recent_log
    FROM public.auto_heal_log
   WHERE action_type='hard_block_building_to_queued'
     AND target_id = NEW.id::text
     AND created_at > now() - interval '15 minutes';

  IF v_recent_log IS NULL THEN
    INSERT INTO public.auto_heal_log(
      action_type, trigger_source, target_type, target_id,
      result_status, result_detail, metadata
    ) VALUES (
      'hard_block_building_to_queued', v_source, 'course_package', NEW.id::text,
      'blocked', v_block_reason,
      jsonb_build_object(
        'transition_source', v_source,
        'block_reason', v_block_reason,
        'protected', v_protected,
        'application_name', v_app_name,
        'usename', v_usename,
        'client_addr', v_client_addr,
        'caller_query', LEFT(COALESCE(v_caller_query,''), 2000),
        'backend_pid', v_pid,
        'package_status_old', OLD.status,
        'package_status_new', NEW.status
      )
    );
  END IF;

  RAISE EXCEPTION
    'HARD_BLOCK_BUILDING_TO_QUEUED: package=% reason=% source=% app=% user=% addr=%',
    NEW.id, v_block_reason, v_source, COALESCE(v_app_name,''), COALESCE(v_usename,''), COALESCE(v_client_addr,'')
    USING ERRCODE = 'check_violation';
END;
$function$;

-- 2) Sichere RPC: einziger erlaubter Pfad für Edge-Producer, um building→queued
--    zu demoten. Setzt LOCAL app.transition_source auf eine Whitelist-Quelle,
--    ruft fn_package_demote_protected, und schreibt nur dann zurück.
CREATE OR REPLACE FUNCTION public.admin_revert_building_to_queued(
  p_package_ids uuid[],
  p_source      text,
  p_last_error  text DEFAULT NULL,
  p_clear_stuck boolean DEFAULT true
)
RETURNS TABLE(package_id uuid, action text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'stuck_scan_zombie','stuck_scan_normalize','pipeline_watchdog_zombie_revert'
  ];
  v_id uuid;
  v_protected boolean;
  v_status text;
BEGIN
  IF p_source IS NULL OR NOT (p_source = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'admin_revert_building_to_queued: source % not allowed', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.transition_source', p_source, true);

  FOREACH v_id IN ARRAY COALESCE(p_package_ids, ARRAY[]::uuid[]) LOOP
    SELECT status INTO v_status FROM course_packages WHERE id = v_id;
    IF v_status IS NULL THEN
      package_id := v_id; action := 'skipped'; reason := 'not_found'; RETURN NEXT; CONTINUE;
    END IF;
    IF v_status <> 'building' THEN
      package_id := v_id; action := 'skipped'; reason := 'not_building:'||v_status; RETURN NEXT; CONTINUE;
    END IF;

    BEGIN
      v_protected := fn_package_demote_protected(v_id);
    EXCEPTION WHEN OTHERS THEN v_protected := false;
    END;
    IF v_protected THEN
      package_id := v_id; action := 'protected'; reason := 'demote_protected'; RETURN NEXT; CONTINUE;
    END IF;

    UPDATE course_packages
       SET status = 'queued',
           updated_at = now(),
           last_error = COALESCE(p_last_error, last_error),
           stuck_reason = CASE WHEN p_clear_stuck THEN NULL ELSE stuck_reason END
     WHERE id = v_id AND status = 'building';

    package_id := v_id; action := 'reverted'; reason := p_source; RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revert_building_to_queued(uuid[], text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revert_building_to_queued(uuid[], text, text, boolean) TO service_role;
