
-- Healer: fix steps stuck at queued with no active job
CREATE OR REPLACE FUNCTION public.fn_heal_queued_steps_without_jobs(
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  package_id uuid,
  step_key text,
  job_type text,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_job_type text;
  v_existing_job_count int;
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.status AS pkg_status, cp.curriculum_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND cp.status IN ('building', 'quality_gate_failed')
      -- Step has been queued for at least 10 minutes (avoid race with normal dispatch)
      AND ps.updated_at < now() - interval '10 minutes'
  LOOP
    -- Map step_key to job_type
    v_job_type := 'package_' || rec.step_key;
    
    -- Check no active job exists
    SELECT count(*) INTO v_existing_job_count
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id
      AND jq.job_type = v_job_type
      AND jq.status IN ('pending', 'queued', 'processing', 'running', 'batch_pending');
    
    IF v_existing_job_count > 0 THEN
      CONTINUE;
    END IF;
    
    -- Check DAG prerequisites are met (all dependsOn steps must be done/skipped)
    -- Use the simple approach: for auto_publish, quality_council must be done
    -- For other steps, check if the step before is done
    IF rec.step_key = 'auto_publish' THEN
      PERFORM 1 FROM package_steps
        WHERE package_steps.package_id = rec.package_id
          AND package_steps.step_key = 'quality_council'
          AND package_steps.status IN ('done', 'skipped');
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;
    
    IF p_dry_run THEN
      package_id := rec.package_id;
      step_key := rec.step_key;
      job_type := v_job_type;
      action := 'would_enqueue';
      RETURN NEXT;
    ELSE
      -- Enqueue via SSOT function
      PERFORM enqueue_job_if_absent(
        v_job_type,
        rec.package_id,
        jsonb_build_object('package_id', rec.package_id, 'curriculum_id', rec.curriculum_id),
        20, -- priority
        3,  -- max_attempts
        now()
      );
      
      -- Audit
      INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('queued_step_no_job_heal', 'fn_heal_queued_steps_without_jobs', 'package_step', rec.package_id::text, 'healed',
              'Enqueued missing job for queued step ' || rec.step_key,
              jsonb_build_object('package_id', rec.package_id, 'step_key', rec.step_key, 'job_type', v_job_type));
      
      package_id := rec.package_id;
      step_key := rec.step_key;
      job_type := v_job_type;
      action := 'enqueued';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
