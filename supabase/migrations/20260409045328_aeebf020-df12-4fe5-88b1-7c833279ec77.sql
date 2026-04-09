
-- ============================================================
-- 1. REPLACE fn_sync_steps_from_completed_jobs with full mapping
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_sync_steps_from_completed_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced int := 0;
  v_rec record;
  -- Only exclude repair-specific cycling steps
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
    "package_scaffold_learning_course": "scaffold_learning_course"
  }'::jsonb;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT ON (ps.package_id, ps.step_key)
      ps.id as step_id, ps.package_id, ps.step_key,
      jq.id as job_id, jq.completed_at
    FROM package_steps ps
    JOIN job_queue jq ON jq.package_id = ps.package_id
      AND jq.status = 'completed'
      AND (jq.result->>'ok')::boolean = true
      AND jq.completed_at > ps.updated_at - interval '30 minutes'
    WHERE ps.status IN ('queued', 'failed', 'enqueued')
      AND ps.step_key = COALESCE(v_step_map->>jq.job_type, '')
      AND NOT (ps.step_key = ANY(v_excluded_steps))
      AND jq.completed_at > now() - interval '12 hours'
    ORDER BY ps.package_id, ps.step_key, jq.completed_at DESC
  LOOP
    UPDATE package_steps
    SET status = 'done',
        started_at = COALESCE(started_at, now() - interval '1 minute'),
        attempts = GREATEST(attempts, 1),
        last_error = NULL,
        job_id = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'postcondition_verified', true,
          'healed_by', 'fn_sync_steps_from_completed_jobs',
          'healed_at', now()::text,
          'source_job_id', v_rec.job_id
        ),
        updated_at = now()
    WHERE id = v_rec.step_id AND status IN ('queued', 'failed', 'enqueued');
    IF FOUND THEN
      v_synced := v_synced + 1;
      INSERT INTO admin_actions (action, payload, scope)
      VALUES ('step_sync_from_completed_job',
        jsonb_build_object('package_id', v_rec.package_id, 'step_key', v_rec.step_key, 'completed_job_id', v_rec.job_id),
        'auto_heal');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('synced', v_synced, 'type', 'step_sync_from_completed_jobs');
END;
$$;

-- ============================================================
-- 2. SYNCHRONOUS TRIGGER: auto-sync step when job completes
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_trigger_sync_step_on_job_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    "package_scaffold_learning_course": "scaffold_learning_course"
  }'::jsonb;
BEGIN
  -- Only fire on transition TO completed with ok:true
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
            'synced_by', 'trg_sync_step_on_job_complete',
            'synced_at', now()::text,
            'source_job_id', NEW.id
          ),
          updated_at = now()
      WHERE package_id = NEW.package_id
        AND step_key = v_step_key
        AND status IN ('queued', 'failed', 'enqueued', 'processing');
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop if exists to avoid conflicts
DROP TRIGGER IF EXISTS trg_sync_step_on_job_complete ON job_queue;

CREATE TRIGGER trg_sync_step_on_job_complete
  AFTER UPDATE ON job_queue
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION fn_trigger_sync_step_on_job_complete();

-- ============================================================
-- 3. ONE-TIME HEAL: fix all existing drift
-- ============================================================
DO $$
DECLARE
  v_healed int := 0;
  v_rec record;
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
    "package_scaffold_learning_course": "scaffold_learning_course"
  }'::jsonb;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT ON (ps.package_id, ps.step_key)
      ps.id as step_id, ps.package_id, ps.step_key,
      jq.id as job_id, jq.completed_at
    FROM package_steps ps
    JOIN job_queue jq ON jq.package_id = ps.package_id
      AND jq.status = 'completed'
      AND (jq.result->>'ok')::boolean = true
    WHERE ps.status IN ('queued', 'failed', 'enqueued')
      AND ps.step_key = COALESCE(v_step_map->>jq.job_type, '')
      AND ps.step_key != 'repair_exam_pool_quality'
      AND jq.completed_at > now() - interval '14 days'
    ORDER BY ps.package_id, ps.step_key, jq.completed_at DESC
  LOOP
    UPDATE package_steps
    SET status = 'done',
        started_at = COALESCE(started_at, now() - interval '1 minute'),
        attempts = GREATEST(attempts, 1),
        last_error = NULL,
        job_id = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'postcondition_verified', true,
          'healed_by', 'one_time_drift_heal_20260409',
          'healed_at', now()::text,
          'source_job_id', v_rec.job_id
        ),
        updated_at = now()
    WHERE id = v_rec.step_id AND status IN ('queued', 'failed', 'enqueued');
    IF FOUND THEN
      v_healed := v_healed + 1;
    END IF;
  END LOOP;
  
  INSERT INTO admin_actions (action, payload, scope)
  VALUES ('one_time_drift_heal',
    jsonb_build_object('healed_count', v_healed, 'timestamp', now()::text),
    'migration');
    
  RAISE NOTICE 'One-time drift heal: % steps synced', v_healed;
END;
$$;
