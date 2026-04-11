
-- ============================================================
-- FIX: fn_prebuild_finalize_learning_content
-- Only marks finalize_learning_content done. Does NOT touch
-- generate_learning_content or fanout_learning_content.
-- ============================================================
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

  -- DAG prereqs: fanout + generate must be done (we do NOT set them done)
  SELECT ps.status INTO v_fanout_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'fanout_learning_content';

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
    AND jq.job_type IN (
      'package_finalize_learning_content', 'lesson_generate_content_shard',
      'package_fanout_learning_content', 'package_generate_learning_content'
    )
    AND jq.status IN ('pending', 'processing', 'running', 'batch_pending', 'claimed', 'queued');

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

  IF v_total_shards > 0 AND (v_pending_shards > 0 OR v_failed_shards > 0) THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'SHARDS_INCOMPLETE'::text,
      jsonb_build_object('total', v_total_shards, 'completed', v_completed_shards,
                         'failed', v_failed_shards, 'pending', v_pending_shards);
    RETURN;
  END IF;

  -- Lesson coverage check
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

  -- ── ALL POSTCONDITIONS PASS → Mark ONLY finalize_learning_content done ──
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
      'prereq_fanout_satisfied', coalesce(v_fanout_step_status IN ('done','skipped'), true),
      'prereq_generate_satisfied', coalesce(v_gen_step_status IN ('done','skipped'), true),
      'reason', 'PREBUILD_FINALIZE_ONLY'
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


-- ============================================================
-- FIX: fn_prebuild_validate_blueprints
-- Pure gate-check only. Does NOT approve blueprints.
-- Only marks step done if all postconditions are met.
-- ============================================================
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
  v_approved_bps int;
  v_lf_count int;
  v_covered_lfs int;
  v_active_jobs int;
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

  -- No active seeding/validation jobs
  SELECT count(*) INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN ('package_auto_seed_exam_blueprints', 'package_validate_blueprints')
    AND jq.status IN ('pending', 'processing', 'running', 'batch_pending', 'claimed', 'queued');

  IF v_active_jobs > 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs', v_active_jobs);
    RETURN;
  END IF;

  -- Count total blueprints
  SELECT count(*) INTO v_total_bps
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id;

  IF v_total_bps < 10 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'INSUFFICIENT_BLUEPRINTS'::text,
      jsonb_build_object('total', v_total_bps, 'min_required', 10);
    RETURN;
  END IF;

  -- Check if blueprints are already approved (by the real validator)
  SELECT count(*) INTO v_approved_bps
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id
    AND qb.status = 'approved';

  -- If blueprints are still draft → the real validator hasn't run yet → defer
  IF v_approved_bps = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'BLUEPRINTS_NOT_YET_APPROVED'::text,
      jsonb_build_object('total', v_total_bps, 'approved', 0,
                         'hint', 'Real validator must run first to approve blueprints');
    RETURN;
  END IF;

  -- LF coverage check
  SELECT count(DISTINCT lf.id) INTO v_lf_count
  FROM learning_fields lf
  WHERE lf.curriculum_id = v_curriculum_id;

  SELECT count(DISTINCT qb.learning_field_id) INTO v_covered_lfs
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id
    AND qb.learning_field_id IS NOT NULL
    AND qb.status = 'approved';

  IF v_lf_count > 0 AND v_covered_lfs < v_lf_count THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'LF_COVERAGE_INCOMPLETE'::text,
      jsonb_build_object('total_lfs', v_lf_count, 'covered', v_covered_lfs);
    RETURN;
  END IF;

  -- ── PASS: All postconditions met → mark step done (NO blueprint approval) ──
  UPDATE package_steps SET
    status = 'done',
    finished_at = v_now,
    last_error = NULL,
    started_at = coalesce(started_at, v_now),
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_validate_blueprints',
      'postcondition_verified', true, 'checked_at', v_now::text,
      'total_blueprints', v_total_bps, 'approved_blueprints', v_approved_bps,
      'lf_covered', v_covered_lfs, 'lf_total', v_lf_count,
      'reason', 'PREBUILD_GATE_ONLY_NO_APPROVAL'
    )
  WHERE package_id = p_package_id AND step_key = 'validate_blueprints'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_validate_blueprints',
      'postcondition_verified', true,
      'total_blueprints', v_total_bps, 'approved_blueprints', v_approved_bps,
      'lf_covered', v_covered_lfs, 'lf_total', v_lf_count
    );
END;
$$;


-- ============================================================
-- FIX: fn_prebuild_promote_blueprint_variants
-- Pure postcondition check. Does NOT insert into exam_questions.
-- Only marks step done if promotion already happened (via edge fn).
-- ============================================================
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
  v_approved_variants int;
  v_exam_questions_from_variants int;
  v_total_blueprints int;
  v_blueprints_with_questions int;
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
    NULL;
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

  -- No active promotion jobs
  SELECT count(*) INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN ('package_promote_blueprint_variants', 'package_validate_blueprint_variants', 'package_generate_blueprint_variants')
    AND jq.status IN ('pending', 'processing', 'running', 'batch_pending', 'claimed', 'queued');

  IF v_active_jobs > 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs', v_active_jobs);
    RETURN;
  END IF;

  -- Check if variants were already promoted (approved status in exam_question_variants)
  SELECT count(*) INTO v_approved_variants
  FROM exam_question_variants eqv
  JOIN question_blueprints qb ON qb.id = eqv.blueprint_id
  WHERE qb.curriculum_id = v_curriculum_id
    AND eqv.status = 'approved';

  -- Check exam_questions created from blueprints of this curriculum
  SELECT count(*) INTO v_exam_questions_from_variants
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND eq.blueprint_id IS NOT NULL;

  -- Count total approved blueprints
  SELECT count(*) INTO v_total_blueprints
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id
    AND qb.status = 'approved';

  -- Count blueprints that have at least 1 exam question
  SELECT count(DISTINCT eq.blueprint_id) INTO v_blueprints_with_questions
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND eq.blueprint_id IS NOT NULL;

  -- Promotion postcondition: exam_questions must exist from blueprints
  -- If no exam questions from variants exist, the real promoter hasn't run
  IF v_exam_questions_from_variants = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_PROMOTED_QUESTIONS_YET'::text,
      jsonb_build_object(
        'approved_variants', v_approved_variants,
        'exam_questions_from_variants', 0,
        'hint', 'Edge function promote-blueprint-variants must run first'
      );
    RETURN;
  END IF;

  -- ── Postconditions met: promotion already happened → mark step done ──
  UPDATE package_steps SET
    status = 'done',
    finished_at = v_now,
    last_error = NULL,
    started_at = coalesce(started_at, v_now),
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
      'postcondition_verified', true, 'checked_at', v_now::text,
      'exam_questions_from_variants', v_exam_questions_from_variants,
      'approved_variants', v_approved_variants,
      'blueprints_total', v_total_blueprints,
      'blueprints_with_questions', v_blueprints_with_questions,
      'reason', 'PREBUILD_POSTCONDITION_CHECK_ONLY'
    )
  WHERE package_id = p_package_id AND step_key = 'promote_blueprint_variants'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true, 'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
      'postcondition_verified', true,
      'exam_questions_from_variants', v_exam_questions_from_variants,
      'approved_variants', v_approved_variants,
      'blueprints_with_questions', v_blueprints_with_questions
    );
END;
$$;
