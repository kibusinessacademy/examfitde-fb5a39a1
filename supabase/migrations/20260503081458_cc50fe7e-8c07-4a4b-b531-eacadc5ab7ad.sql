
CREATE OR REPLACE FUNCTION public.fn_hard_block_building_to_queued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source       text;
  v_whitelist    text[] := ARRAY[
    'admin_soft_reentry',
    'admin_rebuild',
    'admin_reset',
    'admin_force_publish',
    'admin_ui_reset',
    'admin_nudge_atomic_trigger',
    'admin_heal_pending_enqueue_drift',
    'admin_bulk_promote_queued_to_building',
    'admin_bulk_promote_content_deficient_packages'
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
  -- Replica/restore bypass
  IF current_setting('session_replication_role', true) = 'replica' THEN
    RETURN NEW;
  END IF;

  -- Only intercept building → queued
  IF NOT (OLD.status = 'building' AND NEW.status = 'queued') THEN
    RETURN NEW;
  END IF;

  v_source := COALESCE(NULLIF(current_setting('app.transition_source', true), ''), 'unknown_trigger');

  BEGIN
    v_protected := public.fn_package_demote_protected(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    v_protected := false;
  END;

  -- Decide block reason
  IF v_protected THEN
    v_block_reason := 'protected_package';
  ELSIF NOT (v_source = ANY(v_whitelist)) THEN
    v_block_reason := 'source_not_whitelisted';
  ELSE
    -- Whitelisted + not protected → allow
    RETURN NEW;
  END IF;

  -- Forensic context
  v_pid := pg_backend_pid();
  SELECT application_name, usename, host(client_addr), query
    INTO v_app_name, v_usename, v_client_addr, v_caller_query
    FROM pg_stat_activity
   WHERE pid = v_pid
   LIMIT 1;

  -- Throttled audit (1×/15min/package)
  SELECT MAX(created_at) INTO v_recent_log
    FROM public.auto_heal_log
   WHERE action_type = 'hard_block_building_to_queued'
     AND target_id = NEW.id::text
     AND created_at > now() - interval '15 minutes';

  IF v_recent_log IS NULL THEN
    INSERT INTO public.auto_heal_log(
      action_type, trigger_source, target_type, target_id,
      result_status, reason_code, before_state, after_state, metadata
    ) VALUES (
      'hard_block_building_to_queued',
      v_source,
      'course_package',
      NEW.id::text,
      'blocked',
      v_block_reason,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('attempted_status', NEW.status),
      jsonb_build_object(
        'transition_source', v_source,
        'block_reason', v_block_reason,
        'protected', v_protected,
        'application_name', v_app_name,
        'usename', v_usename,
        'client_addr', v_client_addr,
        'caller_query', LEFT(COALESCE(v_caller_query, ''), 2000),
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
$$;

DROP TRIGGER IF EXISTS trg_hard_block_building_to_queued ON public.course_packages;

CREATE TRIGGER trg_hard_block_building_to_queued
BEFORE UPDATE OF status ON public.course_packages
FOR EACH ROW
WHEN (OLD.status = 'building' AND NEW.status = 'queued')
EXECUTE FUNCTION public.fn_hard_block_building_to_queued();

COMMENT ON FUNCTION public.fn_hard_block_building_to_queued() IS
  'DB Hard-Block: building→queued nur mit whitelisted app.transition_source UND nur wenn Paket nicht protected. Audit throttled 1x/15min/package. Bypass nur via session_replication_role=replica.';
