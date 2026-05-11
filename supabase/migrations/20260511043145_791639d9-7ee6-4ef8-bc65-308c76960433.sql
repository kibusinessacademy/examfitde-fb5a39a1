
-- Extend whitelist of allowed transition sources for building->queued
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
    'stuck_scan_zombie','stuck_scan_normalize','pipeline_watchdog_zombie_revert',
    -- P0 phantom-WIP heal
    'admin_heal_phantom_building_packages'
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

-- Update RPC to set transition_source GUC before each UPDATE + skip protected packages
CREATE OR REPLACE FUNCTION public.admin_heal_phantom_building_packages(
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 200
)
RETURNS TABLE (
  package_id uuid,
  package_key text,
  action text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count  int  := 0;
  v_skipped int := 0;
  v_rec    record;
  v_protected boolean;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  -- Set transition source for the whole transaction
  PERFORM set_config('app.transition_source', 'admin_heal_phantom_building_packages', true);

  FOR v_rec IN
    SELECT v.package_id, v.package_key, v.bronze_locked, v.last_active_job_at
    FROM public.v_phantom_building_packages v
    ORDER BY v.package_updated_at ASC
    LIMIT p_limit
  LOOP
    IF v_rec.bronze_locked THEN
      package_id := v_rec.package_id;
      package_key := v_rec.package_key;
      action := 'skip';
      reason := 'bronze_locked';
      v_skipped := v_skipped + 1;
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      v_protected := public.fn_package_demote_protected(v_rec.package_id);
    EXCEPTION WHEN OTHERS THEN v_protected := false;
    END;

    IF v_protected THEN
      package_id := v_rec.package_id;
      package_key := v_rec.package_key;
      action := 'skip';
      reason := 'demote_protected';
      v_skipped := v_skipped + 1;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      package_id := v_rec.package_id;
      package_key := v_rec.package_key;
      action := 'would_demote';
      reason := 'phantom_building_no_lease_no_jobs_6h';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      UPDATE public.course_packages
         SET status = 'queued',
             updated_at = now()
       WHERE id = v_rec.package_id
         AND status = 'building';

      INSERT INTO public.auto_heal_log(
        action_type, target_type, target_id, result_status, metadata
      ) VALUES (
        'phantom_building_demote',
        'package',
        v_rec.package_id::text,
        'success',
        jsonb_build_object(
          'package_key', v_rec.package_key,
          'last_active_job_at', v_rec.last_active_job_at,
          'reason', 'phantom_building_no_lease_no_jobs_6h',
          'transition', 'building->queued',
          'transition_source', 'admin_heal_phantom_building_packages'
        )
      );

      v_count := v_count + 1;
      package_id := v_rec.package_id;
      package_key := v_rec.package_key;
      action := 'demoted';
      reason := 'phantom_building_no_lease_no_jobs_6h';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      package_id := v_rec.package_id;
      package_key := v_rec.package_key;
      action := 'error';
      reason := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'phantom_building_heal_run',
    'system',
    CASE WHEN v_count > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'demoted_count', v_count,
      'skipped_count', v_skipped,
      'dry_run', p_dry_run,
      'limit', p_limit
    )
  );
END $$;
