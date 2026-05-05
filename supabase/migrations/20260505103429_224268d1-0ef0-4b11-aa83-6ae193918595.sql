
-- 1) Helper: Producer-Pre-Check (idempotent, callable by service_role)
CREATE OR REPLACE FUNCTION public.fn_can_demote_package_status(
  p_package_id uuid,
  p_target_status text,
  p_source text DEFAULT 'unknown'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current text;
  v_protected jsonb;
BEGIN
  SELECT status INTO v_current FROM course_packages WHERE id = p_package_id;
  IF v_current IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'package_not_found');
  END IF;

  -- Admin sources always allowed
  IF p_source IN ('admin_manual','admin_soft_reset','admin_force_rebuild','admin_force_publish') THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'admin_bypass', 'current', v_current);
  END IF;

  -- Published is terminal: no demote without admin
  IF v_current = 'published' AND p_target_status <> 'published' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'published_is_terminal', 'current', v_current);
  END IF;

  -- Building → {queued, blocked, draft}: protected if downstream artifacts exist
  IF v_current = 'building' AND p_target_status IN ('queued','blocked','draft') THEN
    v_protected := public.fn_package_demote_protected(p_package_id);
    IF (v_protected->>'protected')::boolean THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'demote_protected', 'current', v_current, 'protection', v_protected);
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok', 'current', v_current);
END $$;

REVOKE ALL ON FUNCTION public.fn_can_demote_package_status(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_can_demote_package_status(uuid, text, text) TO service_role;

-- 2) Replace narrow trigger with broad version (building→{queued,blocked,draft} + published→*)
DROP TRIGGER IF EXISTS trg_guard_block_building_to_queued_revert ON public.course_packages;

CREATE OR REPLACE FUNCTION public.fn_guard_block_status_revert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_check jsonb;
  v_source text;
  v_recent_audit timestamptz;
  v_pid int := pg_backend_pid();
  v_query text; v_app text; v_user text; v_client_addr text;
  v_is_demote boolean := false;
  v_demote_kind text;
BEGIN
  IF current_setting('session_replication_role', true) = 'replica' THEN RETURN NEW; END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- Identify forbidden demotes
  IF OLD.status = 'building' AND NEW.status IN ('queued','blocked','draft') THEN
    v_is_demote := true; v_demote_kind := 'building_to_' || NEW.status;
  ELSIF OLD.status = 'published' AND NEW.status <> 'published' THEN
    v_is_demote := true; v_demote_kind := 'published_to_' || NEW.status;
  END IF;

  IF NOT v_is_demote THEN RETURN NEW; END IF;

  v_source := COALESCE(current_setting('app.transition_source', true), 'unknown_trigger');

  -- Admin bypass
  IF v_source IN ('admin_manual','admin_soft_reset','admin_force_rebuild','admin_force_publish') THEN
    RETURN NEW;
  END IF;

  -- Published is always terminal for non-admin
  IF OLD.status = 'published' THEN
    -- log + revert
    SELECT max(created_at) INTO v_recent_audit FROM public.auto_heal_log
      WHERE target_id = NEW.id::text AND action_type='guard_block_published_revert'
        AND created_at > now() - interval '15 minutes';
    IF v_recent_audit IS NULL THEN
      BEGIN
        SELECT query, application_name, usename, client_addr::text
          INTO v_query, v_app, v_user, v_client_addr
          FROM pg_stat_activity WHERE pid = v_pid;
      EXCEPTION WHEN OTHERS THEN NULL; END;
      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
      VALUES ('guard_block_published_revert','package', NEW.id::text, v_source, 'blocked',
        format('Blocked published→%s revert', NEW.status),
        jsonb_build_object('demote_kind', v_demote_kind, 'transition_source', v_source,
          'old_status', OLD.status, 'new_status', NEW.status,
          'backend_pid', v_pid, 'caller_query', left(coalesce(v_query,''), 500),
          'application_name', v_app, 'usename', v_user, 'client_addr', v_client_addr));
    END IF;
    NEW.status := OLD.status;
    RETURN NEW;
  END IF;

  -- Building demotes: artifact-aware protection
  v_check := public.fn_package_demote_protected(NEW.id);
  IF (v_check->>'protected')::boolean THEN
    SELECT max(created_at) INTO v_recent_audit FROM public.auto_heal_log
      WHERE target_id = NEW.id::text AND action_type='guard_block_building_revert'
        AND created_at > now() - interval '15 minutes';
    IF v_recent_audit IS NULL THEN
      BEGIN
        SELECT query, application_name, usename, client_addr::text
          INTO v_query, v_app, v_user, v_client_addr
          FROM pg_stat_activity WHERE pid = v_pid;
      EXCEPTION WHEN OTHERS THEN NULL; END;
      INSERT INTO public.auto_heal_log
        (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
      VALUES ('guard_block_building_revert','package', NEW.id::text, v_source, 'blocked',
        format('Blocked %s revert (approved=%s progress=%s tail=%s)',
          v_demote_kind, v_check->>'approved_questions', v_check->>'build_progress', v_check->>'pending_tail_jobs'),
        jsonb_build_object('demote_kind', v_demote_kind, 'protection', v_check, 'transition_source', v_source,
          'old_status', OLD.status, 'new_status', NEW.status,
          'backend_pid', v_pid, 'caller_query', left(coalesce(v_query,''), 500),
          'application_name', v_app, 'usename', v_user, 'client_addr', v_client_addr,
          'throttle_window', '15 minutes'));
    END IF;
    NEW.status := 'building';
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard_block_status_revert
BEFORE UPDATE OF status ON public.course_packages
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.fn_guard_block_status_revert();
