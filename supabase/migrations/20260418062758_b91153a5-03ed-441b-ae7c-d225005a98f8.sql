-- ============================================================
-- 2) Trigger-Funktion: atomare Job-Erzeugung bei →queued
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_atomic_enqueue_on_step_queued()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_type text;
  v_existing_job_count int;
  v_curriculum_id uuid;
  v_pkg_status text;
  v_enqueue_result record;
  v_has_unmet_deps boolean;
BEGIN
  IF NEW.status <> 'queued'::step_status THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'queued'::step_status THEN
    RETURN NEW;
  END IF;

  SELECT cp.curriculum_id, cp.status INTO v_curriculum_id, v_pkg_status
  FROM course_packages cp WHERE cp.id = NEW.package_id;

  IF v_pkg_status NOT IN ('building','quality_gate_failed','blocked','planning','queued') THEN
    RETURN NEW;
  END IF;

  SELECT sjm.job_types[1] INTO v_job_type
  FROM step_job_mapping sjm
  WHERE sjm.step_key = NEW.step_key AND array_length(sjm.job_types, 1) > 0;
  IF v_job_type IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_existing_job_count
  FROM job_queue jq
  WHERE jq.package_id = NEW.package_id
    AND jq.job_type = v_job_type
    AND jq.status IN ('pending','queued','processing','running','batch_pending');
  IF v_existing_job_count > 0 THEN RETURN NEW; END IF;

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

    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('atomic_step_enqueue', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'pending',
            'Enqueue rejected: ' || COALESCE(v_enqueue_result.status,'unknown') || ' for step ' || NEW.step_key,
            jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'job_type', v_job_type, 'reject_reason', v_enqueue_result.status));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('atomic_step_enqueue', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'error',
            'Trigger exception: ' || SQLERRM,
            jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'sqlstate', SQLSTATE));
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atomic_enqueue_on_step_queued ON public.package_steps;
CREATE TRIGGER trg_atomic_enqueue_on_step_queued
BEFORE INSERT OR UPDATE OF status ON public.package_steps
FOR EACH ROW
WHEN (NEW.status = 'queued'::step_status)
EXECUTE FUNCTION public.fn_atomic_enqueue_on_step_queued();

-- ============================================================
-- 3) Cron-Funktion: pending_enqueue resolven
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_resolve_pending_enqueue_steps()
RETURNS TABLE(out_package_id uuid, out_step_key text, out_action text, out_detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_job_type text;
  v_existing_job_count int;
  v_enqueue_result record;
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, ps.attempts, ps.last_error, cp.curriculum_id, cp.status AS pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'pending_enqueue'::step_status
      AND ps.updated_at < now() - interval '2 minutes'
      AND cp.status IN ('building','quality_gate_failed','blocked','planning','queued')
  LOOP
    IF COALESCE(rec.attempts, 0) >= 3 THEN
      UPDATE package_steps SET status = 'failed'::step_status,
        last_error = COALESCE(last_error,'') || ' | exhausted 3 enqueue retries',
        finished_at = now()
      WHERE package_id = rec.package_id AND step_key = rec.step_key;
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_action := 'failed_exhausted'; out_detail := rec.last_error;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT sjm.job_types[1] INTO v_job_type FROM step_job_mapping sjm
    WHERE sjm.step_key = rec.step_key AND array_length(sjm.job_types,1) > 0;
    IF v_job_type IS NULL THEN
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_action := 'skip_no_mapping'; out_detail := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT count(*) INTO v_existing_job_count
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id AND jq.job_type = v_job_type
      AND jq.status IN ('pending','queued','processing','running','batch_pending');

    IF v_existing_job_count > 0 THEN
      UPDATE package_steps SET status = 'queued'::step_status, last_error = NULL
      WHERE package_id = rec.package_id AND step_key = rec.step_key;
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_action := 'restored_queued_job_exists'; out_detail := v_job_type;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
      v_job_type, rec.package_id, 0, 3, now(),
      jsonb_build_object('package_id', rec.package_id, 'curriculum_id', rec.curriculum_id, 'step_key', rec.step_key)
    );

    IF v_enqueue_result.created THEN
      UPDATE package_steps SET status = 'queued'::step_status, last_error = NULL
      WHERE package_id = rec.package_id AND step_key = rec.step_key;
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_action := 'enqueued'; out_detail := v_job_type;
      RETURN NEXT;
    ELSE
      UPDATE package_steps SET attempts = COALESCE(attempts,0) + 1,
        last_error = COALESCE(v_enqueue_result.status,'rejected_again'),
        updated_at = now()
      WHERE package_id = rec.package_id AND step_key = rec.step_key;
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_action := 'still_rejected'; out_detail := v_enqueue_result.status;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 4) Admin Backlog-Closer
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_close_orphan_governance_steps(p_dry_run boolean DEFAULT true)
RETURNS TABLE(out_package_id uuid, out_step_key text, out_job_type text, out_action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_job_type text;
  v_existing_job_count int;
  v_enqueue_result record;
  v_governance_steps text[] := ARRAY['run_integrity_check','quality_council','auto_publish'];
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.curriculum_id, cp.status AS pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'::step_status
      AND ps.step_key = ANY(v_governance_steps)
      AND cp.status IN ('building','quality_gate_failed','blocked','planning','queued')
      AND ps.updated_at < now() - interval '15 minutes'
  LOOP
    SELECT sjm.job_types[1] INTO v_job_type FROM step_job_mapping sjm
    WHERE sjm.step_key = rec.step_key AND array_length(sjm.job_types,1) > 0;
    IF v_job_type IS NULL THEN CONTINUE; END IF;

    SELECT count(*) INTO v_existing_job_count
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id AND jq.job_type = v_job_type
      AND jq.status IN ('pending','queued','processing','running','batch_pending');
    IF v_existing_job_count > 0 THEN CONTINUE; END IF;

    IF p_dry_run THEN
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_job_type := v_job_type; out_action := 'would_enqueue';
      RETURN NEXT;
    ELSE
      SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
        v_job_type, rec.package_id, 5, 3, now(),
        jsonb_build_object('package_id', rec.package_id, 'curriculum_id', rec.curriculum_id, 'step_key', rec.step_key, 'source','admin_backlog_closer')
      );
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('admin_governance_backlog', 'admin_close_orphan_governance_steps', 'package_step', rec.package_id::text,
              CASE WHEN v_enqueue_result.created THEN 'enqueued' ELSE 'rejected' END,
              v_enqueue_result.status,
              jsonb_build_object('step_key', rec.step_key, 'job_type', v_job_type));
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_job_type := v_job_type;
      out_action := CASE WHEN v_enqueue_result.created THEN 'enqueued' ELSE 'rejected' END;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- 5) Observability View
-- ============================================================
CREATE OR REPLACE VIEW public.v_pending_enqueue_steps AS
SELECT 
  ps.package_id,
  ps.step_key,
  ps.attempts,
  ps.last_error,
  ps.updated_at,
  cp.status AS pkg_status,
  cp.curriculum_id,
  EXTRACT(EPOCH FROM (now() - ps.updated_at))/60 AS minutes_pending
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.status = 'pending_enqueue'::step_status;

-- ============================================================
-- 6) Cron Job
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resolve-pending-enqueue-steps') THEN
    PERFORM cron.schedule(
      'resolve-pending-enqueue-steps',
      '*/5 * * * *',
      $cron$ SELECT public.fn_resolve_pending_enqueue_steps(); $cron$
    );
  END IF;
END $$;