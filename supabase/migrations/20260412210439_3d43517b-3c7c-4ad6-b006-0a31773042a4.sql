
-- Central guardrail logging helper
CREATE OR REPLACE FUNCTION public.fn_log_guardrail_event(
  p_guard_key text,
  p_details jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.ops_guardrail_events (guard_key, details)
  VALUES (p_guard_key, COALESCE(p_details, '{}'::jsonb));
END;
$$;

-- FIX 1: fn_guard_ghost_completion
CREATE OR REPLACE FUNCTION public.fn_guard_ghost_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'done'
     AND COALESCE(NEW.meta->>'executed', 'false') <> 'true' THEN

    PERFORM public.fn_log_guardrail_event(
      'ghost_completion',
      jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'reason', 'DONE_WITHOUT_EXECUTED_TRUE',
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

-- FIX 2: fn_guard_integrity_requires_execution
CREATE OR REPLACE FUNCTION public.fn_guard_integrity_requires_execution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.step_key = 'run_integrity_check'
     AND NEW.status = 'done'
     AND (
       COALESCE(NEW.meta->>'executed', 'false') <> 'true'
       OR COALESCE(NEW.meta->>'ok', 'false') <> 'true'
     ) THEN

    PERFORM public.fn_log_guardrail_event(
      'integrity_requires_execution',
      jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'reason', 'INTEGRITY_DONE_WITHOUT_EXECUTED_AND_OK',
        'old_status', COALESCE(OLD.status, null),
        'new_status', NEW.status,
        'meta_ok', NEW.meta->>'ok',
        'meta_executed', NEW.meta->>'executed',
        'trigger_op', TG_OP
      )
    );

    RAISE EXCEPTION
      USING MESSAGE = format(
        'integrity execution guard blocked package_id=%s step_key=%s',
        NEW.package_id, NEW.step_key
      ),
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- FIX 3: fn_guard_quality_council_requires_execution
CREATE OR REPLACE FUNCTION public.fn_guard_quality_council_requires_execution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.step_key = 'quality_council'
     AND NEW.status = 'done'
     AND (
       COALESCE(NEW.meta->>'executed', 'false') <> 'true'
       OR COALESCE(NEW.meta->>'ok', 'false') <> 'true'
     ) THEN

    PERFORM public.fn_log_guardrail_event(
      'quality_council_requires_execution',
      jsonb_build_object(
        'package_id', NEW.package_id,
        'step_key', NEW.step_key,
        'reason', 'COUNCIL_DONE_WITHOUT_EXECUTED_AND_OK',
        'old_status', COALESCE(OLD.status, null),
        'new_status', NEW.status,
        'meta_ok', NEW.meta->>'ok',
        'meta_executed', NEW.meta->>'executed',
        'trigger_op', TG_OP
      )
    );

    RAISE EXCEPTION
      USING MESSAGE = format(
        'quality council execution guard blocked package_id=%s step_key=%s',
        NEW.package_id, NEW.step_key
      ),
      ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
