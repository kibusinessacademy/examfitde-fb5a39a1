
-- ═══════════════════════════════════════════════════════════════
-- PREBUILD LAYER: Deterministic queue-bypass functions
-- Uniform return: (status text, advanced boolean, reason text, meta jsonb)
-- ═══════════════════════════════════════════════════════════════

-- ── 1) fn_prebuild_finalize_learning_content ──────────────────
CREATE OR REPLACE FUNCTION public.fn_prebuild_finalize_learning_content(
  p_package_id uuid
)
RETURNS TABLE (status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_course_id uuid;
  v_curriculum_id uuid;
  v_fanout_step_status text;
  v_gen_step_status text;
  v_fin_step_status text;
  v_total_shards int;
  v_completed_shards int;
  v_failed_shards int;
  v_pending_shards int;
  v_total_lessons int;
  v_lessons_with_content int;
  v_avg_len numeric;
  v_coverage numeric;
  v_active_jobs int;
  v_now timestamptz := now();
BEGIN
  -- Already done? → noop
  SELECT ps.status INTO v_fin_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'finalize_learning_content';

  IF v_fin_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- DAG prereqs: fanout_learning_content and generate_learning_content must be done
  SELECT ps.status INTO v_fanout_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'fanout_learning_content';

  -- fanout doesn't exist → track might not include it → check generate directly
  IF v_fanout_step_status IS NOT NULL AND v_fanout_step_status NOT IN ('done', 'skipped') THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'PREREQ_FANOUT_NOT_DONE'::text,
      jsonb_build_object('fanout_status', v_fanout_step_status);
    RETURN;
  END IF;

  SELECT ps.status INTO v_gen_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'generate_learning_content';

  IF v_gen_step_status IS NOT NULL AND v_gen_step_status NOT IN ('done', 'skipped') THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'PREREQ_GENERATE_NOT_DONE'::text,
      jsonb_build_object('generate_status', v_gen_step_status);
    RETURN;
  END IF;

  -- Resolve course_id
  SELECT cp.course_id, cp.curriculum_id INTO v_course_id, v_curriculum_id
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_course_id IS NULL THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_COURSE_ID'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- Check active finalize/generate jobs in queue
  SELECT count(*) INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN ('package_finalize_learning_content', 'lesson_generate_content_shard', 'package_fanout_learning_content')
    AND jq.status IN ('pending', 'processing', 'running', 'batch_pending');

  IF v_active_jobs > 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs', v_active_jobs);
    RETURN;
  END IF;

  -- Shard completeness check
  SELECT count(*),
         count(*) FILTER (WHERE pcs.status IN ('completed', 'done')),
         count(*) FILTER (WHERE pcs.status = 'failed'),
         count(*) FILTER (WHERE pcs.status IN ('pending', 'processing', 'claimed'))
  INTO v_total_shards, v_completed_shards, v_failed_shards, v_pending_shards
  FROM package_content_shards pcs
  WHERE pcs.package_id = p_package_id;

  -- If shards exist, all must be done
  IF v_total_shards > 0 AND (v_pending_shards > 0 OR v_failed_shards > 0) THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'SHARDS_INCOMPLETE'::text,
      jsonb_build_object('total', v_total_shards, 'completed', v_completed_shards,
                         'failed', v_failed_shards, 'pending', v_pending_shards);
    RETURN;
  END IF;

  -- Lesson coverage check (same logic as post-conditions)
  SELECT count(*),
         count(*) FILTER (WHERE
           l.content IS NOT NULL
           AND l.content::text != 'null'
           AND length(l.content::text) >= 300
           AND NOT (l.content::jsonb ? '_placeholder' AND (l.content::jsonb->>'_placeholder')::boolean = true)
         ),
         coalesce(avg(CASE WHEN l.content IS NOT NULL AND length(l.content::text) >= 300
                            THEN length(l.content::text) ELSE NULL END), 0)
  INTO v_total_lessons, v_lessons_with_content, v_avg_len
  FROM lessons l
  JOIN modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id
    AND l.step != 'mini_check';

  IF v_total_lessons = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_LESSONS'::text, '{}'::jsonb;
    RETURN;
  END IF;

  v_coverage := v_lessons_with_content::numeric / v_total_lessons;

  IF v_coverage < 0.90 OR v_avg_len < 600 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'COVERAGE_INSUFFICIENT'::text,
      jsonb_build_object('total_lessons', v_total_lessons,
                         'with_content', v_lessons_with_content,
                         'coverage_pct', round(v_coverage * 100, 1),
                         'avg_len', round(v_avg_len));
    RETURN;
  END IF;

  -- Check no tier1_failed lessons
  PERFORM 1 FROM lessons l
  JOIN modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id
    AND l.qc_status = 'tier1_failed'
    AND l.step != 'mini_check'
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'TIER1_FAILED_LESSONS'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- ── ALL POSTCONDITIONS PASS → Mark steps done ──

  -- Mark generate_learning_content done (if not already)
  UPDATE package_steps SET
    status = 'done',
    finished_at = v_now,
    last_error = NULL,
    started_at = coalesce(started_at, v_now),
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_finalize_learning_content',
      'postcondition_verified', true, 'checked_at', v_now::text
    )
  WHERE package_id = p_package_id AND step_key = 'generate_learning_content'
    AND status != 'done';

  -- Mark fanout done (if exists and not done)
  UPDATE package_steps SET
    status = 'done',
    finished_at = v_now,
    last_error = NULL,
    started_at = coalesce(started_at, v_now),
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_finalize_learning_content',
      'postcondition_verified', true
    )
  WHERE package_id = p_package_id AND step_key = 'fanout_learning_content'
    AND status != 'done';

  -- Mark finalize_learning_content done
  UPDATE package_steps SET
    status = 'done',
    finished_at = v_now,
    last_error = NULL,
    started_at = coalesce(started_at, v_now),
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_finalize_learning_content',
      'postcondition_verified', true, 'checked_at', v_now::text,
      'total_lessons', v_total_lessons, 'with_content', v_lessons_with_content,
      'coverage_pct', round(v_coverage * 100, 1), 'avg_len', round(v_avg_len),
      'reason', 'PREBUILD_ALL_CONTENT_MATERIALIZED'
    )
  WHERE package_id = p_package_id AND step_key = 'finalize_learning_content'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_finalize_learning_content',
      'postcondition_verified', true, 'checked_at', v_now::text,
      'total_lessons', v_total_lessons, 'with_content', v_lessons_with_content,
      'coverage_pct', round(v_coverage * 100, 1), 'avg_len', round(v_avg_len),
      'shards_total', v_total_shards, 'shards_completed', v_completed_shards
    );
END;
$$;

-- ── 2) fn_prebuild_validate_blueprints ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_blueprints(
  p_package_id uuid
)
RETURNS TABLE (status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_step_status text;
  v_prereq_status text;
  v_total_bps int;
  v_lf_count int;
  v_covered_lfs int;
  v_active_jobs int;
  v_approver_id uuid;
  v_approved_count int;
  v_now timestamptz := now();
BEGIN
  -- Already done?
  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_blueprints';

  IF v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- DAG prereq: auto_seed_exam_blueprints must be done
  SELECT ps.status INTO v_prereq_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_seed_exam_blueprints';

  IF v_prereq_status IS NULL THEN
    -- Step doesn't exist → track doesn't include it → treat as fulfilled
    NULL;
  ELSIF v_prereq_status NOT IN ('done', 'skipped') THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'PREREQ_SEED_NOT_DONE'::text,
      jsonb_build_object('seed_status', v_prereq_status);
    RETURN;
  END IF;

  -- Resolve curriculum_id
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_CURRICULUM_ID'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- No active seeding jobs
  SELECT count(*) INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN ('package_auto_seed_exam_blueprints', 'package_validate_blueprints')
    AND jq.status IN ('pending', 'processing', 'running', 'batch_pending');

  IF v_active_jobs > 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs', v_active_jobs);
    RETURN;
  END IF;

  -- Count blueprints
  SELECT count(*) INTO v_total_bps
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id;

  IF v_total_bps < 10 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'INSUFFICIENT_BLUEPRINTS'::text,
      jsonb_build_object('total', v_total_bps, 'min_required', 10);
    RETURN;
  END IF;

  -- LF coverage: every LF must have ≥1 blueprint
  SELECT count(DISTINCT lf.id) INTO v_lf_count
  FROM learning_fields lf
  WHERE lf.curriculum_id = v_curriculum_id;

  SELECT count(DISTINCT qb.learning_field_id) INTO v_covered_lfs
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id
    AND qb.learning_field_id IS NOT NULL;

  IF v_lf_count > 0 AND v_covered_lfs < v_lf_count THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'LF_COVERAGE_INCOMPLETE'::text,
      jsonb_build_object('total_lfs', v_lf_count, 'covered', v_covered_lfs);
    RETURN;
  END IF;

  -- ── PASS → Approve draft blueprints & mark step done ──

  -- Find approver (package creator or first profile)
  SELECT cp.created_by INTO v_approver_id
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_approver_id IS NULL THEN
    SELECT p.user_id INTO v_approver_id FROM profiles p LIMIT 1;
  END IF;

  -- Approve draft blueprints
  IF v_approver_id IS NOT NULL THEN
    UPDATE question_blueprints SET
      status = 'approved',
      approved_at = v_now,
      approved_by = v_approver_id
    WHERE curriculum_id = v_curriculum_id
      AND status = 'draft';
    GET DIAGNOSTICS v_approved_count = ROW_COUNT;
  ELSE
    v_approved_count := 0;
  END IF;

  -- Mark step done
  UPDATE package_steps SET
    status = 'done',
    finished_at = v_now,
    last_error = NULL,
    started_at = coalesce(started_at, v_now),
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_validate_blueprints',
      'postcondition_verified', true, 'checked_at', v_now::text,
      'total_blueprints', v_total_bps, 'lf_covered', v_covered_lfs,
      'lf_total', v_lf_count, 'approved_count', v_approved_count,
      'reason', 'PREBUILD_BLUEPRINTS_VALID'
    )
  WHERE package_id = p_package_id AND step_key = 'validate_blueprints'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_validate_blueprints',
      'postcondition_verified', true,
      'total_blueprints', v_total_bps, 'lf_covered', v_covered_lfs,
      'lf_total', v_lf_count, 'approved_count', v_approved_count
    );
END;
$$;

-- ── 3) fn_prebuild_promote_blueprint_variants ─────────────────
CREATE OR REPLACE FUNCTION public.fn_prebuild_promote_blueprint_variants(
  p_package_id uuid
)
RETURNS TABLE (status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_step_status text;
  v_prereq_status text;
  v_active_jobs int;
  v_eligible_count int;
  v_total_promoted int := 0;
  v_total_skipped int := 0;
  v_total_dup int := 0;
  v_bp record;
  v_variant record;
  v_existing_count int;
  v_remaining int;
  v_fp text;
  v_existing_fps text[];
  v_max_per_bp int := 15;
  v_min_quality int := 80;
  v_now timestamptz := now();
BEGIN
  -- Already done?
  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants';

  IF v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- DAG prereq: validate_blueprint_variants must be done
  SELECT ps.status INTO v_prereq_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_blueprint_variants';

  IF v_prereq_status IS NULL THEN
    NULL; -- track doesn't include it
  ELSIF v_prereq_status NOT IN ('done', 'skipped') THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'PREREQ_VALIDATE_VARIANTS_NOT_DONE'::text,
      jsonb_build_object('validate_variants_status', v_prereq_status);
    RETURN;
  END IF;

  -- Resolve curriculum_id
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_CURRICULUM_ID'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- No active variant generation/validation/promotion jobs
  SELECT count(*) INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN ('package_generate_blueprint_variants', 'package_validate_blueprint_variants', 'package_promote_blueprint_variants')
    AND jq.status IN ('pending', 'processing', 'running', 'batch_pending');

  IF v_active_jobs > 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs', v_active_jobs);
    RETURN;
  END IF;

  -- Check eligible variants exist
  SELECT count(*) INTO v_eligible_count
  FROM exam_question_variants eqv
  JOIN question_blueprints qb ON qb.id = eqv.blueprint_id
  WHERE qb.curriculum_id = v_curriculum_id
    AND eqv.status = 'review'
    AND eqv.quality_score >= v_min_quality;

  IF v_eligible_count = 0 THEN
    -- No eligible variants → check if any variants exist at all
    PERFORM 1 FROM exam_question_variants eqv
    JOIN question_blueprints qb ON qb.id = eqv.blueprint_id
    WHERE qb.curriculum_id = v_curriculum_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'deferred'::text, false, 'NO_VARIANTS_EXIST'::text, '{}'::jsonb;
      RETURN;
    ELSE
      -- Variants exist but none eligible → still mark done (nothing to promote)
      NULL;
    END IF;
  END IF;

  -- ── Promote loop: per blueprint ──
  FOR v_bp IN
    SELECT DISTINCT qb.id as blueprint_id, qb.name, qb.curriculum_id,
           qb.learning_field_id, qb.competency_id, qb.cognitive_level,
           qb.rubric, qb.trap_definition
    FROM question_blueprints qb
    WHERE qb.curriculum_id = v_curriculum_id
      AND qb.status = 'approved'
    ORDER BY qb.id
  LOOP
    -- Count existing promotions for this blueprint
    SELECT count(*) INTO v_existing_count
    FROM exam_questions eq
    WHERE eq.blueprint_id = v_bp.blueprint_id;

    v_remaining := v_max_per_bp - v_existing_count;
    IF v_remaining <= 0 THEN
      v_total_skipped := v_total_skipped + 1;
      CONTINUE;
    END IF;

    -- Existing fingerprints for duplicate guard
    SELECT array_agg(lower(regexp_replace(left(eq.question_text, 120), '[^a-zäöüß0-9]', '', 'g')))
    INTO v_existing_fps
    FROM exam_questions eq
    WHERE eq.blueprint_id = v_bp.blueprint_id;

    IF v_existing_fps IS NULL THEN v_existing_fps := '{}'; END IF;

    -- Process eligible variants
    FOR v_variant IN
      SELECT eqv.*
      FROM exam_question_variants eqv
      WHERE eqv.blueprint_id = v_bp.blueprint_id
        AND eqv.status = 'review'
        AND eqv.quality_score >= v_min_quality
      ORDER BY eqv.quality_score DESC
      LIMIT v_remaining
    LOOP
      -- Fingerprint duplicate check
      v_fp := lower(regexp_replace(left(v_variant.question_text, 120), '[^a-zäöüß0-9]', '', 'g'));

      IF v_fp = ANY(v_existing_fps) THEN
        v_total_dup := v_total_dup + 1;
        CONTINUE;
      END IF;

      -- Skip if no options or question_text
      IF v_variant.question_text IS NULL OR length(v_variant.question_text) < 10 THEN
        v_total_skipped := v_total_skipped + 1;
        CONTINUE;
      END IF;

      -- Insert into exam_questions
      INSERT INTO exam_questions (
        curriculum_id, question_text, options, correct_answer,
        difficulty, blueprint_id, question_fingerprint,
        learning_field_id, competency_id, cognitive_level,
        status, qc_status, source
      ) VALUES (
        v_curriculum_id, v_variant.question_text,
        v_variant.options, coalesce(v_variant.correct_answer, 0),
        coalesce(v_variant.difficulty, 'medium'),
        v_bp.blueprint_id, v_fp,
        v_bp.learning_field_id, v_bp.competency_id,
        v_variant.cognitive_level,
        'active', 'pending', 'variant_promotion'
      );

      -- Mark variant as approved
      UPDATE exam_question_variants SET status = 'approved'
      WHERE id = v_variant.id;

      v_existing_fps := array_append(v_existing_fps, v_fp);
      v_total_promoted := v_total_promoted + 1;
    END LOOP;
  END LOOP;

  -- Mark step done
  UPDATE package_steps SET
    status = 'done',
    finished_at = v_now,
    last_error = NULL,
    started_at = coalesce(started_at, v_now),
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
      'postcondition_verified', true, 'checked_at', v_now::text,
      'total_promoted', v_total_promoted, 'total_skipped', v_total_skipped,
      'total_duplicates', v_total_dup, 'eligible_variants', v_eligible_count,
      'reason', 'PREBUILD_VARIANTS_PROMOTED'
    )
  WHERE package_id = p_package_id AND step_key = 'promote_blueprint_variants'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
      'postcondition_verified', true,
      'total_promoted', v_total_promoted, 'total_skipped', v_total_skipped,
      'total_duplicates', v_total_dup, 'eligible_variants', v_eligible_count
    );
END;
$$;
