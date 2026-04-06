
CREATE OR REPLACE FUNCTION public.fn_reconcile_orphan_steps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reconciled int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  rec record;
  v_job_type text;
  v_pool text;
  v_step_jobs jsonb := '{
    "scaffold_learning_course": "package_scaffold_learning_course",
    "generate_glossary": "package_generate_glossary",
    "fanout_learning_content": "package_fanout_learning_content",
    "generate_learning_content": "package_generate_learning_content",
    "finalize_learning_content": "package_finalize_learning_content",
    "validate_learning_content": "package_validate_learning_content",
    "auto_seed_exam_blueprints": "package_auto_seed_exam_blueprints",
    "validate_blueprints": "package_validate_blueprints",
    "generate_blueprint_variants": "package_generate_blueprint_variants",
    "validate_blueprint_variants": "package_validate_blueprint_variants",
    "promote_blueprint_variants": "package_promote_blueprint_variants",
    "generate_exam_pool": "package_generate_exam_pool",
    "validate_exam_pool": "package_validate_exam_pool",
    "repair_exam_pool_quality": "package_repair_exam_pool_quality",
    "build_ai_tutor_index": "package_build_ai_tutor_index",
    "validate_tutor_index": "package_validate_tutor_index",
    "generate_oral_exam": "package_generate_oral_exam",
    "validate_oral_exam": "package_validate_oral_exam",
    "generate_lesson_minichecks": "package_generate_lesson_minichecks",
    "validate_lesson_minichecks": "package_validate_lesson_minichecks",
    "generate_handbook": "package_generate_handbook",
    "validate_handbook": "package_validate_handbook",
    "enqueue_handbook_expand": "package_enqueue_handbook_expand",
    "expand_handbook": "handbook_expand_section",
    "validate_handbook_depth": "package_validate_handbook_depth",
    "elite_harden": "package_elite_harden",
    "run_integrity_check": "package_run_integrity_check",
    "quality_council": "package_quality_council",
    "auto_publish": "package_auto_publish"
  }'::jsonb;
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.priority, cp.curriculum_id, c.title
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.id = cp.course_id
    WHERE ps.status = 'queued'
      AND cp.status = 'building'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = (v_step_jobs ->> ps.step_key)
          AND jq.status IN ('pending', 'processing')
      )
      AND (v_step_jobs ->> ps.step_key) IS NOT NULL
      AND ps.updated_at < now() - interval '10 minutes'
    ORDER BY cp.priority, ps.package_id
    LIMIT 20
  LOOP
    v_job_type := v_step_jobs ->> rec.step_key;
    v_pool := CASE
      WHEN v_job_type IN ('package_generate_learning_content','package_generate_glossary',
        'package_generate_handbook','package_generate_oral_exam','package_generate_lesson_minichecks',
        'package_generate_exam_pool','package_generate_blueprint_variants',
        'lesson_generate_content_shard','handbook_expand_section') THEN 'content'
      ELSE 'core'
    END;
    
    INSERT INTO job_queue (package_id, job_type, worker_pool, status, priority, meta, payload)
    VALUES (
      rec.package_id, v_job_type, v_pool, 'pending', rec.priority,
      jsonb_build_object('source', 'orphan_reconciler', 'step_key', rec.step_key),
      jsonb_build_object(
        'packageId', rec.package_id::text,
        'curriculumId', rec.curriculum_id::text,
        'source', 'orphan_reconciler'
      )
    )
    ON CONFLICT DO NOTHING;
    
    IF FOUND THEN
      v_reconciled := v_reconciled + 1;
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('orphan_step', rec.package_id, rec.step_key,
              jsonb_build_object('job_type', v_job_type, 'pool', v_pool, 'title', rec.title));
      v_details := array_append(v_details, jsonb_build_object(
        'step', rec.step_key, 'package', rec.package_id, 'job_type', v_job_type, 'title', rec.title));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('reconciled', v_reconciled, 'items', to_jsonb(v_details));
END;
$$;
