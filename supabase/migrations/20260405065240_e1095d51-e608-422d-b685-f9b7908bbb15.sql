
-- 1. Master view
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
  pkg.created_at, pkg.updated_at
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

-- 2. Track Compliance
CREATE OR REPLACE VIEW public.v_admin_track_compliance AS
SELECT t.*,
  CASE
    WHEN t.package_track = 'AUSBILDUNG_VOLL' AND t.learning_lessons > 0 AND t.approved_minicheck_questions > 0 AND t.handbook_chapters > 0 AND t.tutor_index_items > 0 THEN true
    WHEN t.package_track = 'EXAM_FIRST' AND t.learning_lessons = 0 AND t.approved_exam_questions > 0 AND t.tutor_index_items > 0 THEN true
    WHEN t.package_track = 'EXAM_FIRST_PLUS' AND t.learning_lessons = 0 AND t.approved_exam_questions > 0 AND t.handbook_chapters > 0 AND t.tutor_index_items > 0 THEN true
    WHEN t.package_track = 'STUDIUM' AND t.approved_exam_questions > 0 AND t.tutor_index_items > 0 THEN true
    ELSE false
  END AS track_compliant,
  CASE
    WHEN t.package_track = 'AUSBILDUNG_VOLL' AND t.learning_lessons = 0 THEN 'FULL_MISSING_LEARNING'
    WHEN t.package_track = 'AUSBILDUNG_VOLL' AND t.approved_minicheck_questions = 0 THEN 'FULL_MISSING_MINICHECKS'
    WHEN t.package_track = 'EXAM_FIRST' AND t.learning_lessons > 0 THEN 'EXAM_FIRST_HAS_LEARNING_CONTENT'
    WHEN t.package_track = 'EXAM_FIRST_PLUS' AND t.learning_lessons > 0 THEN 'EXAM_FIRST_PLUS_HAS_LEARNING_CONTENT'
    WHEN t.package_track = 'EXAM_FIRST_PLUS' AND t.handbook_chapters = 0 THEN 'EXAM_FIRST_PLUS_MISSING_HANDBOOK'
    WHEN t.package_track = 'STUDIUM' AND t.approved_exam_questions = 0 THEN 'STUDIUM_MISSING_EXAM_POOL'
    ELSE null
  END AS track_violation_code
FROM public.v_admin_track_control t;

-- 3. Publish Readiness
CREATE OR REPLACE VIEW public.v_admin_publish_readiness AS
SELECT c.*,
  CASE
    WHEN c.package_track = 'AUSBILDUNG_VOLL' THEN (c.approved_exam_questions >= 300 AND c.learning_lessons > 0 AND c.approved_minicheck_questions > 0 AND c.handbook_chapters > 0 AND c.tutor_index_items > 0 AND c.integrity_passed = true AND c.quality_council_status = 'done')
    WHEN c.package_track = 'EXAM_FIRST' THEN (c.approved_exam_questions >= 150 AND c.tutor_index_items > 0 AND c.integrity_passed = true AND c.quality_council_status = 'done')
    WHEN c.package_track = 'EXAM_FIRST_PLUS' THEN (c.approved_exam_questions >= 300 AND c.handbook_chapters > 0 AND c.tutor_index_items > 0 AND c.integrity_passed = true AND c.quality_council_status = 'done')
    WHEN c.package_track = 'STUDIUM' THEN (c.approved_exam_questions >= 200 AND c.tutor_index_items > 0 AND c.integrity_passed = true AND c.quality_council_status = 'done')
    ELSE false
  END AS publish_ready,
  CASE
    WHEN c.integrity_passed IS NOT TRUE THEN 'INTEGRITY_FAILED'
    WHEN c.quality_council_status <> 'done' THEN 'QUALITY_COUNCIL_PENDING'
    WHEN c.package_track = 'AUSBILDUNG_VOLL' AND c.learning_lessons = 0 THEN 'MISSING_LEARNING'
    WHEN c.package_track = 'AUSBILDUNG_VOLL' AND c.approved_minicheck_questions = 0 THEN 'MISSING_MINICHECKS'
    WHEN c.package_track = 'EXAM_FIRST_PLUS' AND c.handbook_chapters = 0 THEN 'MISSING_HANDBOOK'
    WHEN c.package_track IN ('EXAM_FIRST','EXAM_FIRST_PLUS') AND c.tutor_index_items = 0 THEN 'MISSING_TUTOR_INDEX'
    WHEN c.package_track = 'AUSBILDUNG_VOLL' AND c.approved_exam_questions < 300 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN c.package_track = 'EXAM_FIRST' AND c.approved_exam_questions < 150 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN c.package_track = 'EXAM_FIRST_PLUS' AND c.approved_exam_questions < 300 THEN 'EXAM_POOL_TOO_SMALL'
    WHEN c.package_track = 'STUDIUM' AND c.approved_exam_questions < 200 THEN 'EXAM_POOL_TOO_SMALL'
    ELSE null
  END AS primary_blocker
FROM public.v_admin_track_compliance c;

-- 4. Upgrade Candidates
CREATE OR REPLACE VIEW public.v_admin_upgrade_candidates AS
SELECT p.package_id, p.curriculum_id, p.course_id,
  p.curriculum_title, p.course_title, p.package_status,
  p.package_track, p.latest_upgrade_score, p.latest_upgrade_decision,
  p.latest_upgrade_recommended_track, p.latest_upgrade_reasons,
  p.upgrade_decision_at, p.approved_exam_questions,
  p.learning_lessons, p.handbook_chapters, p.tutor_index_items,
  p.integrity_passed, p.is_published,
  CASE
    WHEN p.package_track = 'EXAM_FIRST' AND p.latest_upgrade_decision = 'upgrade' AND p.package_status IN ('published','building') THEN true
    ELSE false
  END AS is_upgrade_candidate
FROM public.v_admin_track_control p;

-- 5. Override table
CREATE TABLE IF NOT EXISTS public.course_track_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL,
  package_id uuid,
  forced_track text NOT NULL CHECK (forced_track IN ('AUSBILDUNG_VOLL','EXAM_FIRST','EXAM_FIRST_PLUS','STUDIUM')),
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
ALTER TABLE public.course_track_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view overrides" ON public.course_track_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert overrides" ON public.course_track_overrides FOR INSERT TO authenticated WITH CHECK (true);

-- 6. Effective Track view
CREATE OR REPLACE VIEW public.v_admin_effective_track AS
WITH latest_override AS (
  SELECT DISTINCT ON (curriculum_id)
    curriculum_id, package_id, forced_track, reason, created_at, expires_at
  FROM public.course_track_overrides
  WHERE expires_at IS NULL OR expires_at > now()
  ORDER BY curriculum_id, created_at DESC
)
SELECT tc.*, lo.forced_track, lo.reason AS override_reason,
  COALESCE(lo.forced_track, tc.package_track) AS effective_track
FROM public.v_admin_track_control tc
LEFT JOIN latest_override lo ON lo.curriculum_id = tc.curriculum_id;

NOTIFY pgrst, 'reload schema';
