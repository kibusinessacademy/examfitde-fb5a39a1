
-- View: v_pipeline_repair_classification
-- Classifies all building packages into repair categories
CREATE OR REPLACE VIEW public.v_pipeline_repair_classification AS
WITH step_state AS (
  SELECT
    ps.package_id,
    COUNT(*) FILTER (WHERE ps.status = 'done') AS done_steps,
    COUNT(*) AS total_steps,
    MAX(CASE WHEN ps.step_key = 'generate_learning_content' THEN ps.status::text END) AS gen_status,
    MAX(CASE WHEN ps.step_key = 'validate_learning_content' THEN ps.status::text END) AS val_status,
    MAX(CASE WHEN ps.step_key = 'generate_learning_content' THEN ps.updated_at END) AS gen_updated_at
  FROM package_steps ps
  GROUP BY ps.package_id
),
job_state AS (
  SELECT
    jq.package_id AS pkg_id,
    COUNT(*) FILTER (WHERE jq.job_type = 'lesson_generate_content_shard' AND jq.status = 'completed') AS shard_completed,
    COUNT(*) FILTER (WHERE jq.job_type = 'lesson_generate_content_shard' AND jq.status = 'failed') AS shard_failed,
    COUNT(*) FILTER (WHERE jq.job_type = 'lesson_generate_content' AND jq.status = 'completed') AS legacy_content_completed,
    COUNT(*) FILTER (WHERE jq.job_type = 'package_finalize_learning_content' AND jq.status = 'completed') AS finalizer_completed,
    COUNT(*) FILTER (WHERE jq.job_type = 'package_finalize_learning_content' AND jq.status IN ('pending','queued','processing','running')) AS finalizer_active,
    COUNT(*) FILTER (WHERE jq.job_type = 'package_finalize_learning_content' AND jq.status = 'failed') AS finalizer_failed,
    MAX(jq.completed_at) FILTER (WHERE jq.job_type IN ('lesson_generate_content','lesson_generate_content_shard') AND jq.status = 'completed') AS last_content_job_at
  FROM job_queue jq
  WHERE jq.package_id IS NOT NULL
  GROUP BY jq.package_id
)
SELECT
  cp.id AS package_id,
  cp.title,
  cp.build_progress AS stored_progress,
  ss.done_steps,
  ss.total_steps,
  ROUND((ss.done_steps::numeric / NULLIF(ss.total_steps, 0)) * 100, 0)::int AS real_progress,
  (cp.build_progress - ROUND((ss.done_steps::numeric / NULLIF(ss.total_steps, 0)) * 100, 0))::int AS drift,
  ss.gen_status,
  ss.val_status,
  COALESCE(js.shard_completed, 0) AS shard_completed,
  COALESCE(js.shard_failed, 0) AS shard_failed,
  COALESCE(js.legacy_content_completed, 0) AS legacy_content_completed,
  COALESCE(js.finalizer_completed, 0) AS finalizer_completed,
  COALESCE(js.finalizer_active, 0) AS finalizer_active,
  COALESCE(js.finalizer_failed, 0) AS finalizer_failed,
  js.last_content_job_at,
  CASE
    WHEN ROUND((ss.done_steps::numeric / NULLIF(ss.total_steps, 0)) * 100, 0) >= cp.build_progress - 3
      THEN 'A_HEALTHY'
    WHEN ss.gen_status = 'done' AND ss.val_status = 'done'
      THEN 'A_HEALTHY'
    WHEN COALESCE(js.shard_failed, 0) > 0 AND COALESCE(js.shard_completed, 0) = 0
      THEN 'C_SHARD_DEFECT'
    -- Legacy path: lots of lesson_generate_content completed but no finalizer
    WHEN COALESCE(js.legacy_content_completed, 0) > 10
         AND COALESCE(js.finalizer_completed, 0) = 0
         AND ss.gen_status IN ('queued', 'enqueued', 'running')
      THEN 'B_LEGACY_REFINALIZE'
    -- Shard path: shards done but no finalizer
    WHEN COALESCE(js.shard_completed, 0) > 0
         AND COALESCE(js.finalizer_completed, 0) = 0
         AND COALESCE(js.finalizer_active, 0) = 0
         AND ss.gen_status IN ('queued', 'enqueued', 'running')
      THEN 'B_SHARD_REFINALIZE'
    -- Finalizer completed but step not done
    WHEN COALESCE(js.finalizer_completed, 0) > 0
         AND ss.gen_status != 'done'
      THEN 'B_STEP_STUCK'
    ELSE 'B_ORCHESTRATION_DRIFT'
  END AS repair_class
FROM course_packages cp
JOIN step_state ss ON ss.package_id = cp.id
LEFT JOIN job_state js ON js.pkg_id = cp.id
WHERE cp.status = 'building';

-- RPC: reconcile_legacy_content_steps
-- For packages that used the legacy lesson_generate_content path (no fanout/shards),
-- checks actual lesson coverage and marks generate_learning_content as done if threshold met.
CREATE OR REPLACE FUNCTION public.reconcile_legacy_content_steps(p_package_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_course_id uuid;
  v_curriculum_id uuid;
  v_total_lessons int;
  v_real_lessons int;
  v_coverage numeric;
  v_results jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_threshold numeric := 0.90;
BEGIN
  FOR v_pkg IN
    SELECT r.package_id, r.title, r.repair_class, r.gen_status
    FROM v_pipeline_repair_classification r
    WHERE r.repair_class IN ('B_LEGACY_REFINALIZE', 'B_ORCHESTRATION_DRIFT')
      AND (p_package_id IS NULL OR r.package_id = p_package_id)
    ORDER BY r.title
  LOOP
    -- Get course_id
    SELECT cp.course_id, cp.curriculum_id
    INTO v_course_id, v_curriculum_id
    FROM course_packages cp
    WHERE cp.id = v_pkg.package_id;

    IF v_course_id IS NULL THEN
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.package_id,
        'title', v_pkg.title,
        'action', 'skipped',
        'reason', 'no_course_id'
      );
      CONTINUE;
    END IF;

    -- Count lessons and real content
    SELECT
      COUNT(*),
      COUNT(*) FILTER (WHERE length(COALESCE(l.content, '')) >= 300)
    INTO v_total_lessons, v_real_lessons
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = v_course_id;

    v_coverage := CASE WHEN v_total_lessons > 0
      THEN v_real_lessons::numeric / v_total_lessons
      ELSE 0 END;

    IF v_coverage >= v_threshold AND v_total_lessons > 0 THEN
      -- Mark generate_learning_content as done
      UPDATE package_steps
      SET status = 'done',
          updated_at = v_now,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'reconciled_at', v_now,
            'reconcile_source', 'legacy_path',
            'total_lessons', v_total_lessons,
            'real_lessons', v_real_lessons,
            'coverage', round(v_coverage * 100, 1)
          )
      WHERE package_id = v_pkg.package_id
        AND step_key = 'generate_learning_content'
        AND status != 'done';

      -- Also ensure validate_learning_content is queued (not blocked)
      UPDATE package_steps
      SET status = 'queued',
          updated_at = v_now
      WHERE package_id = v_pkg.package_id
        AND step_key = 'validate_learning_content'
        AND status NOT IN ('done', 'running', 'enqueued');

      -- Log the heal
      INSERT INTO auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
      VALUES (
        'reconcile_legacy_content',
        'course_package',
        v_pkg.package_id::text,
        'reconcile_legacy_content_steps',
        'healed',
        format('Coverage %.1f%% (%s/%s lessons) — marked generate_learning_content done',
          v_coverage * 100, v_real_lessons, v_total_lessons),
        jsonb_build_object(
          'coverage', round(v_coverage * 100, 1),
          'real_lessons', v_real_lessons,
          'total_lessons', v_total_lessons,
          'repair_class', v_pkg.repair_class
        )
      );

      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.package_id,
        'title', v_pkg.title,
        'action', 'healed',
        'coverage', round(v_coverage * 100, 1),
        'real_lessons', v_real_lessons,
        'total_lessons', v_total_lessons
      );
    ELSE
      v_results := v_results || jsonb_build_object(
        'package_id', v_pkg.package_id,
        'title', v_pkg.title,
        'action', 'insufficient_coverage',
        'coverage', round(v_coverage * 100, 1),
        'real_lessons', v_real_lessons,
        'total_lessons', v_total_lessons
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reconciled', v_results);
END;
$$;
