
-- Drop dependent views first (order matters)
DROP VIEW IF EXISTS public.ops_package_blockers CASCADE;
DROP VIEW IF EXISTS public.ops_package_step_readiness CASCADE;
DROP VIEW IF EXISTS public.ops_package_readiness CASCADE;
DROP VIEW IF EXISTS public.ops_learner_visible_readiness CASCADE;

-- ============================================================
-- VIEW: ops_learner_visible_readiness (complete, schema-correct)
-- ============================================================
CREATE VIEW public.ops_learner_visible_readiness AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.status, cp.priority,
         cp.curriculum_id, cp.published_at, cp.is_published, c.id AS course_id,
         c.title AS course_title
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE
),
learner_metrics AS (
  SELECT p.package_id,
    count(DISTINCT m.id) AS module_count,
    count(l.id) AS lesson_count,
    count(l.id) FILTER (
      WHERE l.content IS NOT NULL
        AND l.content::text <> 'null'
        AND l.content::text NOT LIKE '%_placeholder%'
        AND length(l.content::text) > 500
    ) AS lessons_readable,
    count(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) AS minichecks_usable
  FROM pkg p
  JOIN modules m ON m.course_id = p.course_id
  JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id
),
minicheck_counts AS (
  SELECT p.package_id, count(mq.id) AS minicheck_questions_available
  FROM pkg p
  JOIN modules m ON m.course_id = p.course_id
  JOIN lessons l ON l.module_id = m.id
  LEFT JOIN minicheck_questions mq ON mq.lesson_id = l.id
  GROUP BY p.package_id
),
exam_ready AS (
  SELECT p.package_id,
    count(eq.id) FILTER (WHERE eq.status = 'approved'::question_status) AS exam_questions_approved
  FROM pkg p
  LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
handbook_ready AS (
  SELECT p.package_id,
    count(hs.id) FILTER (
      WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100
    ) AS handbook_sections_available
  FROM pkg p
  LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id
  GROUP BY p.package_id
)
SELECT
  p.package_id, p.package_title, p.course_title, p.status, p.priority,
  p.is_published, p.published_at,
  (coalesce(lm.module_count,0) > 0 AND coalesce(lm.lesson_count,0) > 0) AS structure_visible,
  coalesce(lm.lessons_readable,0) > 0 AS lessons_readable,
  coalesce(lm.lessons_readable,0) AS readable_lesson_count,
  coalesce(lm.lesson_count,0) AS total_lesson_count,
  CASE WHEN coalesce(lm.lesson_count,0) > 0
    THEN round(100.0 * coalesce(lm.lessons_readable,0) / lm.lesson_count, 1) ELSE 0 END AS lesson_coverage_pct,
  coalesce(lm.minichecks_usable,0) > 0 AS minichecks_usable,
  coalesce(lm.minichecks_usable,0) AS usable_minicheck_count,
  coalesce(mc.minicheck_questions_available,0) AS minicheck_questions_available,
  coalesce(er.exam_questions_approved,0) >= 100 AS exam_training_usable,
  coalesce(er.exam_questions_approved,0) AS exam_questions_count,
  coalesce(hr.handbook_sections_available,0) > 0 AS handbook_available,
  coalesce(hr.handbook_sections_available,0) AS handbook_section_count,
  CASE
    WHEN coalesce(lm.lessons_readable,0) = 0 THEN 'not_ready'
    WHEN coalesce(lm.lessons_readable,0)::numeric / nullif(lm.lesson_count,0) >= 0.9
      AND coalesce(lm.minichecks_usable,0)::numeric / nullif(lm.lessons_readable,0) >= 0.7
      AND coalesce(er.exam_questions_approved,0) >= 100
      AND coalesce(hr.handbook_sections_available,0) > 0 THEN 'fully_ready'
    WHEN coalesce(lm.lessons_readable,0)::numeric / nullif(lm.lesson_count,0) >= 0.5
      AND coalesce(er.exam_questions_approved,0) >= 50 THEN 'partially_ready'
    WHEN coalesce(lm.lessons_readable,0) >= 10 THEN 'early_access'
    ELSE 'not_ready'
  END AS learner_tier,
  array_remove(array[
    CASE WHEN coalesce(lm.lessons_readable,0) = 0 THEN 'lessons_empty' END,
    CASE WHEN coalesce(lm.minichecks_usable,0) = 0 AND coalesce(lm.lessons_readable,0) > 0 THEN 'minichecks_dead_end' END,
    CASE WHEN coalesce(er.exam_questions_approved,0) < 20 THEN 'exam_training_dead_end' END,
    CASE WHEN coalesce(hr.handbook_sections_available,0) = 0 THEN 'handbook_dead_end' END
  ], NULL) AS dead_ends
FROM pkg p
LEFT JOIN learner_metrics lm ON lm.package_id = p.package_id
LEFT JOIN minicheck_counts mc ON mc.package_id = p.package_id
LEFT JOIN exam_ready er ON er.package_id = p.package_id
LEFT JOIN handbook_ready hr ON hr.package_id = p.package_id;

-- ============================================================
-- VIEW: ops_package_readiness v2 (consolidated SSOT)
-- ============================================================
CREATE VIEW public.ops_package_readiness AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title, cp.status, cp.priority,
         cp.curriculum_id, cp.build_progress AS stored_progress,
         cp.is_published, cp.published_at, cp.integrity_passed,
         cp.council_approved, cp.blocked_reason, c.id AS course_id
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE
),
real_content AS (
  SELECT p.package_id,
    count(l.id) AS total_lessons,
    count(l.id) FILTER (
      WHERE l.content IS NOT NULL AND l.content::text <> 'null'
        AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500
    ) AS real_lessons,
    count(l.id) FILTER (WHERE l.minicheck_parsed IS TRUE) AS minichecks_parsed,
    count(l.id) FILTER (WHERE l.qc_status = 'approved') AS lessons_qc_approved,
    count(l.id) FILTER (WHERE l.qc_status = 'tier1_passed') AS qc_tier1_passed,
    count(l.id) FILTER (WHERE l.qc_status = 'tier1_failed') AS qc_tier1_failed,
    count(l.id) FILTER (WHERE l.qc_status IS NULL OR l.qc_status = 'pending') AS qc_pending_count,
    count(DISTINCT l.competency_id) AS total_competencies,
    count(DISTINCT l.step) FILTER (
      WHERE l.content IS NOT NULL AND l.content::text <> 'null' AND length(l.content::text) > 500
    ) AS distinct_steps_with_content
  FROM pkg p
  JOIN modules m ON m.course_id = p.course_id
  JOIN lessons l ON l.module_id = m.id
  GROUP BY p.package_id
),
exam_counts AS (
  SELECT p.package_id,
    count(eq.id) FILTER (WHERE eq.status = 'approved'::question_status) AS exam_approved,
    count(eq.id) AS exam_total
  FROM pkg p
  LEFT JOIN exam_questions eq ON eq.curriculum_id = p.curriculum_id
  GROUP BY p.package_id
),
handbook_counts AS (
  SELECT p.package_id,
    count(hs.id) FILTER (
      WHERE hs.content_markdown IS NOT NULL AND length(hs.content_markdown) > 100
    ) AS handbook_sections_real
  FROM pkg p
  LEFT JOIN handbook_chapters hc ON hc.curriculum_id = p.curriculum_id
  LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id
  GROUP BY p.package_id
),
computed AS (
  SELECT
    p.package_id,
    -- Materialization %
    CASE WHEN coalesce(rc.total_lessons,0) > 0
      THEN round(100.0 * coalesce(rc.real_lessons,0) / rc.total_lessons, 1) ELSE 0 END AS materialization_pct,
    -- QC approved %
    CASE WHEN coalesce(rc.real_lessons,0) > 0
      THEN round(100.0 * coalesce(rc.lessons_qc_approved,0) / rc.real_lessons, 1) ELSE 0 END AS qc_approved_pct,
    -- Exam risk coverage
    least(round(100.0 * coalesce(ec.exam_approved,0) / 500.0, 1), 100) AS exam_risk_coverage_pct,
    -- Learner step completeness
    round(100.0 * coalesce(rc.distinct_steps_with_content,0) / 5.0, 1) AS learner_step_completeness_pct,
    -- 7-layer artifact progress
    round(least(
      CASE WHEN coalesce(rc.total_lessons,0) > 0 THEN 10 ELSE 0 END
      + CASE WHEN coalesce(rc.total_lessons,0) > 0
          THEN 30.0 * coalesce(rc.real_lessons,0) / rc.total_lessons ELSE 0 END
      + CASE WHEN coalesce(rc.real_lessons,0) > 0
          THEN 15.0 * coalesce(rc.lessons_qc_approved,0) / rc.real_lessons ELSE 0 END
      + CASE WHEN coalesce(rc.real_lessons,0) > 0
          THEN 10.0 * coalesce(rc.minichecks_parsed,0) / rc.real_lessons ELSE 0 END
      + least(20.0 * coalesce(ec.exam_approved,0) / 500.0, 20)
      + CASE WHEN coalesce(hc.handbook_sections_real,0) > 0 THEN 10 ELSE 0 END
      + 5.0 * coalesce(rc.distinct_steps_with_content,0) / 5.0
    , 100), 1) AS real_progress
  FROM pkg p
  LEFT JOIN real_content rc ON rc.package_id = p.package_id
  LEFT JOIN exam_counts ec ON ec.package_id = p.package_id
  LEFT JOIN handbook_counts hc ON hc.package_id = p.package_id
)
SELECT
  p.package_id, p.package_title, p.status, p.priority,
  p.stored_progress AS build_progress, p.integrity_passed, p.council_approved,
  p.is_published, p.blocked_reason, p.curriculum_id,

  coalesce(rc.total_lessons,0) AS total_lessons,
  coalesce(rc.real_lessons,0) AS real_lessons,
  coalesce(rc.total_lessons,0) - coalesce(rc.real_lessons,0) AS placeholder_lessons,

  c.materialization_pct, c.qc_approved_pct, c.exam_risk_coverage_pct, c.learner_step_completeness_pct,

  coalesce(rc.lessons_qc_approved,0) AS qc_approved,
  coalesce(rc.qc_tier1_passed,0) AS qc_tier1_passed,
  coalesce(rc.qc_tier1_failed,0) AS qc_tier1_failed,
  coalesce(rc.qc_pending_count,0) AS qc_pending,

  coalesce(ec.exam_approved,0) AS exam_risk_covered,
  coalesce(rc.total_competencies,0) AS total_competencies,

  round(0.35 * c.materialization_pct + 0.25 * c.qc_approved_pct
    + 0.20 * c.exam_risk_coverage_pct + 0.20 * c.learner_step_completeness_pct, 1) AS readiness_score,

  CASE
    WHEN round(0.35*c.materialization_pct + 0.25*c.qc_approved_pct + 0.20*c.exam_risk_coverage_pct + 0.20*c.learner_step_completeness_pct, 1) >= 80 THEN 'learner_ready'
    WHEN round(0.35*c.materialization_pct + 0.25*c.qc_approved_pct + 0.20*c.exam_risk_coverage_pct + 0.20*c.learner_step_completeness_pct, 1) >= 55 THEN 'content_heavy'
    WHEN round(0.35*c.materialization_pct + 0.25*c.qc_approved_pct + 0.20*c.exam_risk_coverage_pct + 0.20*c.learner_step_completeness_pct, 1) >= 25 THEN 'building'
    WHEN coalesce(rc.total_lessons,0) > 0 THEN 'early'
    ELSE 'empty'
  END AS readiness_band,

  c.real_progress,

  CASE WHEN c.real_progress >= 40 AND coalesce(p.stored_progress,0) <= 15 THEN true ELSE false END AS likely_stale_progress,

  array_remove(array[
    CASE WHEN coalesce(rc.total_lessons,0) - coalesce(rc.real_lessons,0) > 0 THEN 'content' END,
    CASE WHEN coalesce(rc.real_lessons,0) - coalesce(rc.minichecks_parsed,0) > 0 THEN 'minichecks' END,
    CASE WHEN coalesce(rc.real_lessons,0) - coalesce(rc.lessons_qc_approved,0) > 0 THEN 'qc' END,
    CASE WHEN coalesce(ec.exam_approved,0) < 500 THEN 'exam_pool' END,
    CASE WHEN coalesce(hc.handbook_sections_real,0) = 0 THEN 'handbook' END
  ], NULL) AS missing_artifacts,

  array_remove(array[
    CASE WHEN coalesce(rc.real_lessons,0) = 0 THEN 'lessons_empty' END,
    CASE WHEN coalesce(rc.minichecks_parsed,0) = 0 AND coalesce(rc.real_lessons,0) > 0 THEN 'minichecks_dead_end' END,
    CASE WHEN coalesce(ec.exam_approved,0) < 20 THEN 'exam_training_dead_end' END,
    CASE WHEN coalesce(hc.handbook_sections_real,0) = 0 THEN 'handbook_dead_end' END
  ], NULL) AS dead_ends,

  coalesce(rc.qc_tier1_failed,0) AS qc_needs_revision,
  p.published_at AS updated_at

FROM pkg p
LEFT JOIN real_content rc ON rc.package_id = p.package_id
LEFT JOIN exam_counts ec ON ec.package_id = p.package_id
LEFT JOIN handbook_counts hc ON hc.package_id = p.package_id
LEFT JOIN computed c ON c.package_id = p.package_id;

-- ============================================================
-- VIEW: ops_package_step_readiness (per-step drilldown)
-- ============================================================
CREATE VIEW public.ops_package_step_readiness AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.title AS package_title, c.id AS course_id
  FROM course_packages cp
  JOIN courses c ON cp.course_id = c.id
  WHERE cp.archived IS NOT TRUE
)
SELECT
  p.package_id, p.package_title, l.step AS lesson_step,
  count(l.id) AS total_lessons,
  count(l.id) FILTER (
    WHERE l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500
  ) AS real_lessons,
  count(l.id) - count(l.id) FILTER (
    WHERE l.content IS NOT NULL AND l.content::text <> 'null'
      AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500
  ) AS placeholder_lessons,
  count(l.id) FILTER (WHERE l.qc_status = 'approved') AS qc_approved,
  count(l.id) FILTER (WHERE l.qc_status = 'tier1_passed') AS qc_tier1_passed,
  count(l.id) FILTER (WHERE l.qc_status = 'tier1_failed') AS qc_tier1_failed,
  count(l.id) FILTER (WHERE l.qc_status IS NULL OR l.qc_status = 'pending') AS qc_pending,
  CASE WHEN count(l.id) > 0
    THEN round(100.0 * count(l.id) FILTER (
      WHERE l.content IS NOT NULL AND l.content::text <> 'null'
        AND l.content::text NOT LIKE '%_placeholder%' AND length(l.content::text) > 500
    ) / count(l.id), 1) ELSE 0 END AS materialization_pct
FROM pkg p
JOIN modules m ON m.course_id = p.course_id
JOIN lessons l ON l.module_id = m.id
GROUP BY p.package_id, p.package_title, l.step;

-- ============================================================
-- VIEW: ops_package_blockers (blocker detection from readiness)
-- ============================================================
CREATE VIEW public.ops_package_blockers AS
WITH base AS (
  SELECT * FROM ops_package_readiness WHERE total_lessons > 0
)
SELECT
  package_id, package_title, status, priority, readiness_band, readiness_score,
  materialization_pct, qc_approved_pct, exam_risk_coverage_pct, learner_step_completeness_pct,
  blocked_reason,
  (materialization_pct < 50 AND placeholder_lessons > real_lessons) AS blocker_placeholder_heavy,
  (qc_approved_pct < 30 AND real_lessons > 20) AS blocker_qc_bottleneck,
  (learner_step_completeness_pct < 60) AS blocker_step_incomplete,
  (exam_risk_coverage_pct < 10) AS blocker_exam_risk_low,
  (blocked_reason IS NOT NULL) AS blocker_pipeline_blocked,
  (CASE WHEN materialization_pct < 50 AND placeholder_lessons > real_lessons THEN 1 ELSE 0 END
   + CASE WHEN qc_approved_pct < 30 AND real_lessons > 20 THEN 1 ELSE 0 END
   + CASE WHEN learner_step_completeness_pct < 60 THEN 1 ELSE 0 END
   + CASE WHEN exam_risk_coverage_pct < 10 THEN 1 ELSE 0 END
   + CASE WHEN blocked_reason IS NOT NULL THEN 1 ELSE 0 END
  ) AS blocker_count
FROM base;
