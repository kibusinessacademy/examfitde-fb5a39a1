CREATE OR REPLACE VIEW public.ops_next_step_queued_no_job
WITH (security_invoker = on) AS
WITH step_rank AS (
  SELECT * FROM (VALUES
    ('scaffold_learning_course', 10),
    ('auto_seed_exam_blueprints', 20),
    ('validate_blueprints', 30),
    ('generate_learning_content', 40),
    ('validate_learning_content', 50),
    ('generate_exam_pool', 60),
    ('validate_exam_pool', 70),
    ('generate_oral_exam', 80),
    ('validate_oral_exam', 90),
    ('build_ai_tutor_index', 100),
    ('validate_tutor_index', 110),
    ('generate_handbook', 120),
    ('validate_handbook', 130),
    ('quality_council', 140),
    ('run_integrity_check', 150),
    ('auto_publish', 160)
  ) AS v(step_key, rank)
),
next_queued AS (
  SELECT
    ps.package_id,
    ps.step_key,
    ps.status::text AS step_status,
    ps.updated_at AS step_updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY ps.package_id
      ORDER BY sr.rank ASC NULLS LAST, ps.updated_at ASC
    ) AS rn
  FROM public.package_steps ps
  LEFT JOIN step_rank sr ON sr.step_key = ps.step_key
  WHERE ps.status::text = 'queued'
),
active_jobs AS (
  SELECT DISTINCT payload->>'package_id' AS package_id
  FROM public.job_queue
  WHERE status IN ('pending','processing')
    AND payload ? 'package_id'
)
SELECT
  nq.package_id,
  cp.title,
  nq.step_key,
  nq.step_status,
  nq.step_updated_at
FROM next_queued nq
JOIN public.course_packages cp ON cp.id = nq.package_id
JOIN public.package_leases pl ON pl.package_id = nq.package_id AND pl.lease_until > now()
LEFT JOIN active_jobs aj ON aj.package_id = nq.package_id::text
WHERE nq.rn = 1
  AND aj.package_id IS NULL
  AND nq.step_updated_at < now() - interval '5 minutes';

NOTIFY pgrst, 'reload schema';