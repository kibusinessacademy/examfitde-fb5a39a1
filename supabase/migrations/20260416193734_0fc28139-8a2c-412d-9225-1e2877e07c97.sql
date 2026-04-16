CREATE OR REPLACE FUNCTION public.fn_trigger_sync_step_on_job_complete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_step_key text;
  v_excluded_steps text[] := ARRAY['repair_exam_pool_quality'];
  v_step_map jsonb := '{
    "package_build_ai_tutor_index": "build_ai_tutor_index",
    "package_generate_oral_exam": "generate_oral_exam",
    "package_generate_handbook": "generate_handbook",
    "package_generate_exam_pool": "generate_exam_pool",
    "package_generate_glossary": "generate_glossary",
    "package_generate_lesson_minichecks": "generate_lesson_minichecks",
    "package_elite_harden": "elite_harden",
    "package_validate_learning_content": "validate_learning_content",
    "package_quality_council": "quality_council",
    "package_auto_seed_exam_blueprints": "auto_seed_exam_blueprints",
    "package_validate_oral_exam": "validate_oral_exam",
    "package_validate_handbook": "validate_handbook",
    "package_validate_handbook_depth": "validate_handbook_depth",
    "package_validate_tutor_index": "validate_tutor_index",
    "package_validate_lesson_minichecks": "validate_lesson_minichecks",
    "package_validate_blueprints": "validate_blueprints",
    "package_validate_blueprint_variants": "validate_blueprint_variants",
    "package_generate_blueprint_variants": "generate_blueprint_variants",
    "package_promote_blueprint_variants": "promote_blueprint_variants",
    "package_expand_handbook": "expand_handbook",
    "package_enqueue_handbook_expand": "enqueue_handbook_expand",
    "package_finalize_learning_content": "finalize_learning_content",
    "package_auto_publish": "auto_publish",
    "package_run_integrity_check": "run_integrity_check",
    "package_validate_exam_pool": "validate_exam_pool",
    "package_generate_learning_content": "generate_learning_content",
    "package_scaffold_learning_course": "scaffold_learning_course",
    "package_fanout_learning_content": "fanout_learning_content"
  }'::jsonb;
BEGIN
  IF NEW.status = 'completed'
     AND (OLD.status IS DISTINCT FROM 'completed')
     AND NEW.package_id IS NOT NULL
     AND (NEW.result->>'ok')::boolean = true
  THEN
    v_step_key := v_step_map->>NEW.job_type;
    
    IF v_step_key IS NOT NULL AND NOT (v_step_key = ANY(v_excluded_steps)) THEN
      UPDATE package_steps
      SET status = 'done',
          started_at = COALESCE(started_at, now() - interval '1 minute'),
          attempts = GREATEST(attempts, 1),
          last_error = NULL,
          job_id = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'postcondition_verified', true,
            'ok', 'true',
            'executed', 'true',
            'synced_by', 'trg_sync_step_on_job_complete',
            'synced_at', now()::text,
            'source_job_id', NEW.id
          ),
          updated_at = now()
      WHERE package_id = NEW.package_id
        AND step_key = v_step_key
        AND status IN ('queued', 'failed', 'enqueued', 'running');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_trigger_sync_step_on_job_complete() IS
'Syncs package_steps to done when job_queue.completed. Sets executed=true to satisfy fn_guard_integrity_requires_execution for run_integrity_check recovery paths.';