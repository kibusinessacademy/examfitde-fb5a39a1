
DROP VIEW IF EXISTS public.ops_legacy_package_audit;

CREATE VIEW public.ops_legacy_package_audit AS
SELECT 
  cp.id AS package_id,
  cp.title,
  cp.status::text AS status,
  cp.track,
  cp.integrity_report_version_num,
  cp.integrity_passed,
  (cp.integrity_report->>'score')::numeric AS integrity_score,
  cp.integrity_report->>'gate_version' AS gate_version,
  cp.integrity_report->>'generated_at' AS report_generated_at,
  cp.updated_at,
  (SELECT count(*) FROM package_steps ps WHERE ps.package_id = cp.id AND ps.status = 'done') AS steps_done,
  (SELECT count(*) FROM package_steps ps WHERE ps.package_id = cp.id) AS steps_total,
  500 AS exam_target,
  (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id) AS exam_actual,
  CASE WHEN COALESCE(cp.integrity_report_version_num, 0) < 15 AND cp.integrity_report IS NOT NULL THEN true ELSE false END AS needs_report_refresh,
  CASE WHEN (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id) < 250 THEN true ELSE false END AS needs_production_run
FROM course_packages cp
WHERE cp.status NOT IN ('archived', 'superseded')
ORDER BY cp.updated_at DESC;

-- Also update drift_finder to use numeric
DROP VIEW IF EXISTS public.ops_drift_finder;
CREATE VIEW public.ops_drift_finder AS

SELECT 
  'false_done_exam_pool' AS drift_type,
  cp.id AS package_id,
  cp.title,
  cp.status::text AS package_status,
  ps.step_key,
  ps.status::text AS step_status,
  jsonb_build_object(
    'exam_target', 500,
    'actual_count', (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id),
    'shortfall', 500 - (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id)
  ) AS detail
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id
WHERE ps.step_key = 'generate_exam_pool'
  AND ps.status = 'done'
  AND cp.status NOT IN ('archived', 'superseded')
  AND cp.track = 'AUSBILDUNG_VOLL'
  AND (SELECT count(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id) < 500

UNION ALL

SELECT 
  'stale_integrity_report' AS drift_type,
  cp.id AS package_id,
  cp.title,
  cp.status::text AS package_status,
  'run_integrity_check' AS step_key,
  COALESCE(ps.status::text, 'n/a') AS step_status,
  jsonb_build_object(
    'report_version_num', cp.integrity_report_version_num,
    'has_report', cp.integrity_report IS NOT NULL,
    'integrity_passed', cp.integrity_passed
  ) AS detail
FROM course_packages cp
LEFT JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'run_integrity_check'
WHERE cp.integrity_report IS NOT NULL
  AND cp.status NOT IN ('archived', 'superseded')
  AND COALESCE(cp.integrity_report_version_num, 0) < 15

UNION ALL

SELECT 
  'false_done_handbook' AS drift_type,
  cp.id AS package_id,
  cp.title,
  cp.status::text AS package_status,
  ps.step_key,
  ps.status::text AS step_status,
  jsonb_build_object(
    'total_sections', (SELECT count(*) FROM handbook_sections hs JOIN handbook_chapters hc ON hc.id = hs.chapter_id WHERE hc.curriculum_id = cp.curriculum_id),
    'short_sections', (SELECT count(*) FROM handbook_sections hs JOIN handbook_chapters hc ON hc.id = hs.chapter_id WHERE hc.curriculum_id = cp.curriculum_id AND length(COALESCE(hs.content_markdown, '')) < 800)
  ) AS detail
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id
WHERE ps.step_key = 'generate_handbook'
  AND ps.status = 'done'
  AND cp.status NOT IN ('archived', 'superseded')
  AND EXISTS (
    SELECT 1 FROM handbook_sections hs 
    JOIN handbook_chapters hc ON hc.id = hs.chapter_id 
    WHERE hc.curriculum_id = cp.curriculum_id 
      AND length(COALESCE(hs.content_markdown, '')) < 800
  )

UNION ALL

SELECT
  'zombie_cooldown' AS drift_type,
  jq.package_id,
  cp.title,
  cp.status::text AS package_status,
  'generate_exam_pool' AS step_key,
  'cooldown' AS step_status,
  jsonb_build_object(
    'job_id', jq.id,
    'job_type', jq.job_type,
    'generated', COALESCE((jq.result->>'generated')::int, 0),
    'completed_at', jq.completed_at
  ) AS detail
FROM job_queue jq
JOIN course_packages cp ON cp.id = jq.package_id
WHERE jq.job_type = 'package_generate_exam_pool'
  AND jq.status = 'completed'
  AND COALESCE((jq.result->>'generated')::int, 0) = 0
  AND jq.completed_at > now() - interval '24 hours'
  AND cp.status NOT IN ('archived', 'superseded');
