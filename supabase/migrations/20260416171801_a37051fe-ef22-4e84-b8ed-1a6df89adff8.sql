
CREATE OR REPLACE VIEW public.v_package_release_classification AS
WITH pkg AS (
  SELECT
    cp.id AS package_id,
    cp.curriculum_id,
    cp.status,
    cp.track,
    cp.build_progress,
    cp.council_approved,
    c.title AS course_title
  FROM course_packages cp
  JOIN courses c ON c.curriculum_id = cp.curriculum_id
),
-- Exam questions: approved count per curriculum (Tier 3: validated_exam_pool)
eq_stats AS (
  SELECT
    curriculum_id,
    count(*) FILTER (WHERE status = 'approved' AND qc_status = 'approved') AS approved_q,
    count(*) FILTER (WHERE status != 'rejected' AND qc_status NOT IN ('tier1_failed','rejected')) AS exam_relevant_q
  FROM exam_questions
  GROUP BY curriculum_id
),
-- LF coverage: how many LFs have at least 1 exam-relevant question
lf_coverage AS (
  SELECT
    lf.curriculum_id,
    count(DISTINCT lf.id) AS total_lfs,
    count(DISTINCT lf.id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM exam_questions eq
        WHERE eq.curriculum_id = lf.curriculum_id
          AND eq.learning_field_id = lf.id
          AND eq.status != 'rejected'
          AND eq.qc_status NOT IN ('tier1_failed','rejected')
      )
    ) AS covered_lfs
  FROM learning_fields lf
  GROUP BY lf.curriculum_id
),
-- Tutor index (package-based)
tutor AS (
  SELECT package_id, count(*) AS tutor_count
  FROM ai_tutor_context_index
  GROUP BY package_id
),
-- Oral blueprints (curriculum-based)
oral AS (
  SELECT curriculum_id, count(*) AS oral_count
  FROM oral_exam_blueprints
  WHERE status != 'rejected'
  GROUP BY curriculum_id
),
-- Handbook chapters (curriculum-based)
hb AS (
  SELECT curriculum_id, count(*) AS hb_count
  FROM handbook_chapters
  GROUP BY curriculum_id
),
-- MiniChecks (curriculum-based)
mc AS (
  SELECT curriculum_id, count(*) AS mc_count
  FROM minicheck_questions
  WHERE status != 'rejected'
  GROUP BY curriculum_id
),
-- Track requirements from track_step_applicability
track_req AS (
  SELECT
    track,
    bool_or(step_key = 'generate_oral_exam' AND should_run) AS needs_oral,
    bool_or(step_key = 'generate_handbook' AND should_run) AS needs_handbook,
    bool_or(step_key = 'generate_lesson_minichecks' AND should_run) AS needs_minichecks,
    bool_or(step_key = 'build_ai_tutor_index' AND should_run) AS needs_tutor
  FROM track_step_applicability
  WHERE step_key IN ('generate_oral_exam','generate_handbook','generate_lesson_minichecks','build_ai_tutor_index')
  GROUP BY track
),
classified AS (
  SELECT
    pkg.package_id,
    pkg.curriculum_id,
    pkg.status AS package_status,
    pkg.track,
    pkg.build_progress,
    pkg.council_approved,
    pkg.course_title,
    coalesce(es.approved_q, 0) AS approved_questions,
    coalesce(es.exam_relevant_q, 0) AS exam_relevant_questions,
    coalesce(lfc.total_lfs, 0) AS total_learning_fields,
    coalesce(lfc.covered_lfs, 0) AS covered_learning_fields,
    coalesce(t.tutor_count, 0) AS tutor_indices,
    coalesce(o.oral_count, 0) AS oral_blueprints,
    coalesce(h.hb_count, 0) AS handbook_chapters,
    coalesce(m.mc_count, 0) AS minicheck_questions,
    coalesce(tr.needs_oral, false) AS track_needs_oral,
    coalesce(tr.needs_handbook, false) AS track_needs_handbook,
    coalesce(tr.needs_minichecks, false) AS track_needs_minichecks,
    coalesce(tr.needs_tutor, false) AS track_needs_tutor,
    -- Blocking conditions
    CASE WHEN coalesce(es.approved_q, 0) < 50 THEN true ELSE false END AS block_low_questions,
    CASE WHEN coalesce(lfc.total_lfs, 0) > 0 AND coalesce(lfc.covered_lfs, 0) < coalesce(lfc.total_lfs, 0) THEN true ELSE false END AS block_lf_gap,
    CASE WHEN coalesce(tr.needs_tutor, false) AND coalesce(t.tutor_count, 0) = 0 THEN true ELSE false END AS block_no_tutor,
    CASE WHEN coalesce(tr.needs_oral, false) AND coalesce(o.oral_count, 0) = 0 THEN true ELSE false END AS block_no_oral,
    CASE WHEN coalesce(tr.needs_handbook, false) AND coalesce(h.hb_count, 0) = 0 THEN true ELSE false END AS block_no_handbook,
    -- Warning conditions
    CASE WHEN coalesce(es.approved_q, 0) BETWEEN 50 AND 499 THEN true ELSE false END AS warn_low_questions,
    CASE WHEN coalesce(tr.needs_minichecks, false) AND coalesce(m.mc_count, 0) = 0 THEN true ELSE false END AS warn_no_minichecks,
    CASE WHEN coalesce(tr.needs_handbook, false) AND coalesce(h.hb_count, 0) BETWEEN 1 AND 3 THEN true ELSE false END AS warn_shallow_handbook
  FROM pkg
  LEFT JOIN eq_stats es ON es.curriculum_id = pkg.curriculum_id
  LEFT JOIN lf_coverage lfc ON lfc.curriculum_id = pkg.curriculum_id
  LEFT JOIN tutor t ON t.package_id = pkg.package_id
  LEFT JOIN oral o ON o.curriculum_id = pkg.curriculum_id
  LEFT JOIN hb h ON h.curriculum_id = pkg.curriculum_id
  LEFT JOIN mc m ON m.curriculum_id = pkg.curriculum_id
  LEFT JOIN track_req tr ON tr.track = pkg.track
)
SELECT
  *,
  CASE
    WHEN block_low_questions OR block_lf_gap OR block_no_tutor OR block_no_oral OR block_no_handbook
    THEN 'release_block'
    WHEN warn_low_questions OR warn_no_minichecks OR warn_shallow_handbook
    THEN 'release_warn'
    ELSE 'release_ok'
  END AS release_class,
  array_remove(ARRAY[
    CASE WHEN block_low_questions THEN 'APPROVED_Q<50' END,
    CASE WHEN block_lf_gap THEN 'LF_COVERAGE_GAP' END,
    CASE WHEN block_no_tutor THEN 'NO_TUTOR' END,
    CASE WHEN block_no_oral THEN 'NO_ORAL' END,
    CASE WHEN block_no_handbook THEN 'NO_HANDBOOK' END,
    CASE WHEN warn_low_questions THEN 'APPROVED_Q<500' END,
    CASE WHEN warn_no_minichecks THEN 'NO_MINICHECKS' END,
    CASE WHEN warn_shallow_handbook THEN 'SHALLOW_HANDBOOK' END
  ], NULL) AS deficiency_codes
FROM classified;
