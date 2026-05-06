DROP FUNCTION IF EXISTS public.admin_get_lxi_no_lessons_targets();
DROP VIEW IF EXISTS public.v_lxi_no_lessons_targets CASCADE;

CREATE OR REPLACE VIEW public.v_learning_integrity_audit AS
WITH base AS (
  SELECT cp.id AS package_id, cp.package_key, cp.title, cp.curriculum_id, cp.status, cp.track
  FROM course_packages cp
), approved_q AS (
  SELECT b.package_id, eq.canonical_hash,
         COALESCE(eq.variant_group::text, '__novg__'::text) AS vg_bucket
  FROM base b
  JOIN exam_questions eq ON eq.curriculum_id = b.curriculum_id
   AND eq.status = 'approved'::question_status
   AND eq.canonical_hash IS NOT NULL
), dup_groups AS (
  SELECT package_id, canonical_hash, vg_bucket, count(*) AS n
  FROM approved_q GROUP BY package_id, canonical_hash, vg_bucket
), dup_agg AS (
  SELECT package_id,
         sum(n) AS approved_with_hash,
         sum(GREATEST(n - 1, 0::bigint)) AS surplus_dup_rows
  FROM dup_groups GROUP BY package_id
), counts AS (
  SELECT b.package_id, b.package_key, b.title, b.curriculum_id, b.status, b.track,
    (SELECT count(*) FROM learning_fields lf WHERE lf.curriculum_id = b.curriculum_id) AS learningfield_count,
    (SELECT count(*) FROM competencies c JOIN learning_fields lf ON lf.id = c.learning_field_id WHERE lf.curriculum_id = b.curriculum_id) AS competency_count,
    (SELECT count(*) FROM lessons l JOIN competencies c ON c.id = l.competency_id JOIN learning_fields lf ON lf.id = c.learning_field_id WHERE lf.curriculum_id = b.curriculum_id) AS lesson_count,
    (SELECT count(*) FROM minicheck_questions mc WHERE mc.curriculum_id = b.curriculum_id) AS minicheck_count,
    (SELECT count(*) FROM ai_tutor_context_index t WHERE t.package_id = b.package_id) AS tutor_context_count,
    (SELECT count(*) FROM oral_exam_blueprints ob WHERE ob.package_id = b.package_id) AS oral_blueprint_count,
    (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = b.curriculum_id AND eq.status = 'approved'::question_status) AS approved_exam_question_count,
    (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = b.curriculum_id) AS total_exam_question_count,
    COALESCE((SELECT da.surplus_dup_rows FROM dup_agg da WHERE da.package_id = b.package_id), 0::numeric) AS duplicate_exam_question_count,
    COALESCE((SELECT da.approved_with_hash FROM dup_agg da WHERE da.package_id = b.package_id), 0::numeric) AS approved_with_hash_count
  FROM base b
), coverage AS (
  SELECT c.*,
    CASE WHEN c.competency_count = 0 THEN 0::numeric
      ELSE round(100.0 * (SELECT count(DISTINCT eq.competency_id) FROM exam_questions eq WHERE eq.curriculum_id = c.curriculum_id AND eq.status='approved'::question_status AND eq.competency_id IS NOT NULL)::numeric / NULLIF(c.competency_count,0)::numeric, 1)
    END AS competency_coverage_pct,
    CASE WHEN c.learningfield_count = 0 THEN 0::numeric
      ELSE round(100.0 * (SELECT count(DISTINCT eq.learning_field_id) FROM exam_questions eq WHERE eq.curriculum_id = c.curriculum_id AND eq.status='approved'::question_status AND eq.learning_field_id IS NOT NULL)::numeric / NULLIF(c.learningfield_count,0)::numeric, 1)
    END AS blueprint_coverage_pct,
    CASE WHEN c.approved_with_hash_count = 0::numeric THEN 0::numeric
      ELSE round(100.0 * c.duplicate_exam_question_count / NULLIF(c.approved_with_hash_count,0::numeric), 1)
    END AS duplicate_question_ratio
  FROM counts c
), gates AS (
  SELECT cv.*,
    (cv.lesson_count = 0 AND COALESCE(cv.track::text,'') NOT IN ('EXAM_FIRST','EXAM_FIRST_PLUS')) AS gate_no_lessons,
    cv.minicheck_count = 0 AS gate_no_minichecks,
    cv.approved_exam_question_count < 50 AS gate_low_exam_questions,
    cv.oral_blueprint_count < 1 AS gate_no_oral,
    cv.tutor_context_count = 0 AS gate_no_tutor_context,
    cv.competency_coverage_pct < 80::numeric AS gate_low_competency_coverage,
    cv.blueprint_coverage_pct < 80::numeric AS gate_low_blueprint_coverage,
    cv.duplicate_question_ratio > 15::numeric AS gate_high_duplicates
  FROM coverage cv
)
SELECT package_id, package_key, title, curriculum_id, status,
  learningfield_count, competency_count, lesson_count, minicheck_count,
  tutor_context_count, oral_blueprint_count,
  approved_exam_question_count, total_exam_question_count, duplicate_exam_question_count,
  competency_coverage_pct, blueprint_coverage_pct, duplicate_question_ratio,
  gate_no_lessons, gate_no_minichecks, gate_low_exam_questions, gate_no_oral,
  gate_no_tutor_context, gate_low_competency_coverage, gate_low_blueprint_coverage, gate_high_duplicates,
  GREATEST(0, 100
    - CASE WHEN gate_no_lessons THEN 25 ELSE 0 END
    - CASE WHEN gate_no_minichecks THEN 15 ELSE 0 END
    - CASE WHEN gate_low_exam_questions THEN 20 ELSE 0 END
    - CASE WHEN gate_no_oral THEN 10 ELSE 0 END
    - CASE WHEN gate_no_tutor_context THEN 10 ELSE 0 END
    - CASE WHEN gate_low_competency_coverage THEN 8 ELSE 0 END
    - CASE WHEN gate_low_blueprint_coverage THEN 7 ELSE 0 END
    - CASE WHEN gate_high_duplicates THEN 5 ELSE 0 END) AS learning_integrity_score,
  CASE
    WHEN gate_no_lessons OR gate_low_exam_questions OR gate_no_tutor_context THEN 'red'::text
    WHEN gate_no_minichecks OR gate_no_oral OR gate_low_competency_coverage OR gate_low_blueprint_coverage OR gate_high_duplicates THEN 'yellow'::text
    ELSE 'green'::text
  END AS publish_learning_status,
  track
FROM gates;

CREATE VIEW public.v_lxi_no_lessons_targets AS
SELECT v.package_id, v.package_key, v.title, v.curriculum_id, cp.product_id,
  v.approved_exam_question_count, v.oral_blueprint_count, v.tutor_context_count,
  v.learning_integrity_score,
  (SELECT count(*) FROM job_queue jq
    WHERE jq.package_id = v.package_id
      AND jq.job_type = ANY (ARRAY['package_generate_learning_content'::text,'package_fanout_learning_content'::text,'lesson_generate_competency_bundle'::text,'lesson_generate_content'::text,'lesson_generate_content_shard'::text])
      AND jq.status = ANY (ARRAY['pending'::text,'processing'::text,'queued'::text])) AS active_lesson_jobs,
  (cp.feature_flags -> 'bronze'::text) ->> 'badge'::text AS bronze_badge,
  cp.track
FROM v_learning_integrity_audit v
JOIN course_packages cp ON cp.id = v.package_id
WHERE v.status = 'published'::text AND v.gate_no_lessons;

CREATE OR REPLACE FUNCTION public.admin_get_lxi_no_lessons_targets()
 RETURNS SETOF v_lxi_no_lessons_targets
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT * FROM public.v_lxi_no_lessons_targets ORDER BY title;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_dispatch_lxi_no_lessons_repair(_package_id uuid DEFAULT NULL::uuid, _dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target record;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_job_id uuid;
  v_correlation uuid := gen_random_uuid();
  v_skip_reason text;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  FOR v_target IN
    SELECT * FROM public.v_lxi_no_lessons_targets
    WHERE (_package_id IS NULL OR package_id = _package_id)
    ORDER BY title
  LOOP
    v_skip_reason := NULL;

    IF v_target.active_lesson_jobs > 0 THEN
      v_skip_reason := 'ALREADY_HAS_ACTIVE_LESSON_JOB';
    ELSIF v_target.curriculum_id IS NULL THEN
      v_skip_reason := 'NO_CURRICULUM';
    ELSIF COALESCE(v_target.track::text,'') IN ('EXAM_FIRST','EXAM_FIRST_PLUS') THEN
      v_skip_reason := 'LESSONS_NOT_APPLICABLE_FOR_TRACK';
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_target.package_id, 'title', v_target.title,
        'action', 'skipped', 'reason', v_skip_reason);
      CONTINUE;
    END IF;

    IF _dry_run THEN
      v_results := v_results || jsonb_build_object(
        'package_id', v_target.package_id, 'title', v_target.title,
        'action', 'would_enqueue', 'job_type', 'package_generate_learning_content');
      v_dispatched := v_dispatched + 1;
      CONTINUE;
    END IF;

    INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, correlation_id)
    VALUES (
      'package_generate_learning_content', v_target.package_id, 'pending', 50,
      jsonb_build_object(
        'package_id', v_target.package_id,
        'curriculum_id', v_target.curriculum_id,
        'enqueue_source', 'lxi_no_lessons_repair',
        'mode', 'targeted_lesson_repair',
        'reason', 'gate_no_lessons published package'),
      jsonb_build_object('enqueue_source','lxi_no_lessons_repair','correlation_id', v_correlation),
      v_correlation)
    RETURNING id INTO v_job_id;

    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('admin_dispatch_lxi_no_lessons_repair', 'lxi_no_lessons_repair_enqueued',
            v_target.package_id::text, 'package', 'success',
            format('Enqueued package_generate_learning_content for %s', v_target.title),
            jsonb_build_object('package_id', v_target.package_id, 'job_id', v_job_id,
              'correlation_id', v_correlation,
              'approved_exam_questions', v_target.approved_exam_question_count));

    v_dispatched := v_dispatched + 1;
    v_results := v_results || jsonb_build_object(
      'package_id', v_target.package_id, 'title', v_target.title,
      'action', 'enqueued', 'job_id', v_job_id);
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', _dry_run, 'correlation_id', v_correlation,
    'dispatched', v_dispatched, 'skipped', v_skipped, 'results', v_results);
END; $function$;

REVOKE ALL ON public.v_lxi_no_lessons_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_lxi_no_lessons_targets TO service_role;