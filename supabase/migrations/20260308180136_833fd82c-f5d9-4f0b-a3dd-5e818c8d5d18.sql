
-- ═══════════════════════════════════════════════════════════════
-- v_package_step_load: Active step-class load for capacity scheduling
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_package_step_load AS
SELECT
  cp.id AS package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  cp.track,
  ps.step_key,
  ps.status AS step_status,
  CASE
    WHEN ps.step_key IN ('generate_learning_content','generate_exam_pool','generate_oral_exam','generate_lesson_minichecks','elite_harden')
      THEN 'heavy'
    WHEN ps.step_key IN ('scaffold_learning_course','generate_glossary','auto_seed_exam_blueprints','generate_handbook')
      THEN 'medium'
    WHEN ps.step_key IN ('validate_learning_content','validate_blueprints','validate_exam_pool','validate_tutor_index','validate_oral_exam','validate_lesson_minichecks','validate_handbook','quality_council')
      THEN 'validation'
    ELSE 'light'
  END AS step_class
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id
WHERE cp.status = 'building'
  AND ps.status IN ('running','enqueued');

-- ═══════════════════════════════════════════════════════════════
-- get_pipeline_capacity_snapshot: RPC for runner + admin UI
-- Returns per-class counts + available slots
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_pipeline_capacity_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH class_counts AS (
    SELECT
      step_class,
      count(DISTINCT package_id) AS active_packages
    FROM v_package_step_load
    GROUP BY step_class
  ),
  total AS (
    SELECT count(DISTINCT package_id) AS total_active
    FROM v_package_step_load
  ),
  config_val AS (
    SELECT coalesce(
      (SELECT value::int FROM ops_pipeline_config WHERE key = 'max_concurrent_packages'),
      6
    ) AS max_packages
  )
  SELECT jsonb_build_object(
    'total_active', (SELECT total_active FROM total),
    'max_packages', (SELECT max_packages FROM config_val),
    'classes', jsonb_build_object(
      'heavy', coalesce((SELECT active_packages FROM class_counts WHERE step_class = 'heavy'), 0),
      'medium', coalesce((SELECT active_packages FROM class_counts WHERE step_class = 'medium'), 0),
      'validation', coalesce((SELECT active_packages FROM class_counts WHERE step_class = 'validation'), 0),
      'light', coalesce((SELECT active_packages FROM class_counts WHERE step_class = 'light'), 0)
    ),
    'limits', jsonb_build_object(
      'heavy', 2,
      'medium', 3,
      'validation', 1,
      'light', 2
    ),
    'snapshot_at', now()
  );
$$;

-- ═══════════════════════════════════════════════════════════════
-- Update max_concurrent_packages from 5 to 6 (Phase A)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO ops_pipeline_config (key, value)
VALUES ('max_concurrent_packages', '6')
ON CONFLICT (key) DO UPDATE SET value = '6', updated_at = now();
