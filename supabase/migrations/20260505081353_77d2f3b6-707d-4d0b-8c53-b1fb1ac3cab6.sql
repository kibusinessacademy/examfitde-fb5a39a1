-- 1) Explicit helper for direct producer instrumentation
CREATE OR REPLACE FUNCTION public.fn_log_bronze_locked_enqueue_blocked(
  p_package_id uuid,
  p_job_type text,
  p_enqueue_source text DEFAULT NULL,
  p_caller text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_app text; v_pid int; v_query text;
BEGIN
  SELECT application_name, pid, left(query, 500)
    INTO v_app, v_pid, v_query
  FROM pg_stat_activity WHERE pid = pg_backend_pid();

  INSERT INTO auto_heal_log(
    action_type, trigger_source, target_type, target_id,
    result_status, result_detail, metadata
  )
  VALUES (
    'bronze_locked_enqueue_blocked',
    COALESCE(p_caller, p_enqueue_source, 'unknown'),
    'package', p_package_id::text,
    'blocked',
    'Bronze-locked package enqueue blocked',
    jsonb_build_object(
      'job_type', p_job_type,
      'enqueue_source', COALESCE(NULLIF(p_enqueue_source,''), 'missing'),
      'caller', COALESCE(p_caller, 'unknown'),
      'application_name', v_app,
      'backend_pid', v_pid,
      'caller_query', v_query,
      'payload_keys', (
        SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
        FROM jsonb_object_keys(COALESCE(p_payload, '{}'::jsonb)) AS k
      ),
      'created_by', 'bronze_blocked_producer_tracker_v1'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_log_bronze_locked_enqueue_blocked(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_log_bronze_locked_enqueue_blocked(uuid,text,text,text,jsonb) TO service_role;

-- 2) Enrich the trigger with caller forensics (block behaviour unchanged)
CREATE OR REPLACE FUNCTION public.fn_guard_bronze_lock_on_job_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_locked boolean; v_source text; v_pkg_id uuid;
  v_app text; v_pid int; v_query text;
  v_payload_keys jsonb;
BEGIN
  IF NEW.job_type NOT IN ('package_quality_council','package_auto_publish','package_run_integrity_check') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IN ('queued','pending','processing') AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('queued','pending','processing') THEN RETURN NEW; END IF;
  v_pkg_id := COALESCE(NEW.package_id, NULLIF(NEW.payload->>'package_id','')::uuid);
  IF v_pkg_id IS NULL THEN RETURN NEW; END IF;
  SELECT public.fn_is_bronze_locked(v_pkg_id) INTO v_locked;
  IF NOT v_locked THEN RETURN NEW; END IF;
  v_source := COALESCE(
    NEW.payload->>'enqueue_source', NEW.meta->>'enqueue_source',
    NEW.meta->>'source', NEW.payload->>'source',
    NEW.payload->>'_origin', NEW.payload->>'mode', 'unknown');
  IF v_source = 'bronze_targeted_repair' THEN RETURN NEW; END IF;
  IF (NEW.payload->>'bronze_lock_override')::boolean = true THEN
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_lock_admin_override',
            v_pkg_id::text,'package','success',
            format('Admin override: %s', NEW.job_type),
            jsonb_build_object('package_id', v_pkg_id, 'job_type', NEW.job_type, 'enqueue_source', v_source));
    RETURN NEW;
  END IF;

  -- Forensic capture
  SELECT application_name, pid, left(query, 500)
    INTO v_app, v_pid, v_query
  FROM pg_stat_activity WHERE pid = pg_backend_pid();

  v_payload_keys := (
    SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
    FROM jsonb_object_keys(COALESCE(NEW.payload, '{}'::jsonb)) AS k
  );

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('fn_guard_bronze_lock_on_job_enqueue','bronze_locked_enqueue_blocked',
          v_pkg_id::text,'package','skipped',
          format('Bronze lock — %s rejected (source=%s)', NEW.job_type, v_source),
          jsonb_build_object(
            'package_id', v_pkg_id,
            'job_type', NEW.job_type,
            'enqueue_source', v_source,
            'tg_op', TG_OP,
            'skipped_reason','BRONZE_LOCKED_REQUIRES_REVIEW',
            'application_name', v_app,
            'backend_pid', v_pid,
            'caller_query', v_query,
            'payload_keys', v_payload_keys,
            'meta_keys', (
              SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)
              FROM jsonb_object_keys(COALESCE(NEW.meta, '{}'::jsonb)) AS k
            ),
            'created_by','bronze_blocked_producer_tracker_v1'
          ));
  IF TG_OP = 'INSERT' THEN
    RETURN NULL;
  ELSE
    NEW.status := 'cancelled';
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.last_error := 'BRONZE_LOCKED_REQUIRES_REVIEW';
    NEW.result := COALESCE(NEW.result, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by','bronze_lock_guard','reason','BRONZE_LOCKED_REQUIRES_REVIEW',
      'enqueue_source', v_source);
    RETURN NEW;
  END IF;
END;
$function$;