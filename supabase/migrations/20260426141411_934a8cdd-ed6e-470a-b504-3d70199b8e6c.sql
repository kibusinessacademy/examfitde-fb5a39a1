-- ========================================================================
-- Throughput-Sanierung: Behebt Hauptursachen für nur 10 completed/h
-- ========================================================================

-- ── FIX 1: Atomic Enqueue Trigger nur noch für 'building' Pakete ──
-- Der Trigger erlaubte enqueue für queued/planning/blocked Pakete und
-- erzeugte 250 Phantom-Jobs/Stunde, die ops_cancel_pending_non_building_jobs
-- als 'failed' markiert.

CREATE OR REPLACE FUNCTION public.fn_atomic_enqueue_on_step_queued()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  -- FIX: Nur noch building/quality_gate_failed (Repair) erlauben.
  -- Vorher: ('building','quality_gate_failed','blocked','planning','queued')
  -- Diese erzeugten Phantom-Jobs für nicht-startende Pakete.
  IF v_pkg_status NOT IN ('building','quality_gate_failed') THEN
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

-- ── FIX 2: fn_resolve_pending_enqueue_steps nur noch für building ──
CREATE OR REPLACE FUNCTION public.fn_resolve_pending_enqueue_steps()
RETURNS TABLE(out_package_id uuid, out_step_key text, out_action text, out_detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
      -- FIX: Nur noch building/quality_gate_failed (Repair) statt auch queued/planning/blocked
      AND cp.status IN ('building','quality_gate_failed')
  LOOP
    IF COALESCE(rec.attempts, 0) >= 3 THEN
      UPDATE package_steps SET status = 'failed'::step_status,
        last_error = COALESCE(last_error,'') || ' | exhausted 3 enqueue retries',
        finished_at = now()
      WHERE package_id = rec.package_id AND step_key = rec.step_key;
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_action := 'failed_exhausted'; out_detail := rec.last_error;
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT sjm.job_types[1] INTO v_job_type FROM step_job_mapping sjm
    WHERE sjm.step_key = rec.step_key AND array_length(sjm.job_types,1) > 0;
    IF v_job_type IS NULL THEN
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_action := 'skip_no_mapping'; out_detail := NULL;
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT count(*) INTO v_existing_job_count
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id AND jq.job_type = v_job_type
      AND jq.status IN ('pending','queued','processing','running','batch_pending');

    IF v_existing_job_count > 0 THEN
      UPDATE package_steps SET status = 'queued'::step_status, last_error = NULL
      WHERE package_id = rec.package_id AND step_key = rec.step_key;
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_action := 'restored_queued_job_exists'; out_detail := v_job_type;
      RETURN NEXT; CONTINUE;
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
$function$;

-- ── FIX 3: ops_cancel_pending_non_building_jobs setzt 'cancelled' statt 'failed' ──
-- Diese sind keine echten Fehler, sondern Cleanup. 'failed' zerstört Health-Score.
CREATE OR REPLACE FUNCTION public.ops_cancel_pending_non_building_jobs()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    JOIN public.course_packages cp
      ON cp.id = jq.package_id OR cp.id::text = (jq.payload->>'package_id')
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND cp.status NOT IN ('building', 'quality_gate_failed', 'blocked', 'council_review')
      AND NOT COALESCE(jtp.can_run_when_not_building, false)
      AND NOT COALESCE(jtp.exempt_from_auto_cancel, false)
    LIMIT 500
  )
  UPDATE public.job_queue jq
  SET status = 'cancelled',  -- FIX: cancelled statt failed
      updated_at = now(),
      last_error = coalesce(jq.last_error,'') || ' | OPS_GUARD:NON_BUILDING_PACKAGE',
      meta = coalesce(jq.meta,'{}'::jsonb) || jsonb_build_object(
        'ops_guard', true,
        'ops_guard_reason', 'NON_BUILDING_PACKAGE',
        'cancel_reason', 'ops_guard_non_building_package',
        'cancel_source', 'ops_cancel_pending_non_building_jobs',
        'ops_guard_at', now(),
        'last_error_reason', 'NON_BUILDING_PACKAGE'
      )
  FROM picked
  WHERE jq.id = picked.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    PERFORM public.ops_raise_alert(
      'NON_BUILDING_PENDING_CLEANUP',
      CASE WHEN v_count >= 10 THEN 'warn' ELSE 'info' END,
      format('Auto-cancelled %s pending jobs on non-building packages', v_count),
      jsonb_build_object('count', v_count, 'cleaned_at_bucket', date_trunc('hour', now()))
    );
  END IF;

  RETURN v_count;
END;
$function$;

-- ── FIX 4: Coverage-Gap Auto-Publish Loop kappen ──
-- package_auto_publish wurde 11x mit COVERAGE_GAP_BELOW_TRACK_THRESHOLD requeued.
-- Cap: nach 5 Versuchen mit Coverage-Gap → blocked + manual_review.
CREATE OR REPLACE FUNCTION public.fn_cap_auto_publish_coverage_gap_loop()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_capped int := 0;
BEGIN
  WITH stuck AS (
    SELECT jq.id, jq.package_id
    FROM job_queue jq
    WHERE jq.job_type = 'package_auto_publish'
      AND jq.status IN ('pending','failed')
      AND jq.attempts >= 5
      AND (jq.last_error ILIKE '%COVERAGE_GAP_BELOW_TRACK_THRESHOLD%'
           OR jq.last_error ILIKE '%competency_question_coverage_pct%')
  ), capped_jobs AS (
    UPDATE job_queue jq
    SET status = 'cancelled',
        last_error = COALESCE(jq.last_error,'') || ' | CAPPED_COVERAGE_GAP_LOOP',
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
          'cancel_reason','coverage_gap_loop_capped',
          'cancel_source','fn_cap_auto_publish_coverage_gap_loop',
          'last_error_reason','COVERAGE_GAP_PERSISTENT',
          'requires_manual_review', true,
          'capped_at', now()
        )
    FROM stuck WHERE jq.id = stuck.id
    RETURNING jq.id, jq.package_id
  ), step_updates AS (
    UPDATE package_steps ps
    SET status = 'failed'::step_status,
        last_error = 'CAPPED: Coverage-Gap loop exceeded 5 retries — manual review required',
        meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
          'requires_manual_review', true,
          'capped_reason', 'coverage_gap_persistent',
          'capped_at', now()
        )
    FROM capped_jobs cj
    WHERE ps.package_id = cj.package_id AND ps.step_key = 'auto_publish'
    RETURNING ps.package_id
  )
  SELECT count(*) INTO v_capped FROM capped_jobs;
  RETURN v_capped;
END;
$function$;

-- ── FIX 5: Bestehende festsitzende Jobs sofort bereinigen ──

-- 5a) Cancel die 11x requeued auto_publish Coverage-Gap Loops
SELECT public.fn_cap_auto_publish_coverage_gap_loop();

-- 5b) Cancel die festsitzenden NON_BUILDING failed Jobs (umkategorisieren auf cancelled)
UPDATE public.job_queue
SET status = 'cancelled',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'cancel_reason','reclassified_from_failed_to_cancelled',
      'cancel_source','migration_throughput_sanierung',
      'cancelled_at', now()
    )
WHERE status = 'failed'
  AND meta->>'last_error_reason' = 'NON_BUILDING_PACKAGE'
  AND COALESCE(attempts, 0) = 0;

-- 5c) Oral-Exam Demo-Loop für dd000001 stoppen (15/15 nicht erreichbar in Demo-Daten)
UPDATE public.job_queue
SET status = 'cancelled',
    last_error = COALESCE(last_error,'') || ' | DEMO_DATA_INCOMPLETE',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'cancel_reason','demo_data_incomplete',
      'cancel_source','migration_throughput_sanierung'
    )
WHERE job_type = 'package_generate_oral_exam'
  AND package_id = 'dd000001-0005-4000-8000-000000000001'
  AND status IN ('pending','failed');

-- ── FIX 6: Cron-Job für regelmäßiges Loop-Capping ──
SELECT cron.unschedule('cap-auto-publish-coverage-gap-loops')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cap-auto-publish-coverage-gap-loops');

SELECT cron.schedule(
  'cap-auto-publish-coverage-gap-loops',
  '*/10 * * * *',
  $$ SELECT public.fn_cap_auto_publish_coverage_gap_loop(); $$
);