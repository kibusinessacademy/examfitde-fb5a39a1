
-- 1) Fix fn_hard_block_building_to_queued: use existing auto_heal_log columns
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
    'auto_heal_building_zombies'
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

-- 2) Ensure hard-block fires FIRST (alphabetical: 'aaa_' prefix)
DROP TRIGGER IF EXISTS trg_hard_block_building_to_queued ON public.course_packages;
CREATE TRIGGER aaa_hard_block_building_to_queued
BEFORE UPDATE ON public.course_packages
FOR EACH ROW
EXECUTE FUNCTION public.fn_hard_block_building_to_queued();

-- 3) Admin RPC: hard_block events for last N hours
CREATE OR REPLACE FUNCTION public.admin_get_hard_block_events(
  p_hours integer DEFAULT 24,
  p_limit integer DEFAULT 500
)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  package_id text,
  transition_source text,
  block_reason text,
  application_name text,
  usename text,
  client_addr text,
  caller_query text,
  package_title text,
  package_status text,
  build_progress integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    l.id,
    l.created_at,
    l.target_id AS package_id,
    (l.metadata->>'transition_source')::text,
    (l.metadata->>'block_reason')::text,
    (l.metadata->>'application_name')::text,
    (l.metadata->>'usename')::text,
    (l.metadata->>'client_addr')::text,
    (l.metadata->>'caller_query')::text,
    cp.title,
    cp.status,
    cp.build_progress
  FROM public.auto_heal_log l
  LEFT JOIN public.course_packages cp ON cp.id::text = l.target_id
  WHERE l.action_type = 'hard_block_building_to_queued'
    AND l.created_at > now() - make_interval(hours => GREATEST(p_hours, 1))
    AND public.has_role(auth.uid(), 'admin')
  ORDER BY l.created_at DESC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.admin_get_hard_block_events(integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_hard_block_events(integer,integer) TO authenticated, service_role;

-- 4) DB self-test for the hard-block trigger (admin-only)
CREATE OR REPLACE FUNCTION public.admin_test_hard_block_building_to_queued()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pkg uuid;
  v_err text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  -- create a sandbox package in 'building'
  INSERT INTO public.course_packages(id, title, status, package_key)
  VALUES (gen_random_uuid(),
          '__hard_block_test__'||substr(gen_random_uuid()::text,1,8),
          'building',
          'hard_block_test_'||substr(gen_random_uuid()::text,1,8))
  RETURNING id INTO v_pkg;

  -- T1: no source → must block
  BEGIN
    PERFORM set_config('app.transition_source', '', true);
    UPDATE public.course_packages SET status='queued' WHERE id=v_pkg;
    test_name := 'T1_no_source_blocked'; passed := false; detail := 'expected RAISE'; RETURN NEXT;
  EXCEPTION WHEN check_violation THEN
    test_name := 'T1_no_source_blocked'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  -- T2: non-whitelisted source → must block
  BEGIN
    PERFORM set_config('app.transition_source', 'random_runtime_caller', true);
    UPDATE public.course_packages SET status='queued' WHERE id=v_pkg;
    test_name := 'T2_non_whitelisted_blocked'; passed := false; detail := 'expected RAISE'; RETURN NEXT;
  EXCEPTION WHEN check_violation THEN
    test_name := 'T2_non_whitelisted_blocked'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  -- T3: whitelisted source on unprotected pkg → allowed
  BEGIN
    PERFORM set_config('app.transition_source', 'admin_reset', true);
    UPDATE public.course_packages SET status='queued' WHERE id=v_pkg;
    test_name := 'T3_whitelisted_allowed'; passed := true; detail := 'transition succeeded'; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
    test_name := 'T3_whitelisted_allowed'; passed := false; detail := SQLERRM; RETURN NEXT;
  END;

  -- reset to building for T4
  UPDATE public.course_packages SET status='building', build_progress=100 WHERE id=v_pkg;

  -- T4: protected package + whitelisted source → must still block
  BEGIN
    PERFORM set_config('app.transition_source', 'admin_reset', true);
    UPDATE public.course_packages SET status='queued' WHERE id=v_pkg;
    test_name := 'T4_protected_always_blocked'; passed := false; detail := 'expected RAISE on protected pkg'; RETURN NEXT;
  EXCEPTION WHEN check_violation THEN
    test_name := 'T4_protected_always_blocked'; passed := true; detail := SQLERRM; RETURN NEXT;
  END;

  -- cleanup
  DELETE FROM public.auto_heal_log WHERE target_id = v_pkg::text;
  DELETE FROM public.course_packages WHERE id = v_pkg;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_test_hard_block_building_to_queued() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_test_hard_block_building_to_queued() TO authenticated, service_role;
