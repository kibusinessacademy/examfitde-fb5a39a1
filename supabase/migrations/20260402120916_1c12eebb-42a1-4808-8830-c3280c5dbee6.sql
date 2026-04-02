
-- 1. Replace the regression guard trigger function with hardened version
CREATE OR REPLACE FUNCTION public.guard_step_done_regression()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _allowed_callers text[] := ARRAY[
    'admin_manual',
    'repair_rpc',
    'ops_sweep',
    'recover_and_reenter_package',
    'ops_force_reset'
  ];
  _caller text;
BEGIN
  -- ═══ CASE 1: done → queued/enqueued (regression) ═══
  IF OLD.status = 'done' AND NEW.status IN ('queued', 'enqueued') THEN

    IF (NEW.meta->>'allow_regression')::boolean IS TRUE THEN
      _caller := NEW.meta->>'allow_regression_by';

      IF _caller IS NOT NULL AND _caller = ANY(_allowed_callers) THEN
        NEW.meta := NEW.meta - 'allow_regression' - 'allow_regression_by';

        INSERT INTO public.ops_guardrail_events (guard_key, details)
        VALUES ('regression_permitted', jsonb_build_object(
          'package_id', OLD.package_id,
          'step_key', OLD.step_key,
          'old_status', 'done',
          'new_status', NEW.status,
          'caller', _caller,
          'finished_at_was', OLD.finished_at
        ));

        RETURN NEW;
      END IF;

      NEW.meta := NEW.meta - 'allow_regression' - 'allow_regression_by';
    END IF;

    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('regression_blocked', jsonb_build_object(
      'package_id', OLD.package_id,
      'step_key', OLD.step_key,
      'old_status', 'done',
      'new_status', NEW.status,
      'attempted_caller', NEW.meta->>'allow_regression_by',
      'finished_at_was', OLD.finished_at
    ));

    RAISE EXCEPTION 'STEP_DONE_REGRESSION_BLOCKED: step "%" on package "%" cannot revert from done to %. Requires meta.allow_regression=true + allow_regression_by in [%].',
      OLD.step_key, OLD.package_id, NEW.status, array_to_string(_allowed_callers, ', ');
  END IF;

  -- ═══ CASE 2: done → failed (observability, NOT blocked) ═══
  IF OLD.status = 'done' AND NEW.status = 'failed' THEN
    INSERT INTO public.ops_guardrail_events (guard_key, details)
    VALUES ('done_to_failed', jsonb_build_object(
      'package_id', OLD.package_id,
      'step_key', OLD.step_key,
      'finished_at_was', OLD.finished_at,
      'new_last_error', NEW.last_error
    ));
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Recreate trigger with expanded WHEN clause
DROP TRIGGER IF EXISTS trg_guard_step_done_regression ON public.package_steps;

CREATE TRIGGER trg_guard_step_done_regression
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  WHEN (OLD.status = 'done' AND NEW.status IN ('queued', 'enqueued', 'failed'))
  EXECUTE FUNCTION public.guard_step_done_regression();
