
-- 1. View: detect ghost completions in real-time
CREATE OR REPLACE VIEW public.v_ops_ghost_completions AS
SELECT DISTINCT ON (ps.package_id, ps.step_key)
  ps.package_id,
  cp.title,
  cp.priority,
  cp.status as pkg_status,
  cp.track,
  ps.step_key,
  ps.status as step_status,
  jq.status as job_status,
  jq.updated_at as job_completed_at
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
JOIN job_queue jq ON jq.package_id = ps.package_id
  AND jq.status = 'completed'
WHERE ps.status IN ('queued', 'running')
  AND EXISTS (
    SELECT 1 FROM job_queue j2
    WHERE j2.package_id = ps.package_id
      AND j2.status = 'completed'
      AND (
        (ps.step_key = 'auto_seed_exam_blueprints' AND j2.job_type = 'package_auto_seed_exam_blueprints')
        OR (ps.step_key = 'generate_handbook' AND j2.job_type = 'package_generate_handbook')
        OR (ps.step_key = 'generate_lesson_minichecks' AND j2.job_type = 'package_generate_lesson_minichecks')
        OR (ps.step_key = 'generate_exam_pool' AND j2.job_type = 'package_generate_exam_pool')
        OR (ps.step_key = 'generate_oral_exam' AND j2.job_type = 'package_generate_oral_exam')
        OR (ps.step_key = 'generate_learning_content' AND j2.job_type = 'package_generate_learning_content')
        OR (ps.step_key = 'validate_learning_content' AND j2.job_type = 'package_validate_learning_content')
        OR (ps.step_key = 'validate_blueprints' AND j2.job_type = 'package_validate_blueprints')
        OR (ps.step_key = 'validate_exam_pool' AND j2.job_type = 'package_validate_exam_pool')
        OR (ps.step_key = 'elite_harden' AND j2.job_type = 'package_elite_harden')
        OR (ps.step_key = 'build_ai_tutor_index' AND j2.job_type = 'package_build_ai_tutor_index')
      )
  )
ORDER BY ps.package_id, ps.step_key, jq.updated_at DESC;

-- 2. Function: auto-heal ghost completions
CREATE OR REPLACE FUNCTION public.fn_heal_ghost_completions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_details jsonb := '[]'::jsonb;
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT package_id, title, step_key, step_status, pkg_status
    FROM v_ops_ghost_completions
    WHERE pkg_status = 'building'
    LIMIT 20
  LOOP
    UPDATE package_steps
    SET status = 'done',
        updated_at = now(),
        started_at = COALESCE(started_at, now() - interval '1 hour'),
        attempts = GREATEST(attempts, 1),
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'auto_healed_ghost', true,
          'healed_at', now()::text
        )
    WHERE package_id = v_rec.package_id
      AND step_key = v_rec.step_key
      AND status IN ('queued', 'running');

    v_healed := v_healed + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id,
      'title', v_rec.title,
      'step_key', v_rec.step_key
    );
  END LOOP;

  RETURN jsonb_build_object('healed', v_healed, 'details', v_details);
END;
$$;

-- 3. Function: reconcile orphan steps (step=queued, no job exists)
CREATE OR REPLACE FUNCTION public.fn_reconcile_orphan_steps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found int := 0;
  v_details jsonb := '[]'::jsonb;
  v_rec record;
  v_job_type text;
BEGIN
  FOR v_rec IN
    SELECT ps.package_id, cp.title, ps.step_key, cp.status as pkg_status
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE cp.status = 'building'
      AND ps.status = 'queued'
      AND ps.step_key IN (
        'auto_seed_exam_blueprints', 'validate_blueprints',
        'generate_exam_pool', 'validate_exam_pool',
        'generate_oral_exam', 'generate_lesson_minichecks',
        'generate_handbook', 'elite_harden',
        'build_ai_tutor_index', 'validate_tutor_index',
        'run_integrity_check', 'quality_council'
      )
      -- No active or pending job exists
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.status IN ('pending', 'processing', 'retry')
          AND jq.job_type = 'package_' || ps.step_key
      )
      -- No completed job either (those are ghost completions, handled above)
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.status = 'completed'
          AND jq.job_type = 'package_' || ps.step_key
      )
      -- Step has been queued for > 30 min without any job
      AND ps.updated_at < now() - interval '30 minutes'
    LIMIT 10
  LOOP
    v_job_type := 'package_' || v_rec.step_key;
    
    -- Insert the missing job
    INSERT INTO job_queue (package_id, job_type, status, payload, max_attempts)
    VALUES (
      v_rec.package_id,
      v_job_type,
      'pending',
      jsonb_build_object('package_id', v_rec.package_id, 'triggered_by', 'orphan_reconciler'),
      8
    )
    ON CONFLICT DO NOTHING;

    v_found := v_found + 1;
    v_details := v_details || jsonb_build_object(
      'package_id', v_rec.package_id,
      'title', v_rec.title,
      'step_key', v_rec.step_key,
      'action', 'job_enqueued'
    );
  END LOOP;

  RETURN jsonb_build_object('reconciled', v_found, 'details', v_details);
END;
$$;
