
-- Step 1: Cancel ALL duplicate older entries (keep only newest per idempotency_key)
WITH ranked AS (
  SELECT id, idempotency_key,
    ROW_NUMBER() OVER (PARTITION BY idempotency_key ORDER BY created_at DESC) AS rn
  FROM public.job_queue
  WHERE job_type IN ('package_generate_glossary','package_generate_handbook','package_generate_oral_exam','package_generate_lesson_minichecks','package_run_integrity_check')
    AND status IN ('failed','cancelled')
    AND idempotency_key IS NOT NULL
)
UPDATE public.job_queue SET status = 'cancelled', completed_at = now(), locked_at = NULL, locked_by = NULL,
  last_error = COALESCE(last_error,'') || ' [DEDUP_CLEANUP]'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2: Cancel premature pending downstream jobs where validate_learning_content isn't done
UPDATE public.job_queue
SET status = 'cancelled', last_error = 'CLEANUP: premature_enqueue_from_finalize',
    completed_at = now(), locked_at = NULL, locked_by = NULL
WHERE job_type IN ('package_generate_handbook', 'package_generate_oral_exam', 'package_generate_lesson_minichecks', 'package_build_ai_tutor_index')
  AND status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.package_steps ps
    WHERE ps.package_id = job_queue.package_id
      AND ps.step_key = 'validate_learning_content'
      AND ps.status NOT IN ('done', 'skipped')
  );

-- Step 3: Reset surviving unique failed glossary jobs
UPDATE public.job_queue
SET status = 'pending', attempts = 0, last_error = NULL, locked_at = NULL, locked_by = NULL,
    meta = COALESCE(meta, '{}'::jsonb) || '{"reset_reason": "glossary_fail_soft_fix"}'::jsonb
WHERE job_type = 'package_generate_glossary' AND status = 'failed'
  AND (last_error LIKE '%MATERIALIZATION_GUARD%' OR last_error LIKE '%NO_BERUF_ID%');

-- Step 4: Reset surviving unique failed handbook/minichecks/oral jobs
UPDATE public.job_queue
SET status = 'pending', attempts = 0, last_error = NULL, locked_at = NULL, locked_by = NULL,
    run_after = now() + interval '30 seconds',
    meta = COALESCE(meta, '{}'::jsonb) || '{"reset_reason": "prereq_now_transient"}'::jsonb
WHERE job_type IN ('package_generate_handbook', 'package_generate_oral_exam', 'package_generate_lesson_minichecks')
  AND status = 'failed'
  AND (last_error LIKE '%PREREQ_NOT_DONE%' OR last_error LIKE '%409%' OR last_error LIKE '%MATERIALIZATION_GUARD%');

-- Step 5: Reset surviving unique failed integrity check jobs
UPDATE public.job_queue
SET status = 'pending', attempts = 0, last_error = NULL, locked_at = NULL, locked_by = NULL,
    run_after = now() + interval '30 seconds',
    meta = COALESCE(meta, '{}'::jsonb) || '{"reset_reason": "integrity_recovery_expanded"}'::jsonb
WHERE job_type = 'package_run_integrity_check' AND status = 'failed'
  AND (last_error LIKE '%MATERIALIZATION_GUARD%' OR last_error LIKE '%PACKAGE_NOT_EXECUTABLE%' OR last_error LIKE '%NON_BUILDING%' OR last_error LIKE '%OPS_GUARD%');
