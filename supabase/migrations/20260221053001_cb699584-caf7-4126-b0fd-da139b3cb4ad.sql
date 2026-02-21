
-- =====================================================
-- FIX #1: Add generate_glossary to ops_next_step_queued_no_job step_rank
-- ROOT CAUSE: Glossary step was skipped because it had no rank → NULL rank → ordered LAST
-- This caused 8+ packages to skip glossary and proceed directly to learning_content
-- =====================================================
CREATE OR REPLACE VIEW public.ops_next_step_queued_no_job AS
WITH step_rank AS (
  SELECT v.step_key, v.rank
  FROM (VALUES
    ('scaffold_learning_course'::text,   10),
    ('generate_glossary'::text,          15),   -- ← FIX: was MISSING!
    ('auto_seed_exam_blueprints'::text,  20),
    ('validate_blueprints'::text,        30),
    ('generate_learning_content'::text,  40),
    ('validate_learning_content'::text,  50),
    ('generate_exam_pool'::text,         60),
    ('validate_exam_pool'::text,         70),
    ('generate_oral_exam'::text,         80),
    ('validate_oral_exam'::text,         90),
    ('build_ai_tutor_index'::text,      100),
    ('validate_tutor_index'::text,      110),
    ('generate_handbook'::text,         120),
    ('validate_handbook'::text,         130),
    ('quality_council'::text,           140),
    ('run_integrity_check'::text,       150),
    ('auto_publish'::text,              160)
  ) v(step_key, rank)
),
next_queued AS (
  SELECT
    ps.package_id,
    ps.step_key,
    ps.status::text AS step_status,
    ps.updated_at AS step_updated_at,
    row_number() OVER (PARTITION BY ps.package_id ORDER BY sr.rank, ps.updated_at) AS rn
  FROM package_steps ps
  LEFT JOIN step_rank sr ON sr.step_key = ps.step_key
  WHERE ps.status::text = 'queued'::text
),
active_jobs AS (
  SELECT DISTINCT job_queue.payload ->> 'package_id'::text AS package_id
  FROM job_queue
  WHERE (job_queue.status = ANY (ARRAY['pending'::text, 'processing'::text]))
    AND job_queue.payload ? 'package_id'::text
)
SELECT
  nq.package_id,
  cp.title,
  nq.step_key,
  nq.step_status,
  nq.step_updated_at
FROM next_queued nq
JOIN course_packages cp ON cp.id = nq.package_id
JOIN package_leases pl ON pl.package_id = nq.package_id AND pl.lease_until > now()
LEFT JOIN active_jobs aj ON aj.package_id = nq.package_id::text
WHERE nq.rn = 1
  AND aj.package_id IS NULL
  AND nq.step_updated_at < (now() - '00:05:00'::interval);

-- =====================================================
-- FIX #2: Data consistency - steps marked 'done' without finished_at
-- =====================================================
UPDATE public.package_steps
SET finished_at = updated_at
WHERE status = 'done' AND finished_at IS NULL;

-- =====================================================
-- FIX #3: Clean zombie job (processing but never started, stale lock error)
-- Reset to pending so claim_pending_jobs can properly pick it up
-- =====================================================
UPDATE public.job_queue
SET status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    last_error = 'Reset: zombie processing without started_at'
WHERE status = 'processing'
  AND started_at IS NULL
  AND last_error LIKE '%Stale lock%';
