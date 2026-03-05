-- Drop overly restrictive curriculum-level unique constraint
-- This constraint limits lesson_generate_content to 1 active job per curriculum,
-- but individual lessons need their own jobs. The lesson-level constraint
-- (uq_job_queue_active_lesson_step) provides sufficient dedup protection.
DROP INDEX IF EXISTS uq_jobqueue_curriculum_jobtype_scope_active;

-- Also drop the package-level one which has the same issue
-- (the lesson-level constraint already covers this more granularly)
DROP INDEX IF EXISTS uq_jobqueue_package_jobtype_scope_active;