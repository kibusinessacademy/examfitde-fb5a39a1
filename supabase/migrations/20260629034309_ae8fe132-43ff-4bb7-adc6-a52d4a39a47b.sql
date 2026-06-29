CREATE OR REPLACE FUNCTION public.fn_materialize_ready_step_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_zombies integer := 0;
  v_should_run boolean;
  v_blocked integer := 0;
  v_phantom_skipped integer := 0;
  v_upstream_status text;
  rec record;
BEGIN
  UPDATE job_queue SET started_at = NULL, locked_at = NULL, locked_by = NULL
   WHERE status = 'pending' AND started_at IS NOT NULL;
  GET DIAGNOSTICS v_zombies = ROW_COUNT;

  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.curriculum_id, c.id as course_id, cp.track
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.curriculum_id = cp.curriculum_id
    WHERE cp.status = 'building' AND ps.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps dep ON dep.package_id = ps.package_id AND dep.step_key = dag.depends_on
        WHERE dag.step_key = ps.step_key AND dep.status NOT IN ('done', 'skipped'))
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status IN ('pending', 'processing'))
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status = 'completed' AND jq.completed_at > now() - interval '2 minutes')
  LOOP
    -- MATERIALIZE.READY.STEP.JOBS.GUARD.1: respect phantom-repair guard upstream.
    -- If this is a repair_exam_pool_quality step but the upstream generate_exam_pool
    -- step is already done/skipped, the SSOT trigger fn_guard_phantom_repair_enqueue
    -- would RAISE EXCEPTION 'PHANTOM_REPAIR_BLOCKED'. Skip cleanly instead of
    -- generating a failure event every 2 minutes.
    IF rec.step_key = 'repair_exam_pool_quality' THEN
      SELECT status INTO v_upstream_status
        FROM package_steps
       WHERE package_id = rec.package_id AND step_key = 'generate_exam_pool';
      IF v_upstream_status IN ('done', 'skipped') THEN
        UPDATE package_steps
           SET status = 'skipped', updated_at = now(),
               meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                 'skip_reason','upstream_step_already_done',
                 'skipped_by','fn_materialize_ready_step_jobs',
                 'upstream_step_key','generate_exam_pool',
                 'upstream_status', v_upstream_status,
                 'guard','fn_guard_phantom_repair_enqueue',
                 'cut','MATERIALIZE.READY.STEP.JOBS.GUARD.1')
         WHERE package_id = rec.package_id AND step_key = rec.step_key AND status = 'queued';

        BEGIN
          PERFORM public.fn_emit_audit(
            'materializer_skipped_phantom_repair',
            'package',
            rec.package_id::text,
            'skipped',
            jsonb_build_object(
              'reason','upstream_step_already_done',
              'step_key', rec.step_key,
              'upstream_step_key','generate_exam_pool',
              'upstream_status', v_upstream_status,
              'cut','MATERIALIZE.READY.STEP.JOBS.GUARD.1'),
            'fn_materialize_ready_step_jobs',
            'phantom repair candidate skipped — upstream generate_exam_pool already terminal'
          );
        EXCEPTION WHEN OTHERS THEN NULL; END;

        v_phantom_skipped := v_phantom_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    IF public.fn_is_package_progress_blocked(rec.package_id) THEN
      v_blocked := v_blocked + 1;
      IF public.fn_should_log_blocked_skip(rec.package_id, 'fn_materialize_ready_step_jobs') THEN
        INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, metadata)
        VALUES ('producer_blocked_package_progress','fn_materialize_ready_step_jobs','package',
                rec.package_id::text,'skipped',
                jsonb_build_object('producer','fn_materialize_ready_step_jobs',
                                   'reason','package_progress_blocked',
                                   'bronze_locked', public.fn_is_bronze_locked(rec.package_id),
                                   'step_key', rec.step_key,
                                   'throttled_window','1h'));
      END IF;
      CONTINUE;
    END IF;

    v_should_run := true;
    IF rec.track IS NOT NULL THEN
      SELECT tsa.should_run INTO v_should_run FROM track_step_applicability tsa
       WHERE tsa.track = rec.track::product_track AND tsa.step_key = rec.step_key;
      IF v_should_run IS NULL THEN v_should_run := true; END IF;
    END IF;

    IF NOT v_should_run THEN
      UPDATE package_steps SET status='skipped', updated_at=now(),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'skip_reason','track_not_applicable','skipped_by','fn_materialize_ready_step_jobs','track', rec.track)
       WHERE package_id = rec.package_id AND step_key = rec.step_key AND status = 'queued';
      CONTINUE;
    END IF;

    INSERT INTO job_queue (job_type, package_id, payload, priority, status, created_at)
    VALUES ('package_' || rec.step_key, rec.package_id,
      jsonb_build_object('package_id', rec.package_id,'curriculum_id', rec.curriculum_id,
        'course_id', rec.course_id,'triggered_by','auto_materializer','enqueue_source','ready_materializer'),
      10, 'pending', now())
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;