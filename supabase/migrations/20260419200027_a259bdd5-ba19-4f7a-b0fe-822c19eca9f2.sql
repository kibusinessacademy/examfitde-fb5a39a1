-- WAVE 8: Atomic-Coupling Re-Heal Hardening
-- Problem: trg_atomic_enqueue_on_step_queued skippt bei OLD.status='queued' (UPDATE),
--          dadurch entstehen "queued ohne Job" Geister wenn Reset/Retry erfolgt.
-- Fix: Trigger-Bedingung lockern + dedizierter SECURITY DEFINER Heal-Function für
--      "queued without active job" (system-wide).

-- 1) Trigger-Function härten: Re-Check auch bei OLD.status='queued' wenn KEIN aktiver Job existiert
CREATE OR REPLACE FUNCTION public.fn_atomic_enqueue_on_step_queued()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_job_type text;
  v_existing_job_count int;
  v_curriculum_id uuid;
  v_pkg_status text;
  v_enqueue_result record;
  v_has_unmet_deps boolean;
BEGIN
  IF NEW.status <> 'queued'::step_status THEN RETURN NEW; END IF;

  SELECT cp.curriculum_id, cp.status::text INTO v_curriculum_id, v_pkg_status
  FROM course_packages cp WHERE cp.id = NEW.package_id;

  IF v_pkg_status NOT IN ('building','quality_gate_failed','blocked','planning','queued') THEN
    RETURN NEW;
  END IF;

  SELECT sjm.job_types[1] INTO v_job_type
  FROM step_job_mapping sjm
  WHERE sjm.step_key = NEW.step_key AND array_length(sjm.job_types, 1) > 0;
  IF v_job_type IS NULL THEN RETURN NEW; END IF;

  -- Schon Job aktiv? Dann nichts tun (idempotent)
  SELECT count(*) INTO v_existing_job_count
  FROM job_queue jq
  WHERE jq.package_id = NEW.package_id
    AND jq.job_type = v_job_type
    AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled');
  IF v_existing_job_count > 0 THEN RETURN NEW; END IF;

  -- Wenn UPDATE und vorher schon queued: explizit erlauben (Reset-Case),
  -- sonst nur bei Status-Transition.
  IF TG_OP = 'UPDATE' AND OLD.status = 'queued'::step_status THEN
    -- Nur wenn meta wave/reset_reason gesetzt (kontrollierter Repair) oder kein Job existiert
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
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('atomic_step_enqueue', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'enqueued',
              'Auto-enqueued ' || v_job_type || ' for step ' || NEW.step_key,
              jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'job_type', v_job_type));
      RETURN NEW;
    END IF;
    NEW.status := 'pending_enqueue'::step_status;
    NEW.last_error := COALESCE(v_enqueue_result.status, 'enqueue_rejected');
    NEW.attempts := COALESCE(NEW.attempts, 0) + 1;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('atomic_step_enqueue', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'error',
            'Trigger exception: ' || SQLERRM,
            jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'sqlstate', SQLSTATE));
  END;
  RETURN NEW;
END;
$function$;

-- 2) System-weiter Orphan-Heal: queued steps OHNE aktiven Job → re-enqueue
CREATE OR REPLACE FUNCTION public.fn_heal_orphan_queued_steps(p_limit int DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_rec RECORD;
  v_healed int := 0;
  v_skipped int := 0;
  v_pending int := 0;
  v_job_type text;
  v_curriculum_id uuid;
  v_enqueue_result record;
  v_has_unmet_deps boolean;
BEGIN
  FOR v_rec IN
    SELECT ps.package_id, ps.step_key, ps.id AS step_id, cp.curriculum_id, cp.status::text AS pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'::step_status
      AND cp.status::text IN ('building','quality_gate_failed','blocked','planning','queued')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.payload->>'step_key' = ps.step_key
          AND jq.status IN ('pending','queued','processing','running','batch_pending','retry_scheduled')
      )
    ORDER BY ps.updated_at ASC
    LIMIT p_limit
  LOOP
    SELECT sjm.job_types[1] INTO v_job_type
    FROM step_job_mapping sjm
    WHERE sjm.step_key = v_rec.step_key AND array_length(sjm.job_types, 1) > 0;
    IF v_job_type IS NULL THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM step_dag_edges dag
      JOIN package_steps dep ON dep.package_id = v_rec.package_id AND dep.step_key = dag.depends_on
      WHERE dag.step_key = v_rec.step_key AND dep.status NOT IN ('done'::step_status,'skipped'::step_status)
    ) INTO v_has_unmet_deps;
    IF v_has_unmet_deps THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    BEGIN
      SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
        v_job_type, v_rec.package_id, 0, 3, now(),
        jsonb_build_object('package_id', v_rec.package_id, 'curriculum_id', v_rec.curriculum_id, 'step_key', v_rec.step_key)
      );
      IF v_enqueue_result.created THEN
        v_healed := v_healed + 1;
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
        VALUES ('orphan_queued_heal','fn_heal_orphan_queued_steps','package_step',v_rec.package_id::text,'enqueued',
                'Healed orphan queued step '||v_rec.step_key,
                jsonb_build_object('package_id',v_rec.package_id,'step_key',v_rec.step_key,'job_type',v_job_type));
      ELSE
        v_pending := v_pending + 1;
        UPDATE package_steps SET status='pending_enqueue'::step_status, last_error=COALESCE(v_enqueue_result.status,'enqueue_rejected')
        WHERE id = v_rec.step_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  INSERT INTO admin_actions(action, scope, payload)
  VALUES ('orphan_queued_heal_run','system',
          jsonb_build_object('healed',v_healed,'pending',v_pending,'skipped',v_skipped,'limit',p_limit,'ran_at',now()));

  RETURN jsonb_build_object('ok',true,'healed',v_healed,'pending',v_pending,'skipped',v_skipped);
END;
$function$;

-- 3) Cron: alle 5 min orphan queued steps heilen (komplementär zu resolve-pending-enqueue)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='heal-orphan-queued-steps') THEN
    PERFORM cron.schedule(
      'heal-orphan-queued-steps',
      '*/5 * * * *',
      $cron$ SELECT public.fn_heal_orphan_queued_steps(800); $cron$
    );
  END IF;
END$$;

-- 4) Sofort-Heilung der 8.500+ verwaisten queued Steps
SELECT public.fn_heal_orphan_queued_steps(800) AS first_batch;