CREATE OR REPLACE FUNCTION public.admin_close_orphan_governance_steps(
  p_dry_run boolean DEFAULT true,
  p_step_key text DEFAULT NULL,
  p_limit int DEFAULT 50
)
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
  v_idx int := 0;
  v_run_after timestamptz;
BEGIN
  IF p_step_key IS NOT NULL AND NOT (p_step_key = ANY(v_governance_steps)) THEN
    RAISE EXCEPTION 'p_step_key must be one of %', v_governance_steps;
  END IF;

  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.curriculum_id, cp.status AS pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'::step_status
      AND ps.step_key = ANY(v_governance_steps)
      AND (p_step_key IS NULL OR ps.step_key = p_step_key)
      AND cp.status IN ('building','quality_gate_failed','blocked','planning','queued')
      AND ps.updated_at < now() - interval '15 minutes'
    ORDER BY ps.updated_at ASC
    LIMIT p_limit
  LOOP
    SELECT sjm.job_types[1] INTO v_job_type FROM step_job_mapping sjm
    WHERE sjm.step_key = rec.step_key AND array_length(sjm.job_types,1) > 0;
    IF v_job_type IS NULL THEN CONTINUE; END IF;

    SELECT count(*) INTO v_existing_job_count
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id AND jq.job_type = v_job_type
      AND jq.status IN ('pending','queued','processing','running','batch_pending');
    IF v_existing_job_count > 0 THEN CONTINUE; END IF;

    -- Stagger: jeder Job 5 Sekunden später
    v_run_after := now() + (v_idx * interval '5 seconds');
    v_idx := v_idx + 1;

    IF p_dry_run THEN
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_job_type := v_job_type; out_action := 'would_enqueue';
      RETURN NEXT;
    ELSE
      SELECT * INTO v_enqueue_result FROM enqueue_job_if_absent(
        v_job_type, rec.package_id, 5, 3, v_run_after,
        jsonb_build_object('package_id', rec.package_id, 'curriculum_id', rec.curriculum_id, 'step_key', rec.step_key, 'source','admin_backlog_closer')
      );
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('admin_governance_backlog', 'admin_close_orphan_governance_steps', 'package_step', rec.package_id::text,
              CASE WHEN v_enqueue_result.created THEN 'enqueued' ELSE 'rejected' END,
              v_enqueue_result.status,
              jsonb_build_object('step_key', rec.step_key, 'job_type', v_job_type, 'run_after', v_run_after));
      out_package_id := rec.package_id; out_step_key := rec.step_key; out_job_type := v_job_type;
      out_action := CASE WHEN v_enqueue_result.created THEN 'enqueued' ELSE 'rejected' END;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;