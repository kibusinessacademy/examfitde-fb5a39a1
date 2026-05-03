-- Trace AFTER trigger: capture every transition INTO pending_enqueue with full forensics
-- (pg_trigger_depth, backend_pid, top-level query, txid, session_user, application_name)

CREATE OR REPLACE FUNCTION public.fn_trace_pending_enqueue_revert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depth int := pg_trigger_depth();
  v_pid int := pg_backend_pid();
  v_query text;
  v_app text;
  v_user text;
  v_txid bigint;
BEGIN
  -- Only trace transitions INTO pending_enqueue from a non-pending_enqueue prior state
  IF NEW.status::text <> 'pending_enqueue' THEN
    RETURN NULL;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NULL;
  END IF;

  BEGIN
    SELECT query, application_name, usename, COALESCE(backend_xid::text::bigint, 0)
      INTO v_query, v_app, v_user, v_txid
    FROM pg_stat_activity
    WHERE pid = v_pid;
  EXCEPTION WHEN OTHERS THEN
    v_query := NULL;
  END;

  INSERT INTO auto_heal_log(
    action_type, target_type, target_id, result_status, metadata
  ) VALUES (
    'pending_enqueue_revert_trace',
    'package_step',
    NEW.id::text,
    'observed',
    jsonb_build_object(
      'package_id', NEW.package_id,
      'step_key', NEW.step_key,
      'old_status', OLD.status,
      'new_status', NEW.status,
      'trigger_depth', v_depth,
      'backend_pid', v_pid,
      'session_user', v_user,
      'application_name', v_app,
      'caller_query', LEFT(COALESCE(v_query, ''), 4000),
      'txid', v_txid,
      'observed_at', now()
    )
  );

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- never break the parent statement
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trace_pending_enqueue_revert ON public.package_steps;

CREATE TRIGGER trg_trace_pending_enqueue_revert
AFTER UPDATE OF status ON public.package_steps
FOR EACH ROW
WHEN (NEW.status = 'pending_enqueue'::step_status
      AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.fn_trace_pending_enqueue_revert();

COMMENT ON FUNCTION public.fn_trace_pending_enqueue_revert() IS
'Forensik-Trace: loggt jede Rückkehr von package_steps.status -> pending_enqueue mit pg_trigger_depth, backend_pid, caller_query, txid in auto_heal_log (action_type=pending_enqueue_revert_trace). Identifiziert den Reverter (Trigger-Tiefe >0 = nested call, =0 = direkter SQL-Producer).';