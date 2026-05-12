CREATE OR REPLACE VIEW public.v_queued_tail_without_job AS
SELECT
  cp.id AS package_id,
  cp.package_key,
  cp.curriculum_id,
  cp.track,
  (SELECT COUNT(*) FROM exam_questions eq
    WHERE eq.package_id = cp.id AND eq.status = 'approved'::question_status) AS approved_q,
  COALESCE(((cp.feature_flags -> 'bronze') ->> 'requires_review')::boolean, false) AS bronze_review,
  COALESCE(((cp.feature_flags -> 'bronze') ->> 'manual_bypass')::boolean, false) AS bronze_bypass,
  (SELECT s.step_key
     FROM (SELECT ps.step_key,
                  CASE ps.step_key
                    WHEN 'run_integrity_check' THEN 1
                    WHEN 'quality_council'    THEN 2
                    WHEN 'auto_publish'       THEN 3
                  END AS ord
             FROM package_steps ps
            WHERE ps.package_id = cp.id
              AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
              AND ps.status::text IN ('queued','blocked')) s
    ORDER BY s.ord
    LIMIT 1) AS next_tail_step,
  CASE
    WHEN COALESCE(((cp.feature_flags -> 'bronze') ->> 'requires_review')::boolean, false) = true
     AND COALESCE(((cp.feature_flags -> 'bronze') ->> 'manual_bypass')::boolean, false) = false
    THEN 'BRONZE_REVIEW_TERMINAL'
    ELSE 'ELIGIBLE'
  END AS reconciler_verdict
FROM course_packages cp
WHERE cp.status = 'building'
  AND COALESCE(cp.archived, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM job_queue j
    WHERE j.package_id = cp.id
      AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending')
  )
  AND EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = cp.id
      AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
      AND ps.status::text IN ('queued','blocked')
  );

REVOKE ALL ON public.v_queued_tail_without_job FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_queued_tail_without_job TO service_role;