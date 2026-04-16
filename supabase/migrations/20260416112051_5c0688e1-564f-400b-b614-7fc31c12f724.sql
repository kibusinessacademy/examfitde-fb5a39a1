
-- Fix entity_id type cast in trigger functions that write to admin_notifications
-- Both guard_step_failed_requires_reason and fn_guard_step_causality cast package_id::text
-- but entity_id column is UUID type

CREATE OR REPLACE FUNCTION guard_step_failed_requires_reason()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'failed' AND (OLD.status IS DISTINCT FROM 'failed') THEN
    IF COALESCE(NEW.attempts, 0) = 0 AND (NEW.last_error IS NULL OR NEW.last_error = '') THEN
      NEW.last_error := format('GHOST_FAIL_GUARD: status set to failed without execution (prev=%s, at=%s)', 
                               OLD.status, now()::text);
      
      INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
      VALUES (
        format('Ghost-fail detected: %s', NEW.step_key),
        format('Package %s step %s was set to failed without attempts or error. Previous status: %s. Auto-labeled.',
               NEW.package_id::text, NEW.step_key, OLD.status),
        'warning', 'pipeline', 'course_package', NEW.package_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_guard_step_causality()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  unmet_dep TEXT;
BEGIN
  IF NEW.status != 'done' THEN RETURN NEW; END IF;
  IF OLD IS NOT NULL AND OLD.status = 'done' AND NEW.status = 'done' THEN RETURN NEW; END IF;

  SELECT dag.depends_on INTO unmet_dep
  FROM pipeline_dag_edges dag
  JOIN package_steps ps_dep ON ps_dep.package_id = NEW.package_id
                            AND ps_dep.step_key = dag.depends_on
  WHERE dag.step_key = NEW.step_key
    AND ps_dep.status NOT IN ('done', 'skipped')
  LIMIT 1;

  IF unmet_dep IS NOT NULL THEN
    RAISE WARNING 'CAUSALITY_GUARD: Cannot set %.% to done — dep "%" not met. Reverting to queued.',
      NEW.package_id, NEW.step_key, unmet_dep;

    INSERT INTO public.admin_notifications (title, body, severity, category, entity_type, entity_id)
    VALUES (
      'Causality-Guard Revert',
      format('Step "%s" für Paket %s wurde auf queued zurückgesetzt. Unerfüllte Abhängigkeit: "%s".',
             NEW.step_key, NEW.package_id, unmet_dep),
      'warning',
      'pipeline',
      'package_step',
      NEW.package_id
    );

    NEW.status := 'queued';
    NEW.last_error := 'CAUSALITY_BLOCKED: dep ' || unmet_dep || ' not done';
    NEW.job_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;
