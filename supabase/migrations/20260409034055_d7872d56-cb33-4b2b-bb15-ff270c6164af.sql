
-- build_ai_tutor_index (4 Pakete)
UPDATE public.package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now() - interval '1 minute'),
    attempts = GREATEST(attempts, 1),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'postcondition_verified', true,
      'healed_by', 'step_sync_gap_fix',
      'healed_at', now()::text
    ),
    updated_at = now()
WHERE step_key = 'build_ai_tutor_index'
  AND status = 'queued'
  AND package_id IN (
    'c5000000-0004-4000-8000-000000000001',
    'a0b0c0d0-0010-4000-8000-000000000001',
    '6a2c6859-4b3b-4f6e-b32d-c2574a1333ad',
    'f2039067-e58a-4e94-9573-b5953d435873'
  );

-- generate_oral_exam (2 Pakete)
UPDATE public.package_steps
SET status = 'done',
    started_at = COALESCE(started_at, now() - interval '1 minute'),
    attempts = GREATEST(attempts, 1),
    last_error = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'postcondition_verified', true,
      'healed_by', 'step_sync_gap_fix',
      'healed_at', now()::text
    ),
    updated_at = now()
WHERE step_key = 'generate_oral_exam'
  AND status = 'queued'
  AND last_error ILIKE '%STALE_LOCK_EXHAUSTED%'
  AND package_id IN (
    'ccdcb409-b708-460c-834d-254a382f8b28',
    '38f58d97-20a2-49b5-8ba4-737a7887d521'
  );

-- DAUERMAASSNAHME
CREATE OR REPLACE FUNCTION public.fn_sync_steps_from_completed_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_synced int := 0;
  v_rec record;
  v_step_map jsonb := '{
    "package_build_ai_tutor_index": "build_ai_tutor_index",
    "package_generate_oral_exam": "generate_oral_exam",
    "package_generate_handbook": "generate_handbook",
    "package_generate_exam_pool": "generate_exam_pool",
    "package_generate_glossary": "generate_glossary",
    "package_generate_lesson_minichecks": "generate_lesson_minichecks",
    "package_elite_harden": "elite_harden",
    "package_validate_exam_pool": "validate_exam_pool",
    "package_validate_learning_content": "validate_learning_content"
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
      AND jq.completed_at > ps.updated_at
    WHERE ps.status IN ('queued', 'failed')
      AND ps.step_key = COALESCE(v_step_map->>jq.job_type, '')
      AND jq.completed_at > now() - interval '2 hours'
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
    WHERE id = v_rec.step_id AND status IN ('queued', 'failed');
    IF FOUND THEN
      v_synced := v_synced + 1;
      INSERT INTO admin_actions (action, user_id, payload, scope)
      VALUES ('step_sync_from_completed_job', 'system',
        jsonb_build_object('package_id', v_rec.package_id, 'step_key', v_rec.step_key, 'completed_job_id', v_rec.job_id),
        'auto_heal');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('synced', v_synced, 'type', 'step_sync_from_completed_jobs');
END;
$$;
