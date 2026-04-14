CREATE OR REPLACE FUNCTION public.fn_is_true_stall(
  p_package_id uuid,
  p_step_key text,
  p_stale_minutes int DEFAULT 15
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step_status text;
  v_step_updated timestamptz;
  v_all_prereqs_done boolean;
  v_active_job_count int;
  v_job_type text;
BEGIN
  -- 1) Step must be queued and stale
  SELECT status, updated_at
    INTO v_step_status, v_step_updated
    FROM package_steps
   WHERE package_id = p_package_id AND step_key = p_step_key;

  IF v_step_status IS NULL OR v_step_status != 'queued' THEN RETURN false; END IF;
  IF v_step_updated > (now() - (p_stale_minutes || ' minutes')::interval) THEN RETURN false; END IF;

  -- 2) All DAG prerequisites must be done or skipped
  --    FIXED: was pipeline_step_edges(from_step/to_step) → now step_dag_edges(depends_on/step_key)
  SELECT bool_and(ps2.status IN ('done', 'skipped'))
    INTO v_all_prereqs_done
    FROM step_dag_edges sde
    JOIN package_steps ps2
      ON ps2.package_id = p_package_id AND ps2.step_key = sde.depends_on
   WHERE sde.step_key = p_step_key;

  -- If no prereqs exist, treat as all done
  IF v_all_prereqs_done IS NULL THEN v_all_prereqs_done := true; END IF;
  IF NOT v_all_prereqs_done THEN RETURN false; END IF;

  -- 3) No active job — check canonical + known special variants
  v_job_type := 'package_' || p_step_key;

  SELECT count(*)
    INTO v_active_job_count
    FROM job_queue jq
   WHERE jq.package_id = p_package_id
     AND jq.status IN ('pending', 'queued', 'processing')
     AND (
       jq.job_type = v_job_type
       OR jq.job_type = p_step_key
       OR (p_step_key = 'generate_learning_content' AND jq.job_type IN (
         'lesson_generate_content',
         'lesson_generate_content_shard',
         'lesson_regen_repair',
         'package_fanout_learning_content'
       ))
       OR (p_step_key = 'generate_exam_pool' AND jq.job_type IN (
         'package_generate_exam_pool',
         'exam_pool_generate_shard'
       ))
       OR (p_step_key = 'generate_flashcards' AND jq.job_type IN (
         'package_generate_flashcards',
         'flashcard_generate_shard'
       ))
       OR (p_step_key = 'run_integrity_check' AND jq.job_type IN (
         'package_run_integrity_check',
         'run_integrity_check'
       ))
       OR (p_step_key = 'quality_council' AND jq.job_type IN (
         'package_quality_council',
         'quality_council_session'
       ))
     );

  IF v_active_job_count > 0 THEN RETURN false; END IF;

  RETURN true;
END;
$$;