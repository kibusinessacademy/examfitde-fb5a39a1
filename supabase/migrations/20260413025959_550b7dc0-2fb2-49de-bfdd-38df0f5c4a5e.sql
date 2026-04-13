
CREATE OR REPLACE FUNCTION public.fn_guard_ghost_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Guard gilt NUR für echte Erfolgsfinalisierung (done).
  -- "skipped" ist ein valider terminaler Status und braucht kein meta.ok.
  -- "failed", "queued", "running" sind ebenfalls nicht guard-relevant.
  IF NEW.status = 'done'
     AND COALESCE(NEW.meta->>'ok', 'false') <> 'true' THEN

    PERFORM public.fn_log_guardrail_event(
      'ghost_completion',
      jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'reason', 'DONE_WITHOUT_OK_TRUE',
        'old_status', COALESCE(OLD.status, null),
        'new_status', NEW.status,
        'meta_ok', NEW.meta->>'ok',
        'meta_executed', NEW.meta->>'executed',
        'trigger_op', TG_OP
      )
    );

    RAISE EXCEPTION
      USING MESSAGE = format(
        'ghost completion blocked for package_id=%s step_key=%s',
        NEW.package_id, NEW.step_key
      ),
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
