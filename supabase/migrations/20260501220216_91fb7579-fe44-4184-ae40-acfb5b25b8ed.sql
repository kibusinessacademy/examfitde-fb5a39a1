-- 1) Worker-Pool aufstocken
UPDATE worker_scaling_policies
SET max_workers = 16,
    scale_up_pending_threshold = 4,
    scale_down_pending_threshold = 1,
    scale_up_cooldown_seconds = 60,
    updated_at = now()
WHERE worker_key = 'pipeline-runner';

UPDATE worker_scaling_policies
SET max_workers = 20,
    scale_up_pending_threshold = 6,
    scale_up_cooldown_seconds = 60,
    updated_at = now()
WHERE worker_key = 'content-runner';

-- 2) Atomic-Trigger mit Debounce + Audit
CREATE OR REPLACE FUNCTION public.fn_atomic_enqueue_on_step_queued()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_type text;
  v_existing_job_count int;
  v_curriculum_id uuid;
  v_pkg_status text;
  v_enqueue_result record;
  v_has_unmet_deps boolean;
  v_last_attempt timestamptz;
  v_debounce_window interval := interval '60 seconds';
BEGIN
  IF NEW.status <> 'queued'::step_status THEN RETURN NEW; END IF;

  SELECT cp.curriculum_id, cp.status::text INTO v_curriculum_id, v_pkg_status
  FROM course_packages cp WHERE cp.id = NEW.package_id;

  IF v_pkg_status NOT IN ('building','quality_gate_failed') THEN
    RETURN NEW;
  END IF;

  SELECT sjm.job_types[1] INTO v_job_type
  FROM step_job_mapping sjm
  WHERE sjm.step_key = NEW.step_key AND array_length(sjm.job_types, 1) > 0;
  IF v_job_type IS NULL THEN RETURN NEW; END IF;

  -- DEBOUNCE: Skip wenn letzter Atomic-Enqueue-Versuch < 60s her
  v_last_attempt := (NEW.meta->>'last_atomic_enqueue_at')::timestamptz;
  IF v_last_attempt IS NOT NULL AND (now() - v_last_attempt) < v_debounce_window THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('atomic_enqueue_debounced', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'skipped',
            'Debounce window active (' || EXTRACT(EPOCH FROM (now() - v_last_attempt))::int || 's < 60s)',
            jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'job_type', v_job_type));
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_existing_job_count
  FROM job_queue jq
  WHERE jq.package_id = NEW.package_id
    AND jq.job_type = v_job_type
    AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled');
  IF v_existing_job_count > 0 THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'queued'::step_status THEN
    IF (NEW.meta->>'allow_regression')::boolean IS NOT TRUE 
       AND (NEW.meta->>'reset_reason') IS NULL
       AND (NEW.meta->>'wave') IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM step_dag_edges dag
    JOIN package_steps dep ON dep.package_id = NEW.package_id AND dep.step_key = dag.depends_on
    WHERE dag.step_key = NEW.step_key
      AND dep.status NOT IN ('done'::step_status,'skipped'::step_status)
  ) INTO v_has_unmet_deps;
  IF v_has_unmet_deps THEN RETURN NEW; END IF;

  BEGIN
    SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
      v_job_type, NEW.package_id, 0, 3, now(),
      jsonb_build_object('package_id', NEW.package_id, 'curriculum_id', v_curriculum_id, 'step_key', NEW.step_key)
    );
    IF v_enqueue_result.created THEN
      -- Stempel den Enqueue-Zeitpunkt
      NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object('last_atomic_enqueue_at', now());
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('atomic_step_enqueue', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'enqueued',
              'Auto-enqueued ' || v_job_type || ' for step ' || NEW.step_key,
              jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'job_type', v_job_type));
      RETURN NEW;
    END IF;
    NEW.status := 'pending_enqueue'::step_status;
    NEW.last_error := COALESCE(v_enqueue_result.status, 'enqueue_rejected');
    NEW.attempts := COALESCE(NEW.attempts, 0) + 1;
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object('last_atomic_enqueue_at', now());
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('atomic_step_enqueue', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'error',
            'Trigger exception: ' || SQLERRM,
            jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'sqlstate', SQLSTATE));
  END;
  RETURN NEW;
END;
$function$;