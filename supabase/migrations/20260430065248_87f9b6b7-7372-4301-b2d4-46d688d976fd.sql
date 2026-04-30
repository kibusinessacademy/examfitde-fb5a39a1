
CREATE OR REPLACE VIEW public.v_admin_targeted_heal_diagnosis
WITH (security_invoker = true)
AS
WITH promote_hot AS (
  SELECT 'PROMOTE_HOTLOOP'::text AS kind,
         count(DISTINCT job_queue.package_id)::integer AS packages,
         count(*)::integer AS jobs,
         max(job_queue.attempts) AS max_attempts
    FROM job_queue
   WHERE job_queue.job_type = 'package_promote_blueprint_variants'
     AND (job_queue.status = ANY (ARRAY['pending','processing','failed']))
     AND job_queue.attempts >= 8
     AND job_queue.updated_at > (now() - '7 days'::interval)
), hollow AS (
  SELECT 'HOLLOW_PUBLISHED'::text AS kind,
         count(*)::integer AS packages,
         0 AS jobs,
         0 AS max_attempts
    FROM course_packages cp
   WHERE cp.status = 'published'
     AND (cp.integrity_report::text ILIKE '%hollow%'
          OR cp.id IN (SELECT package_steps.package_id FROM package_steps WHERE cp.blocked_reason ILIKE '%HOLLOW%'))
     -- Beide Quellen müssen leer sein für echtes Hollow:
     AND (SELECT count(*) FROM exam_question_variants v WHERE v.curriculum_id = cp.curriculum_id AND v.status = 'approved') = 0
     AND (SELECT count(*) FROM exam_questions eq WHERE eq.package_id = cp.id AND eq.status = 'approved') = 0
), stale_reaped AS (
  SELECT 'STALE_REAPED_RESIDUE'::text AS kind,
         count(DISTINCT job_queue.package_id)::integer AS packages,
         count(*)::integer AS jobs,
         max(job_queue.attempts) AS max_attempts
    FROM job_queue
   WHERE job_queue.status = 'failed'
     AND (job_queue.last_error_code = ANY (ARRAY['STALE_PROCESSING_REAPED','STALE_PROCESSING_EXHAUSTED']))
     AND job_queue.updated_at > (now() - '24:00:00'::interval)
)
SELECT * FROM promote_hot
UNION ALL SELECT * FROM hollow
UNION ALL SELECT * FROM stale_reaped;

NOTIFY pgrst, 'reload schema';
