
-- ============================================================
-- Priority 1: Verify fn_is_bronze_locked grants (idempotent)
-- ============================================================
REVOKE ALL ON FUNCTION public.fn_is_bronze_locked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_bronze_locked(uuid) TO service_role;

-- ============================================================
-- Priority 2a: Extend bronze pre-check in reconciler to include integrity_check
--               + tag enqueue_source so trigger does not log 'unknown'
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_reconcile_orphan_steps()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reconciled int := 0;
  v_checked int := 0;
  v_blocked_inflight int := 0;
  v_blocked_cooldown int := 0;
  v_blocked_fanout int := 0;
  v_blocked_too_young int := 0;
  v_blocked_unknown_step int := 0;
  v_blocked_dag int := 0;
  v_blocked_bronze int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  v_step_dist jsonb := '{}'::jsonb;
  rec record;
  v_job_type text;
  v_pool text;
  v_dag_ok boolean;
  v_recent_audit boolean;
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
  v_fanout_job_types text[] := ARRAY[
    'package_generate_blueprint_variants',
    'package_fanout_learning_content'
  ];
  -- ★ EXTENDED: integrity_check now also bronze-blocked at producer-side
  v_bronze_blocked_types text[] := ARRAY[
    'package_quality_council',
    'package_auto_publish',
    'package_run_integrity_check'
  ];
  v_allowed_pkg_states text[] := ARRAY['building', 'council_review'];
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, ps.updated_at AS step_updated_at,
           cp.priority, cp.curriculum_id, cp.status AS pkg_status, c.title, cp.course_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.id = cp.course_id
    WHERE ps.status = 'queued'
      AND cp.status = ANY(v_allowed_pkg_states)
      AND cp.curriculum_id IS NOT NULL
    ORDER BY cp.priority, ps.package_id
    LIMIT 100
  LOOP
    v_checked := v_checked + 1;
    v_step_dist := jsonb_set(v_step_dist, ARRAY[rec.step_key],
      to_jsonb(COALESCE((v_step_dist ->> rec.step_key)::int, 0) + 1));

    v_job_type := v_step_jobs ->> rec.step_key;

    IF v_job_type IS NULL THEN
      v_blocked_unknown_step := v_blocked_unknown_step + 1;
      CONTINUE;
    END IF;

    -- Bronze-Pre-Filter (now incl. integrity_check)
    IF v_job_type = ANY(v_bronze_blocked_types)
       AND public.fn_is_bronze_locked(rec.package_id) THEN
      v_blocked_bronze := v_blocked_bronze + 1;
      SELECT EXISTS(
        SELECT 1 FROM auto_heal_log
        WHERE action_type='reconcile_skipped_bronze_locked'
          AND target_id = rec.package_id::text
          AND metadata->>'job_type' = v_job_type
          AND created_at > now() - interval '1 hour'
      ) INTO v_recent_audit;
      IF NOT v_recent_audit THEN
        INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,metadata)
        VALUES('reconcile_skipped_bronze_locked','course_package',rec.package_id::text,'skipped',
          jsonb_build_object(
            'enqueue_source','orphan_reconciler',
            'job_type',v_job_type,
            'step_key',rec.step_key,
            'reason','BRONZE_LOCKED_REQUIRES_REVIEW',
            'source_fn','fn_reconcile_orphan_steps'));
      END IF;
      CONTINUE;
    END IF;

    IF rec.step_updated_at > now() - interval '10 minutes' THEN
      v_blocked_too_young := v_blocked_too_young + 1;
      CONTINUE;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1
      FROM step_dag_edges sde
      JOIN package_steps pred ON pred.package_id = rec.package_id
                              AND pred.step_key = sde.depends_on
      WHERE sde.step_key = rec.step_key
        AND pred.status NOT IN ('done', 'skipped')
    ) INTO v_dag_ok;

    IF NOT v_dag_ok THEN
      v_blocked_dag := v_blocked_dag + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = v_job_type
        AND jq.status IN ('pending', 'processing', 'batch_pending')
    ) THEN
      v_blocked_inflight := v_blocked_inflight + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = v_job_type
        AND jq.status = 'failed'
        AND jq.updated_at > now() - interval '10 minutes'
    ) THEN
      v_blocked_cooldown := v_blocked_cooldown + 1;
      CONTINUE;
    END IF;

    IF v_job_type = ANY(v_fanout_job_types) AND EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = v_job_type
        AND jq.status IN ('pending', 'processing', 'batch_pending')
        AND (
          (jq.payload->>'blueprintId') IS NOT NULL
          OR (jq.payload->>'lesson_id') IS NOT NULL
          OR (jq.payload->>'shard_key') IS NOT NULL
        )
    ) THEN
      v_blocked_fanout := v_blocked_fanout + 1;
      CONTINUE;
    END IF;

    v_pool := CASE
      WHEN v_job_type IN ('package_quality_council','package_auto_publish','package_run_integrity_check') THEN 'control'
      ELSE 'general'
    END;

    -- ★ Tag enqueue_source so trigger does not log 'unknown'
    INSERT INTO job_queue (
      job_type, status, priority, payload, scheduled_at,
      worker_pool, package_id
    )
    VALUES (
      v_job_type, 'pending'::job_status, COALESCE(rec.priority, 5),
      jsonb_build_object(
        'package_id', rec.package_id,
        'curriculum_id', rec.curriculum_id,
        'course_id', rec.course_id,
        'step_key', rec.step_key,
        'reconciled_at', now(),
        'enqueue_source', 'orphan_reconciler'
      ),
      now(), v_pool, rec.package_id
    );

    v_reconciled := v_reconciled + 1;
    v_details := array_append(v_details, jsonb_build_object(
      'package_id', rec.package_id,
      'step_key', rec.step_key,
      'job_type', v_job_type
    ));
  END LOOP;

  IF v_reconciled > 0 THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, result_status, metadata)
    VALUES('reconcile_orphan_steps', 'fn_reconcile_orphan_steps', 'system', 'success',
      jsonb_build_object(
        'reconciled', v_reconciled,
        'checked', v_checked,
        'step_dist', v_step_dist,
        'blocked_bronze', v_blocked_bronze,
        'enqueue_source', 'orphan_reconciler'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reconciled', v_reconciled,
    'checked', v_checked,
    'blocked_bronze', v_blocked_bronze,
    'blocked_inflight', v_blocked_inflight,
    'blocked_cooldown', v_blocked_cooldown,
    'blocked_fanout', v_blocked_fanout,
    'blocked_too_young', v_blocked_too_young,
    'blocked_unknown_step', v_blocked_unknown_step,
    'blocked_dag', v_blocked_dag,
    'step_dist', v_step_dist
  );
END;
$function$;

-- ============================================================
-- Priority 2c: View v_courses_publishable (no phantom courses)
-- ============================================================
CREATE OR REPLACE VIEW public.v_courses_publishable AS
SELECT
  c.*,
  COALESCE(mc.module_count, 0) AS module_count,
  COALESCE(lc.lesson_count, 0) AS lesson_count
FROM public.courses c
LEFT JOIN (
  SELECT course_id, COUNT(*) AS module_count
  FROM public.modules
  GROUP BY course_id
) mc ON mc.course_id = c.id
LEFT JOIN (
  SELECT m.course_id, COUNT(l.*) AS lesson_count
  FROM public.modules m
  LEFT JOIN public.lessons l ON l.module_id = m.id
  GROUP BY m.course_id
) lc ON lc.course_id = c.id
WHERE COALESCE(mc.module_count, 0) > 0
  AND COALESCE(lc.lesson_count, 0) > 0;

GRANT SELECT ON public.v_courses_publishable TO anon, authenticated;
