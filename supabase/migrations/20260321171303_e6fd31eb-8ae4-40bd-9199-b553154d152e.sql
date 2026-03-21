DROP FUNCTION IF EXISTS heal_true_stall_steps(int);

CREATE OR REPLACE FUNCTION heal_true_stall_steps(p_max_heal int DEFAULT 10)
RETURNS TABLE(package_id uuid, step_key text, job_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_job_type text;
  v_curriculum_id uuid;
BEGIN
  FOR r IN
    SELECT d.package_id, d.step_key, d.signal, d.updated_at
    FROM ops_pipeline_step_drift d
    WHERE d.signal = 'TRUE_STALL'
      AND d.updated_at < now() - interval '15 minutes'
    ORDER BY d.updated_at ASC
    LIMIT p_max_heal
  LOOP
    SELECT CASE r.step_key
      WHEN 'scaffold_learning_course' THEN 'package_scaffold_learning_course'
      WHEN 'generate_glossary' THEN 'package_generate_glossary'
      WHEN 'fanout_learning_content' THEN 'package_fanout_learning_content'
      WHEN 'generate_learning_content' THEN 'package_generate_learning_content'
      WHEN 'finalize_learning_content' THEN 'package_finalize_learning_content'
      WHEN 'validate_learning_content' THEN 'package_validate_learning_content'
      WHEN 'auto_seed_exam_blueprints' THEN 'package_auto_seed_exam_blueprints'
      WHEN 'validate_blueprints' THEN 'package_validate_blueprints'
      WHEN 'generate_exam_pool' THEN 'package_generate_exam_pool'
      WHEN 'validate_exam_pool' THEN 'package_validate_exam_pool'
      WHEN 'build_ai_tutor_index' THEN 'package_build_ai_tutor_index'
      WHEN 'validate_tutor_index' THEN 'package_validate_tutor_index'
      WHEN 'generate_oral_exam' THEN 'package_generate_oral_exam'
      WHEN 'validate_oral_exam' THEN 'package_validate_oral_exam'
      WHEN 'generate_lesson_minichecks' THEN 'package_generate_lesson_minichecks'
      WHEN 'validate_lesson_minichecks' THEN 'package_validate_lesson_minichecks'
      WHEN 'generate_handbook' THEN 'package_generate_handbook'
      WHEN 'validate_handbook' THEN 'package_validate_handbook'
      WHEN 'enqueue_handbook_expand' THEN 'package_enqueue_handbook_expand'
      WHEN 'expand_handbook' THEN 'handbook_expand_section'
      WHEN 'validate_handbook_depth' THEN 'package_validate_handbook_depth'
      WHEN 'elite_harden' THEN 'package_elite_harden'
      WHEN 'run_integrity_check' THEN 'package_run_integrity_check'
      WHEN 'quality_council' THEN 'package_quality_council'
      WHEN 'auto_publish' THEN 'package_auto_publish'
      ELSE NULL
    END INTO v_job_type;

    IF v_job_type IS NULL THEN CONTINUE; END IF;

    IF EXISTS (
      SELECT 1 FROM job_queue
      WHERE job_queue.package_id = r.package_id
        AND job_queue.job_type = v_job_type
        AND job_queue.status IN ('pending', 'queued', 'processing')
    ) THEN CONTINUE; END IF;

    SELECT cp.curriculum_id INTO v_curriculum_id
    FROM course_packages cp WHERE cp.id = r.package_id;

    INSERT INTO job_queue (job_type, package_id, status, attempts, max_attempts, worker_pool, run_after, payload)
    VALUES (
      v_job_type, r.package_id, 'pending', 0, 5,
      CASE WHEN v_job_type IN (
        'package_generate_learning_content','package_generate_handbook',
        'package_generate_glossary','package_generate_oral_exam',
        'package_generate_lesson_minichecks','handbook_expand_section',
        'package_generate_exam_pool','lesson_generate_content',
        'lesson_generate_competency_bundle','lesson_generate_content_shard'
      ) THEN 'content' ELSE 'core' END,
      now(),
      jsonb_build_object(
        'package_id', r.package_id,
        'curriculum_id', v_curriculum_id,
        'triggered_by', 'heal_true_stall_steps',
        'stall_age_min', round(EXTRACT(EPOCH FROM (now() - r.updated_at)) / 60)
      )
    );

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('true_stall_redispatch', 'heal_true_stall_steps', 'package_step', r.package_id::text, 'applied',
      format('Redispatched %s for step %s (stalled %s min)', v_job_type, r.step_key,
        round(EXTRACT(EPOCH FROM (now() - r.updated_at)) / 60)),
      jsonb_build_object('step_key', r.step_key, 'job_type', v_job_type));

    package_id := r.package_id;
    step_key := r.step_key;
    job_type := v_job_type;
    RETURN NEXT;
  END LOOP;
END;
$$;