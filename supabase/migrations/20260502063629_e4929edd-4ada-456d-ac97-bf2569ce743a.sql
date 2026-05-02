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
  v_pkg_track text;
  v_enqueue_result record;
  v_has_unmet_deps boolean;
  v_last_attempt timestamptz;
  v_debounce_window interval := interval '60 seconds';
  v_is_applicable boolean;
BEGIN
  IF NEW.status <> 'queued'::step_status THEN RETURN NEW; END IF;

  SELECT cp.curriculum_id, cp.status::text, cp.track::text
    INTO v_curriculum_id, v_pkg_status, v_pkg_track
  FROM course_packages cp WHERE cp.id = NEW.package_id;

  IF v_pkg_status NOT IN ('building','quality_gate_failed') THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_is_applicable := public.fn_is_step_applicable_for_package(NEW.package_id, NEW.step_key);
  EXCEPTION WHEN undefined_function THEN
    v_is_applicable := true;
  END;

  IF v_is_applicable IS FALSE THEN
    NEW.status := 'skipped'::step_status;
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'skip_reason', 'auto_skipped_not_applicable',
      'skip_source', 'trg_atomic_enqueue_applicability_reentry_guard',
      'skipped_at', now(),
      'skipped_reason', 'TRACK_NOT_APPLICABLE_REENTRY',
      'pkg_track', v_pkg_track
    );
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('atomic_enqueue_applicability_reskip', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'skipped',
            'Reverted reset to skipped (track not applicable): ' || NEW.step_key,
            jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'track', v_pkg_track));
    RETURN NEW;
  END IF;

  SELECT sjm.job_types[1] INTO v_job_type
  FROM step_job_mapping sjm
  WHERE sjm.step_key = NEW.step_key AND array_length(sjm.job_types, 1) > 0;
  IF v_job_type IS NULL THEN RETURN NEW; END IF;

  v_last_attempt := (NEW.meta->>'last_atomic_enqueue_at')::timestamptz;
  IF v_last_attempt IS NOT NULL AND (now() - v_last_attempt) < v_debounce_window THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('atomic_enqueue_debounced', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'skipped',
            'Debounce window active',
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
      jsonb_build_object(
        'package_id', NEW.package_id,
        'curriculum_id', v_curriculum_id,
        'step_key', NEW.step_key,
        'enqueue_source', 'trg_atomic_enqueue'
      )
    );
    IF v_enqueue_result.created THEN
      NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object('last_atomic_enqueue_at', now());
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('atomic_step_enqueue', 'trg_atomic_enqueue', 'package_step', NEW.package_id::text, 'enqueued',
              'Auto-enqueued ' || v_job_type || ' for step ' || NEW.step_key,
              jsonb_build_object('package_id', NEW.package_id, 'step_key', NEW.step_key, 'job_type', v_job_type, 'enqueue_source', 'trg_atomic_enqueue'));
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

-- ── Bulk-Heal: 222 betroffene Pakete (incl. Kanalbauer) ──
WITH affected AS (
  SELECT id, package_id
  FROM package_steps
  WHERE step_key='generate_learning_content'
    AND status='queued'::step_status
    AND meta ? 'liveness_requeued'
    AND (meta->>'skipped_reason' = 'TRACK_NOT_APPLICABLE_LEARNING_CONTENT'
         OR (meta->>'skip_reason') ILIKE '%not_applicable%'
         OR (meta->>'skip_source') ILIKE 'trg_auto_skip_not_applicable%')
)
UPDATE package_steps ps
SET status='skipped'::step_status,
    meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
      'skip_reason', 'auto_skipped_not_applicable',
      'skip_source', 'pattern_x7_bulk_heal_2026_05_02',
      'skipped_at', now(),
      'skipped_reason', 'TRACK_NOT_APPLICABLE_LEARNING_CONTENT',
      'pattern_x7_healed', true,
      'pattern_x7_healed_at', now()
    ),
    updated_at=now()
FROM affected a
WHERE ps.id = a.id;

INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
SELECT 'pattern_x7_bulk_heal', 'manual_lovable_2026_05_02', 'package', package_id::text, 'ok',
       'Re-skipped track-not-applicable generate_learning_content (reviver loop X7)',
       jsonb_build_object('package_id', package_id, 'step_key', 'generate_learning_content', 'pattern', 'X7_REVIVER_LOOP')
FROM package_steps
WHERE step_key='generate_learning_content'
  AND meta->>'pattern_x7_healed' = 'true'
  AND (meta->>'pattern_x7_healed_at')::timestamptz > now() - interval '1 minute';

-- Cancel pending phantom jobs für diese Pakete
UPDATE job_queue
SET status='cancelled',
    last_error_code='PATTERN_X7_PHANTOM_SKIPPED',
    last_error='Step skipped (track-not-applicable). Phantom enqueue blocked.',
    updated_at=now()
WHERE job_type='package_generate_learning_content'
  AND status IN ('pending','queued','retry_scheduled')
  AND package_id IN (
    SELECT package_id FROM package_steps
    WHERE step_key='generate_learning_content'
      AND meta->>'pattern_x7_healed' = 'true'
  );