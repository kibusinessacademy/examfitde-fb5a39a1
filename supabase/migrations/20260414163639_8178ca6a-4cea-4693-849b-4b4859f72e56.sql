
CREATE OR REPLACE VIEW public.ops_package_readiness AS
WITH pkg AS (
  SELECT cp.id AS package_id,
    cp.title AS package_title,
    cp.status,
    cp.priority,
    cp.curriculum_id,
    cp.build_progress AS stored_progress,
    cp.is_published,
    cp.published_at,
    cp.integrity_passed,
    cp.council_approved,
    cp.blocked_reason,
    c.id AS course_id
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE
), real_content AS (
  SELECT p_1.package_id,
    count(l.id) AS total_lessons,
    count(l.id) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'::text AND l.content::text !~~ '%_placeholder%'::text AND length(l.content::text) > 500) AS real_lessons,
    count(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) AS minichecks_parsed,
    count(l.id) FILTER (WHERE l.qc_status = 'approved'::text) AS qc_approved,
    count(l.id) FILTER (WHERE l.qc_status = 'tier1_passed'::text) AS qc_tier1_passed,
    count(l.id) FILTER (WHERE l.qc_status = 'tier1_failed'::text) AS qc_tier1_failed,
    count(l.id) FILTER (WHERE l.qc_status IS NULL OR l.qc_status = 'pending'::text) AS qc_pending,
    count(DISTINCT l.competency_id) AS total_competencies,
    count(DISTINCT l.step) FILTER (WHERE l.content IS NOT NULL AND l.content::text <> 'null'::text AND l.content::text !~~ '%_placeholder%'::text AND length(l.content::text) > 500) AS distinct_steps_with_content
  FROM pkg p_1
  JOIN modules m ON m.course_id = p_1.course_id
  JOIN lessons l ON l.module_id = m.id
  GROUP BY p_1.package_id
), exam_counts AS (
  SELECT p_1.package_id,
    count(eq.id) FILTER (WHERE eq.status = 'approved'::question_status) AS exam_approved,
    count(eq.id) AS exam_total,
    count(eq.id) FILTER (WHERE eq.difficulty::text = ANY (ARRAY['hard'::text, 'very_hard'::text])) AS exam_hard
  FROM pkg p_1
  LEFT JOIN exam_questions eq ON eq.curriculum_id = p_1.curriculum_id
  GROUP BY p_1.package_id
), handbook_counts AS (
  SELECT p_1.package_id,
    count(hs.id) FILTER (WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100) AS handbook_sections_real
  FROM pkg p_1
  LEFT JOIN handbook_chapters hc_1 ON hc_1.curriculum_id = p_1.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc_1.id
  GROUP BY p_1.package_id
), scores AS (
  SELECT p_1.package_id,
    CASE
      WHEN COALESCE(rc_1.total_lessons, 0::bigint) > 0 THEN round(100.0 * COALESCE(rc_1.real_lessons, 0::bigint)::numeric / rc_1.total_lessons::numeric, 1)
      ELSE 0::numeric
    END AS materialization_pct,
    CASE
      WHEN COALESCE(rc_1.real_lessons, 0::bigint) > 0 THEN round(100.0 * COALESCE(rc_1.qc_approved, 0::bigint)::numeric / rc_1.real_lessons::numeric, 1)
      ELSE 0::numeric
    END AS qc_approved_pct,
    LEAST(round(100.0 * COALESCE(ec_1.exam_approved, 0::bigint)::numeric / 500.0, 1), 100::numeric) AS exam_risk_coverage_pct,
    round(100.0 * COALESCE(rc_1.distinct_steps_with_content, 0::bigint)::numeric / 5.0, 1) AS learner_step_completeness_pct
  FROM pkg p_1
  LEFT JOIN real_content rc_1 ON rc_1.package_id = p_1.package_id
  LEFT JOIN exam_counts ec_1 ON ec_1.package_id = p_1.package_id
), artifact_progress AS (
  SELECT p_1.package_id,
    round(LEAST(
      CASE WHEN COALESCE(rc_1.total_lessons, 0::bigint) > 0 THEN 10 ELSE 0 END::numeric +
      CASE WHEN COALESCE(rc_1.total_lessons, 0::bigint) > 0 THEN 30.0 * COALESCE(rc_1.real_lessons, 0::bigint)::numeric / rc_1.total_lessons::numeric ELSE 0::numeric END +
      CASE WHEN COALESCE(rc_1.real_lessons, 0::bigint) > 0 THEN 15.0 * COALESCE(rc_1.qc_approved, 0::bigint)::numeric / rc_1.real_lessons::numeric ELSE 0::numeric END +
      CASE WHEN COALESCE(rc_1.real_lessons, 0::bigint) > 0 THEN 10.0 * COALESCE(rc_1.minichecks_parsed, 0::bigint)::numeric / rc_1.real_lessons::numeric ELSE 0::numeric END +
      LEAST(20.0 * COALESCE(ec_1.exam_approved, 0::bigint)::numeric / 500.0, 20::numeric) +
      CASE WHEN COALESCE(hc_1.handbook_sections_real, 0::bigint) > 0 THEN 10 ELSE 0 END::numeric +
      5.0 * LEAST(COALESCE(rc_1.distinct_steps_with_content, 0::bigint), 5::bigint)::numeric / 5.0,
    100::numeric), 1) AS real_progress
  FROM pkg p_1
  LEFT JOIN real_content rc_1 ON rc_1.package_id = p_1.package_id
  LEFT JOIN exam_counts ec_1 ON ec_1.package_id = p_1.package_id
  LEFT JOIN handbook_counts hc_1 ON hc_1.package_id = p_1.package_id
)
SELECT p.package_id,
  p.package_title,
  p.status,
  p.priority,
  p.stored_progress AS build_progress,
  p.integrity_passed,
  p.council_approved,
  p.is_published,
  p.blocked_reason,
  p.curriculum_id,
  COALESCE(rc.total_lessons, 0::bigint) AS total_lessons,
  COALESCE(rc.real_lessons, 0::bigint) AS real_lessons,
  COALESCE(rc.total_lessons, 0::bigint) - COALESCE(rc.real_lessons, 0::bigint) AS placeholder_lessons,
  COALESCE(s.materialization_pct, 0::numeric) AS materialization_pct,
  COALESCE(s.qc_approved_pct, 0::numeric) AS qc_approved_pct,
  COALESCE(s.exam_risk_coverage_pct, 0::numeric) AS exam_risk_coverage_pct,
  COALESCE(s.learner_step_completeness_pct, 0::numeric) AS learner_step_completeness_pct,
  COALESCE(rc.qc_approved, 0::bigint) AS qc_approved,
  COALESCE(rc.qc_tier1_passed, 0::bigint) AS qc_tier1_passed,
  COALESCE(rc.qc_tier1_failed, 0::bigint) AS qc_tier1_failed,
  COALESCE(rc.qc_pending, 0::bigint) AS qc_pending,
  COALESCE(ec.exam_approved, 0::bigint) AS exam_risk_covered,
  COALESCE(rc.total_competencies, 0::bigint) AS total_competencies,
  -- ══ FIXED: readiness_score now factors in build_progress ══
  -- Raw artifact score × pipeline completion factor
  -- At build_progress=0: score capped at 5% of raw (prevents misleading high scores)
  -- At build_progress=100: full raw score applies
  round(
    (0.35 * COALESCE(s.materialization_pct, 0::numeric) +
     0.25 * COALESCE(s.qc_approved_pct, 0::numeric) +
     0.20 * COALESCE(s.exam_risk_coverage_pct, 0::numeric) +
     0.20 * COALESCE(s.learner_step_completeness_pct, 0::numeric))
    * GREATEST(COALESCE(p.stored_progress, 0::numeric) / 100.0, 0.05),
  1) AS readiness_score,
  CASE
    WHEN round(
      (0.35 * COALESCE(s.materialization_pct, 0::numeric) +
       0.25 * COALESCE(s.qc_approved_pct, 0::numeric) +
       0.20 * COALESCE(s.exam_risk_coverage_pct, 0::numeric) +
       0.20 * COALESCE(s.learner_step_completeness_pct, 0::numeric))
      * GREATEST(COALESCE(p.stored_progress, 0::numeric) / 100.0, 0.05),
    1) >= 80::numeric THEN 'learner_ready'::text
    WHEN round(
      (0.35 * COALESCE(s.materialization_pct, 0::numeric) +
       0.25 * COALESCE(s.qc_approved_pct, 0::numeric) +
       0.20 * COALESCE(s.exam_risk_coverage_pct, 0::numeric) +
       0.20 * COALESCE(s.learner_step_completeness_pct, 0::numeric))
      * GREATEST(COALESCE(p.stored_progress, 0::numeric) / 100.0, 0.05),
    1) >= 55::numeric THEN 'content_heavy'::text
    WHEN round(
      (0.35 * COALESCE(s.materialization_pct, 0::numeric) +
       0.25 * COALESCE(s.qc_approved_pct, 0::numeric) +
       0.20 * COALESCE(s.exam_risk_coverage_pct, 0::numeric) +
       0.20 * COALESCE(s.learner_step_completeness_pct, 0::numeric))
      * GREATEST(COALESCE(p.stored_progress, 0::numeric) / 100.0, 0.05),
    1) >= 25::numeric THEN 'building'::text
    WHEN COALESCE(rc.total_lessons, 0::bigint) > 0 THEN 'early'::text
    ELSE 'empty'::text
  END AS readiness_band,
  COALESCE(ap.real_progress, 0::numeric) AS real_progress,
  CASE
    WHEN COALESCE(ap.real_progress, 0::numeric) >= 40::numeric AND COALESCE(p.stored_progress, 0::numeric) <= 15::numeric THEN true
    ELSE false
  END AS likely_stale_progress,
  array_remove(ARRAY[
    CASE WHEN (COALESCE(rc.total_lessons, 0::bigint) - COALESCE(rc.real_lessons, 0::bigint)) > 0 THEN 'content'::text ELSE NULL::text END,
    CASE WHEN (COALESCE(rc.real_lessons, 0::bigint) - COALESCE(rc.minichecks_parsed, 0::bigint)) > 0 THEN 'minichecks'::text ELSE NULL::text END,
    CASE WHEN (COALESCE(rc.real_lessons, 0::bigint) - COALESCE(rc.qc_approved, 0::bigint)) > 0 THEN 'qc'::text ELSE NULL::text END,
    CASE WHEN COALESCE(ec.exam_approved, 0::bigint) < 500 THEN 'exam_pool'::text ELSE NULL::text END,
    CASE WHEN COALESCE(hc.handbook_sections_real, 0::bigint) = 0 THEN 'handbook'::text ELSE NULL::text END
  ], NULL::text) AS missing_artifacts,
  array_remove(ARRAY[
    CASE WHEN COALESCE(rc.real_lessons, 0::bigint) = 0 THEN 'lessons_empty'::text ELSE NULL::text END,
    CASE WHEN COALESCE(rc.minichecks_parsed, 0::bigint) = 0 AND COALESCE(rc.real_lessons, 0::bigint) > 0 THEN 'minichecks_dead_end'::text ELSE NULL::text END,
    CASE WHEN COALESCE(ec.exam_approved, 0::bigint) < 20 THEN 'exam_training_dead_end'::text ELSE NULL::text END,
    CASE WHEN COALESCE(hc.handbook_sections_real, 0::bigint) = 0 THEN 'handbook_dead_end'::text ELSE NULL::text END
  ], NULL::text) AS dead_ends,
  COALESCE(rc.qc_tier1_failed, 0::bigint) AS qc_needs_revision,
  p.published_at AS updated_at
FROM pkg p
LEFT JOIN real_content rc ON rc.package_id = p.package_id
LEFT JOIN exam_counts ec ON ec.package_id = p.package_id
LEFT JOIN handbook_counts hc ON hc.package_id = p.package_id
LEFT JOIN scores s ON s.package_id = p.package_id
LEFT JOIN artifact_progress ap ON ap.package_id = p.package_id;
