CREATE OR REPLACE VIEW public.v_admin_track_control AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.curriculum_id, cp.course_id,
    cp.status AS package_status, cp.track::text AS track, cp.build_progress, cp.priority,
    cp.created_at, cp.updated_at
  FROM public.course_packages cp
),
curr AS (
  SELECT c.id AS curriculum_id, c.title AS curriculum_title,
    c.status AS curriculum_status, c.program_type, c.track AS curriculum_track
  FROM public.curricula c
),
course AS (
  SELECT co.id AS course_id, co.title AS course_title, co.status AS course_status,
    co.publishing_status,
    COALESCE(co.publishing_status = 'published', false) AS is_published
  FROM public.courses co
),
steps AS (
  SELECT ps.package_id,
    count(*) FILTER (WHERE ps.status = 'done') AS steps_done,
    count(*) FILTER (WHERE ps.status = 'failed') AS steps_failed,
    count(*) FILTER (WHERE ps.status IN ('queued','enqueued','running')) AS steps_open,
    count(*) FILTER (WHERE ps.status = 'skipped') AS steps_skipped,
    count(*) FILTER (WHERE ps.status <> 'skipped') AS steps_functional,
    jsonb_object_agg(ps.step_key, ps.status::text) AS step_status_map
  FROM public.package_steps ps GROUP BY ps.package_id
),
exam_pool AS (
  SELECT eq.curriculum_id,
    count(*) FILTER (WHERE eq.status = 'approved') AS approved_exam_questions,
    count(*) FILTER (WHERE eq.status IN ('approved','review')) AS usable_exam_questions,
    round(100.0 * count(*) FILTER (WHERE eq.status = 'approved' AND eq.explanation IS NOT NULL)
      / NULLIF(count(*) FILTER (WHERE eq.status = 'approved'), 0), 1) AS explanation_coverage_pct,
    round(100.0 * count(*) FILTER (WHERE eq.status = 'approved' AND eq.trap_type IS NOT NULL AND eq.trap_type <> '')
      / NULLIF(count(*) FILTER (WHERE eq.status = 'approved'), 0), 1) AS trap_coverage_pct
  FROM public.exam_questions eq GROUP BY eq.curriculum_id
),
handbook AS (
  SELECT hc.curriculum_id, count(*) AS handbook_chapters
  FROM public.handbook_chapters hc GROUP BY hc.curriculum_id
),
minicheck AS (
  SELECT mq.curriculum_id, count(*) FILTER (WHERE mq.status = 'approved') AS approved_minicheck_questions
  FROM public.minicheck_questions mq GROUP BY mq.curriculum_id
),
lesson_counts AS (
  SELECT cp.id AS package_id, count(l.id) AS learning_lessons
  FROM public.course_packages cp
  JOIN public.courses co ON co.id = cp.course_id
  JOIN public.modules m ON m.course_id = co.id
  JOIN public.lessons l ON l.module_id = m.id
  GROUP BY cp.id
),
tutor AS (
  SELECT ti.package_id, count(*) AS tutor_index_items
  FROM public.ai_tutor_context_index ti GROUP BY ti.package_id
),
integrity AS (
  SELECT ps.package_id, ps.status::text AS integrity_step_status,
    ps.meta->'integrity_report' AS integrity_report,
    COALESCE((ps.meta->>'validation_passed')::boolean, false) AS integrity_passed,
    ps.meta->'integrity_report'->'hard_fail_reasons' AS hard_fail_reasons
  FROM public.package_steps ps WHERE ps.step_key = 'run_integrity_check'
),
qc AS (
  SELECT ps.package_id, ps.status::text AS quality_council_status
  FROM public.package_steps ps WHERE ps.step_key = 'quality_council'
),
pub AS (
  SELECT ps.package_id, ps.status::text AS auto_publish_status
  FROM public.package_steps ps WHERE ps.step_key = 'auto_publish'
),
oral_step AS (
  SELECT ps.package_id, ps.status::text AS oral_exam_step_status
  FROM public.package_steps ps WHERE ps.step_key = 'generate_oral_exam'
),
upgrade_latest AS (
  SELECT DISTINCT ON (d.curriculum_id)
    d.curriculum_id, d.package_id, d.current_track, d.recommended_track,
    d.score, d.decision, d.reasons, d.created_at AS upgrade_decision_at
  FROM public.course_upgrade_decisions d
  ORDER BY d.curriculum_id, d.created_at DESC
)
SELECT
  pkg.package_id, pkg.curriculum_id, pkg.course_id,
  curr.curriculum_title, course.course_title,
  pkg.package_status, pkg.build_progress, pkg.priority,
  curr.curriculum_status, course.course_status, course.is_published,
  pkg.track AS package_track, curr.curriculum_track, curr.program_type,
  COALESCE(steps.steps_done, 0) AS steps_done,
  COALESCE(steps.steps_failed, 0) AS steps_failed,
  COALESCE(steps.steps_open, 0) AS steps_open,
  COALESCE(steps.steps_skipped, 0) AS steps_skipped,
  COALESCE(steps.steps_functional, 0) AS steps_functional,
  steps.step_status_map,
  COALESCE(exam_pool.approved_exam_questions, 0) AS approved_exam_questions,
  COALESCE(exam_pool.usable_exam_questions, 0) AS usable_exam_questions,
  COALESCE(exam_pool.explanation_coverage_pct, 0) AS explanation_coverage_pct,
  COALESCE(exam_pool.trap_coverage_pct, 0) AS trap_coverage_pct,
  COALESCE(handbook.handbook_chapters, 0) AS handbook_chapters,
  COALESCE(minicheck.approved_minicheck_questions, 0) AS approved_minicheck_questions,
  COALESCE(lesson_counts.learning_lessons, 0) AS learning_lessons,
  COALESCE(tutor.tutor_index_items, 0) AS tutor_index_items,
  oral_step.oral_exam_step_status,
  integrity.integrity_step_status, integrity.integrity_report,
  integrity.integrity_passed, integrity.hard_fail_reasons,
  qc.quality_council_status, pub.auto_publish_status,
  upgrade_latest.current_track AS latest_upgrade_current_track,
  upgrade_latest.recommended_track AS latest_upgrade_recommended_track,
  upgrade_latest.score AS latest_upgrade_score,
  upgrade_latest.decision AS latest_upgrade_decision,
  upgrade_latest.reasons AS latest_upgrade_reasons,
  upgrade_latest.upgrade_decision_at,
  pkg.created_at, pkg.updated_at,
  COALESCE(course.course_title, curr.curriculum_title, 'Paket ' || left(pkg.package_id::text, 8)) AS title
FROM pkg
LEFT JOIN curr ON curr.curriculum_id = pkg.curriculum_id
LEFT JOIN course ON course.course_id = pkg.course_id
LEFT JOIN steps ON steps.package_id = pkg.package_id
LEFT JOIN exam_pool ON exam_pool.curriculum_id = pkg.curriculum_id
LEFT JOIN handbook ON handbook.curriculum_id = pkg.curriculum_id
LEFT JOIN minicheck ON minicheck.curriculum_id = pkg.curriculum_id
LEFT JOIN lesson_counts ON lesson_counts.package_id = pkg.package_id
LEFT JOIN tutor ON tutor.package_id = pkg.package_id
LEFT JOIN oral_step ON oral_step.package_id = pkg.package_id
LEFT JOIN integrity ON integrity.package_id = pkg.package_id
LEFT JOIN qc ON qc.package_id = pkg.package_id
LEFT JOIN pub ON pub.package_id = pkg.package_id
LEFT JOIN upgrade_latest ON upgrade_latest.curriculum_id = pkg.curriculum_id;