
-- ═══════════════════════════════════════════════════════════════
-- Missing Step Backbone Guard — Ops Alert View
-- Detects packages missing mandatory pipeline steps.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.ops_missing_step_backbone AS
WITH mandatory_steps AS (
  SELECT unnest(ARRAY[
    'scaffold_learning_course',
    'generate_glossary',
    'fanout_learning_content',
    'generate_learning_content',
    'finalize_learning_content',
    'validate_learning_content',
    'auto_seed_exam_blueprints',
    'validate_blueprints',
    'generate_exam_pool',
    'validate_exam_pool',
    'generate_lesson_minichecks',
    'validate_lesson_minichecks',
    'generate_handbook',
    'validate_handbook',
    'enqueue_handbook_expand',
    'expand_handbook',
    'validate_handbook_depth',
    'generate_oral_exam',
    'validate_oral_exam',
    'build_ai_tutor_index',
    'validate_tutor_index',
    'elite_harden',
    'run_integrity_check',
    'quality_council',
    'auto_publish'
  ]) AS step_key
),
active_packages AS (
  SELECT id AS package_id, title, status, build_progress, created_at
  FROM public.course_packages
  WHERE status NOT IN ('published', 'archived')
),
expected AS (
  SELECT ap.package_id, ap.title, ap.status, ap.build_progress, ap.created_at, ms.step_key
  FROM active_packages ap
  CROSS JOIN mandatory_steps ms
),
existing AS (
  SELECT package_id, step_key
  FROM public.package_steps
)
SELECT
  e.package_id,
  e.title,
  e.status,
  e.build_progress,
  e.created_at,
  array_agg(e.step_key ORDER BY e.step_key) AS missing_steps,
  count(*) AS missing_count
FROM expected e
LEFT JOIN existing ex ON ex.package_id = e.package_id AND ex.step_key = e.step_key
WHERE ex.step_key IS NULL
GROUP BY e.package_id, e.title, e.status, e.build_progress, e.created_at
ORDER BY e.status DESC, missing_count DESC;
