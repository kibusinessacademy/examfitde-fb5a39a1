
-- Phase 0 v4: correct schema

ALTER TABLE public.auto_heal_policies
  ADD COLUMN IF NOT EXISTS seeding_thresholds jsonb DEFAULT '{"learning_fields":5,"competencies":10}'::jsonb;

DROP VIEW IF EXISTS ops_blocked_packages CASCADE;
DROP VIEW IF EXISTS ops_seeding_summary CASCADE;

CREATE OR REPLACE VIEW ops_seeding_summary AS
SELECT
  cp.id AS package_id,
  cp.certification_id,
  cp.title AS package_title,
  cp.status AS package_status,
  cur.title AS curriculum_title,
  cur.status AS curriculum_status,
  COALESCE(lf.cnt, 0) AS learning_field_count,
  COALESCE(comp.cnt, 0) AS competency_count,
  COALESCE(les.cnt, 0) AS lesson_count,
  CASE
    WHEN cur.id IS NULL THEN 'missing'
    WHEN COALESCE(lf.cnt, 0) = 0 THEN 'missing'
    WHEN COALESCE(comp.cnt, 0) = 0 THEN 'missing'
    WHEN cur.status != 'frozen' AND COALESCE(lf.cnt, 0) < 5 THEN 'partial'
    WHEN COALESCE(comp.cnt, 0) < 10 THEN 'partial'
    ELSE 'ready'
  END AS seed_status,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN cur.id IS NULL THEN 'curriculum_not_found' END,
    CASE WHEN cur.id IS NOT NULL AND cur.status != 'frozen' THEN 'curriculum_not_frozen' END,
    CASE WHEN COALESCE(lf.cnt, 0) = 0 THEN 'no_learning_fields' END,
    CASE WHEN COALESCE(lf.cnt, 0) BETWEEN 1 AND 4 THEN 'few_learning_fields' END,
    CASE WHEN COALESCE(comp.cnt, 0) = 0 THEN 'no_competencies' END,
    CASE WHEN COALESCE(comp.cnt, 0) BETWEEN 1 AND 9 THEN 'few_competencies' END
  ], NULL) AS seed_reasons
FROM course_packages cp
LEFT JOIN curricula cur ON cur.id = cp.certification_id
LEFT JOIN (
  SELECT curriculum_id, COUNT(*) AS cnt FROM learning_fields GROUP BY curriculum_id
) lf ON lf.curriculum_id = cur.id
LEFT JOIN (
  SELECT lf2.curriculum_id, COUNT(*) AS cnt
  FROM competencies c JOIN learning_fields lf2 ON lf2.id = c.learning_field_id
  GROUP BY lf2.curriculum_id
) comp ON comp.curriculum_id = cur.id
LEFT JOIN (
  SELECT m.course_id, COUNT(*) AS cnt
  FROM modules m JOIN lessons l ON l.module_id = m.id
  GROUP BY m.course_id
) les ON les.course_id = cp.course_id;

CREATE OR REPLACE VIEW ops_blocked_packages AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.build_progress,
  cp.integrity_passed,
  cp.integrity_report,
  cp.certification_id,
  cp.course_id,
  afr.status AS autofix_status,
  afr.last_score AS autofix_last_score,
  seed.seed_status,
  seed.seed_reasons,
  seed.learning_field_count,
  seed.competency_count,
  CASE
    WHEN seed.seed_status IN ('missing', 'partial') THEN 'seed_incomplete'
    WHEN cp.status = 'failed' THEN 'build_failed'
    WHEN cp.integrity_passed = false AND cp.status NOT IN ('planning', 'published') THEN 'integrity_failed'
    ELSE 'unknown'
  END AS block_reason
FROM course_packages cp
LEFT JOIN LATERAL (
  SELECT status, last_score FROM autofix_runs
  WHERE package_id = cp.id ORDER BY created_at DESC LIMIT 1
) afr ON true
LEFT JOIN ops_seeding_summary seed ON seed.package_id = cp.id
WHERE cp.status NOT IN ('published')
  AND (
    cp.status = 'failed'
    OR (cp.integrity_passed = false AND cp.status NOT IN ('planning'))
    OR seed.seed_status IN ('missing', 'partial')
  );
