-- Drop pipeline-level idempotency constraint that limits to 1 lesson job per package
-- The lesson-level constraint (uq_job_queue_active_lesson_step) already prevents
-- duplicate jobs for the same (package, lesson, step) combination.
DROP INDEX IF EXISTS idx_job_queue_pipeline_idempotency_scope;