
-- ============================================================
-- 1. Mass backfill: insert all missing mandatory steps for active packages
-- ============================================================
WITH mandatory_steps(step_key) AS (
  VALUES
    ('setup_course_package'),
    ('generate_curriculum'),
    ('generate_modules'),
    ('generate_lessons'),
    ('generate_lesson_content'),
    ('generate_learning_content'),
    ('fanout_learning_content'),
    ('finalize_learning_content'),
    ('validate_learning_content'),
    ('generate_exam_questions'),
    ('validate_exam_questions'),
    ('generate_lesson_minichecks'),
    ('validate_lesson_minichecks'),
    ('generate_oral_exam_content'),
    ('validate_oral_exam_content'),
    ('generate_handbook_content'),
    ('validate_handbook_content'),
    ('generate_tutor_index'),
    ('validate_tutor_index'),
    ('run_integrity_check'),
    ('council_review'),
    ('auto_publish'),
    ('setup_storefront'),
    ('launch_marketing'),
    ('post_launch_monitor')
),
active_packages AS (
  SELECT id AS package_id
  FROM public.course_packages
  WHERE status IN ('queued','building','blocked','council_review','planning')
),
missing AS (
  SELECT ap.package_id, ms.step_key
  FROM active_packages ap
  CROSS JOIN mandatory_steps ms
  WHERE NOT EXISTS (
    SELECT 1 FROM public.package_steps ps
    WHERE ps.package_id = ap.package_id
      AND ps.step_key = ms.step_key
  )
)
INSERT INTO public.package_steps (package_id, step_key, status, created_at, updated_at)
SELECT package_id, step_key, 'queued', now(), now()
FROM missing
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Replace the slow view with a performant version
-- ============================================================
DROP VIEW IF EXISTS public.ops_missing_step_backbone;

CREATE OR REPLACE VIEW public.ops_missing_step_backbone AS
WITH mandatory_steps(step_key) AS (
  VALUES
    ('setup_course_package'),
    ('generate_curriculum'),
    ('generate_modules'),
    ('generate_lessons'),
    ('generate_lesson_content'),
    ('generate_learning_content'),
    ('fanout_learning_content'),
    ('finalize_learning_content'),
    ('validate_learning_content'),
    ('generate_exam_questions'),
    ('validate_exam_questions'),
    ('generate_lesson_minichecks'),
    ('validate_lesson_minichecks'),
    ('generate_oral_exam_content'),
    ('validate_oral_exam_content'),
    ('generate_handbook_content'),
    ('validate_handbook_content'),
    ('generate_tutor_index'),
    ('validate_tutor_index'),
    ('run_integrity_check'),
    ('council_review'),
    ('auto_publish'),
    ('setup_storefront'),
    ('launch_marketing'),
    ('post_launch_monitor')
),
active_packages AS (
  SELECT id AS package_id, title, status
  FROM public.course_packages
  WHERE status IN ('queued','building','blocked','council_review','planning')
),
existing_steps AS (
  SELECT ps.package_id, ps.step_key
  FROM public.package_steps ps
  JOIN active_packages ap ON ap.package_id = ps.package_id
)
SELECT
  ap.package_id,
  ap.title AS package_title,
  ap.status AS package_status,
  ms.step_key AS missing_step,
  now() AS checked_at
FROM active_packages ap
CROSS JOIN mandatory_steps ms
WHERE NOT EXISTS (
  SELECT 1 FROM existing_steps es
  WHERE es.package_id = ap.package_id
    AND es.step_key = ms.step_key
);
