
-- Drop old view first (columns changed)
DROP VIEW IF EXISTS public.ops_blocked_packages CASCADE;

-- ═══════════════════════════════════════════════════════════
-- Phase 0: Seeding Gate – ops_seeding_summary view
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.ops_seeding_summary AS
WITH lf_counts AS (
  SELECT curriculum_id, count(*) AS learning_field_count
  FROM learning_fields GROUP BY curriculum_id
),
comp_counts AS (
  SELECT lf.curriculum_id, count(c.id) AS competency_count
  FROM competencies c
  JOIN learning_fields lf ON c.learning_field_id = lf.id
  GROUP BY lf.curriculum_id
),
lesson_counts AS (
  SELECT co.id AS course_id, count(l.id) AS lesson_count
  FROM courses co
  JOIN modules m ON m.course_id = co.id
  JOIN lessons l ON l.module_id = m.id
  GROUP BY co.id
)
SELECT
  cp.id AS package_id,
  cp.certification_id,
  cp.title AS package_title,
  cp.status AS package_status,
  cur.title AS curriculum_title,
  cur.status AS curriculum_status,
  COALESCE(lf.learning_field_count, 0)::int AS learning_field_count,
  COALESCE(cc.competency_count, 0)::int AS competency_count,
  COALESCE(lc.lesson_count, 0)::int AS lesson_count,
  CASE
    WHEN cur.id IS NULL THEN 'missing'
    WHEN cur.status::text NOT IN ('frozen') THEN 'partial'
    WHEN COALESCE(lf.learning_field_count, 0) = 0 THEN 'missing'
    WHEN COALESCE(cc.competency_count, 0) < 10 THEN 'partial'
    WHEN COALESCE(lf.learning_field_count, 0) < 5 THEN 'partial'
    ELSE 'ready'
  END AS seed_status,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN cur.id IS NULL THEN 'curriculum_not_found' END,
    CASE WHEN cur.status::text NOT IN ('frozen') THEN 'curriculum_not_frozen' END,
    CASE WHEN COALESCE(lf.learning_field_count, 0) = 0 THEN 'no_learning_fields' END,
    CASE WHEN COALESCE(lf.learning_field_count, 0) BETWEEN 1 AND 4 THEN 'few_learning_fields' END,
    CASE WHEN COALESCE(cc.competency_count, 0) = 0 THEN 'no_competencies' END,
    CASE WHEN COALESCE(cc.competency_count, 0) BETWEEN 1 AND 9 THEN 'few_competencies' END
  ], NULL) AS seed_reasons
FROM course_packages cp
LEFT JOIN curricula cur ON cur.id = cp.certification_id
LEFT JOIN lf_counts lf ON lf.curriculum_id = cp.certification_id
LEFT JOIN comp_counts cc ON cc.curriculum_id = cp.certification_id
LEFT JOIN lesson_counts lc ON lc.course_id = cp.course_id;

-- ═══════════════════════════════════════════════════════════
-- Recreate ops_blocked_packages with seed_incomplete root cause
-- ═══════════════════════════════════════════════════════════
CREATE VIEW public.ops_blocked_packages AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.build_progress,
  cp.integrity_passed,
  cp.integrity_report,
  cp.queue_position,
  cp.certification_id,
  ar.status AS autofix_status,
  ar.last_score AS integrity_score,
  ar.stop_reason AS autofix_stop_reason,
  ar.id AS autofix_run_id,
  ss.seed_status,
  ss.seed_reasons,
  ss.learning_field_count,
  ss.competency_count,
  ss.curriculum_status,
  CASE
    WHEN ss.seed_status IN ('missing', 'partial') THEN 'seed_incomplete'
    WHEN cp.status = 'failed' THEN 'build_failed'
    WHEN cp.integrity_passed = false AND cp.status NOT IN ('planning', 'published') THEN 'integrity_failed'
    ELSE 'unknown'
  END AS root_cause
FROM course_packages cp
LEFT JOIN LATERAL (
  SELECT status, last_score, stop_reason, id
  FROM autofix_runs
  WHERE package_id = cp.id
  ORDER BY created_at DESC
  LIMIT 1
) ar ON true
LEFT JOIN ops_seeding_summary ss ON ss.package_id = cp.id
WHERE cp.status NOT IN ('published')
  AND (
    cp.status = 'failed'
    OR (cp.integrity_passed = false AND cp.status NOT IN ('planning'))
    OR ss.seed_status IN ('missing', 'partial')
  );
