
CREATE OR REPLACE FUNCTION public.fn_reconcile_orphan_steps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reconciled int := 0;
  v_checked int := 0;
  v_blocked_inflight int := 0;
  v_blocked_cooldown int := 0;
  v_blocked_fanout int := 0;
  v_blocked_too_young int := 0;
  v_blocked_unknown_step int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  v_step_dist jsonb := '{}'::jsonb;
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
  v_fanout_job_types text[] := ARRAY[
    'package_generate_blueprint_variants',
    'package_fanout_learning_content'
  ];
  -- Explicitly allowed package states for reconciliation
  v_allowed_pkg_states text[] := ARRAY['building', 'council_review'];
BEGIN
  -- Iterate ALL queued steps in allowed packages for telemetry
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
    -- Track step_key distribution
    v_step_dist := jsonb_set(v_step_dist, ARRAY[rec.step_key],
      to_jsonb(COALESCE((v_step_dist ->> rec.step_key)::int, 0) + 1));

    v_job_type := v_step_jobs ->> rec.step_key;

    -- Unknown step_key
    IF v_job_type IS NULL THEN
      v_blocked_unknown_step := v_blocked_unknown_step + 1;
      CONTINUE;
    END IF;

    -- Age-Gate: step must be at least 10 min old
    IF rec.step_updated_at > now() - interval '10 minutes' THEN
      v_blocked_too_young := v_blocked_too_young + 1;
      CONTINUE;
    END IF;

    -- Inflight check
    IF EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = v_job_type
        AND jq.status IN ('pending', 'processing', 'batch_pending')
    ) THEN
      v_blocked_inflight := v_blocked_inflight + 1;
      CONTINUE;
    END IF;

    -- Cooldown check (10min after failure)
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

    -- Fan-out guard
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

    -- All guards passed → rematerialize
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
        'package_id', rec.package_id::text,
        'curriculum_id', rec.curriculum_id::text,
        'course_id', rec.course_id::text,
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

  RETURN jsonb_build_object(
    'checked', v_checked,
    'reconciled', v_reconciled,
    'blocked_inflight', v_blocked_inflight,
    'blocked_cooldown', v_blocked_cooldown,
    'blocked_fanout', v_blocked_fanout,
    'blocked_too_young', v_blocked_too_young,
    'blocked_unknown_step', v_blocked_unknown_step,
    'step_key_distribution', v_step_dist,
    'items', to_jsonb(v_details)
  );
END;
$$;
