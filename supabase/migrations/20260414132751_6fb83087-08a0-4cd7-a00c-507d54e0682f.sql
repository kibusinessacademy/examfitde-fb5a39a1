
CREATE OR REPLACE FUNCTION fn_materialize_ready_step_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_zombies integer := 0;
  v_should_run boolean;
  v_pkg_track text;
  rec record;
BEGIN
  -- Clean zombie jobs (pending but with started_at set)
  UPDATE job_queue
  SET started_at = NULL, locked_at = NULL, locked_by = NULL
  WHERE status = 'pending' AND started_at IS NOT NULL;
  GET DIAGNOSTICS v_zombies = ROW_COUNT;
  IF v_zombies > 0 THEN
    RAISE LOG '[materializer] Cleaned % zombie jobs', v_zombies;
  END IF;

  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.curriculum_id, c.id as course_id, cp.track
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.curriculum_id = cp.curriculum_id
    WHERE cp.status = 'building'
      AND ps.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM step_dag_edges dag
        JOIN package_steps dep ON dep.package_id = ps.package_id AND dep.step_key = dag.depends_on
        WHERE dag.step_key = ps.step_key AND dep.status NOT IN ('done', 'skipped')
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status IN ('pending', 'processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.job_type = 'package_' || ps.step_key
        AND (jq.payload->>'package_id')::uuid = ps.package_id
        AND jq.status = 'completed'
        AND jq.completed_at > now() - interval '2 minutes'
      )
  LOOP
    -- ── SSOT Applicability Gate ──
    -- Check track_step_applicability: if step is not applicable for this track,
    -- auto-correct the step to 'skipped' instead of enqueuing a job that will be cancelled.
    v_should_run := true;
    IF rec.track IS NOT NULL THEN
      SELECT tsa.should_run INTO v_should_run
      FROM track_step_applicability tsa
      WHERE tsa.track = rec.track::product_track
        AND tsa.step_key = rec.step_key;
      -- If no entry found, default to true (applicable)
      IF v_should_run IS NULL THEN
        v_should_run := true;
      END IF;
    END IF;

    IF NOT v_should_run THEN
      -- Auto-correct: set step to skipped instead of creating a doomed job
      UPDATE package_steps
      SET status = 'skipped',
          updated_at = now(),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'skip_reason', 'track_not_applicable',
            'skipped_by', 'fn_materialize_ready_step_jobs',
            'track', rec.track
          )
      WHERE package_id = rec.package_id
        AND step_key = rec.step_key
        AND status = 'queued';

      INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('ssot_applicability_skip', 'fn_materialize_ready_step_jobs', 'package_step', rec.package_id::text, 'corrected',
              'Auto-skipped non-applicable step ' || rec.step_key || ' for track ' || rec.track,
              jsonb_build_object('package_id', rec.package_id, 'step_key', rec.step_key, 'track', rec.track));
      CONTINUE;
    END IF;

    INSERT INTO job_queue (job_type, package_id, payload, priority, status, created_at)
    VALUES (
      'package_' || rec.step_key,
      rec.package_id,
      jsonb_build_object(
        'package_id', rec.package_id,
        'curriculum_id', rec.curriculum_id,
        'course_id', rec.course_id,
        'triggered_by', 'auto_materializer'
      ),
      10,
      'pending',
      now()
    )
    ON CONFLICT DO NOTHING;
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;
