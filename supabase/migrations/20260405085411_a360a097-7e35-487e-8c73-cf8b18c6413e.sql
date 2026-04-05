
-- Drop and recreate views with proper joins and severity_rank

DROP VIEW IF EXISTS public.v_admin_content_quality_packages;
CREATE OR REPLACE VIEW public.v_admin_content_quality_packages AS
SELECT
  cp.id AS package_id,
  COALESCE(c.title, cp.id::text) AS package_title,
  cp.track,
  cp.curriculum_id,
  cp.course_id,
  cp.status AS package_status,
  pqs.last_scanned_at,
  COALESCE(pqs.open_findings, 0) AS open_findings,
  COALESCE(pqs.critical_count, 0) AS critical_count,
  COALESCE(pqs.error_count, 0) AS error_count,
  COALESCE(pqs.warning_count, 0) AS warning_count,
  COALESCE(pqs.info_count, 0) AS info_count,
  COALESCE(pqs.overall_severity, 'info') AS overall_severity,
  CASE COALESCE(pqs.overall_severity, 'info')
    WHEN 'critical' THEN 0
    WHEN 'error'    THEN 1
    WHEN 'warning'  THEN 2
    ELSE 3
  END AS severity_rank,
  COALESCE(pqs.reheal_recommended, false) AS reheal_recommended,
  COALESCE(pqs.handbook_critical_count, 0) AS handbook_critical_count,
  COALESCE(pqs.lesson_critical_count, 0) AS lesson_critical_count
FROM public.course_packages cp
LEFT JOIN public.courses c ON c.id = cp.course_id
LEFT JOIN public.package_content_quality_summary pqs ON pqs.package_id = cp.id;

DROP VIEW IF EXISTS public.v_admin_content_quality_findings;
CREATE OR REPLACE VIEW public.v_admin_content_quality_findings AS
SELECT
  f.id,
  f.audit_run_id,
  f.package_id,
  f.curriculum_id,
  f.course_id,
  f.artifact_type,
  f.artifact_id,
  f.severity,
  CASE f.severity
    WHEN 'critical' THEN 0
    WHEN 'error'    THEN 1
    WHEN 'warning'  THEN 2
    ELSE 3
  END AS severity_rank,
  f.status,
  f.title,
  f.excerpt,
  f.generic_phrase_count,
  f.spelling_error_count,
  f.generic_ratio,
  f.generic_phrases,
  f.spelling_errors,
  f.auto_reheal_eligible,
  f.reheal_job_id,
  f.created_at,
  f.updated_at
FROM public.content_quality_audit_findings f;
