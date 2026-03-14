
-- =====================================================
-- FIX: Verkäufer (59b6e214) — Unstick validate_exam_pool
-- generate_exam_pool is done, validate_exam_pool is waiting for re-seed
-- but the re-seed already completed (0 LFs). Clear the waiting state.
-- =====================================================

-- Fix validate_exam_pool: clear re-seed wait since generate_exam_pool is done
UPDATE package_steps
SET last_error = NULL,
    meta = meta || '{"reseed_wait_cleared": true, "cleared_at": "2026-03-14T07:00:00Z"}'::jsonb
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
AND step_key = 'validate_exam_pool'
AND status = 'queued';

-- Cancel stale pending integrity check job (enqueued by QC before deps were met)
UPDATE job_queue
SET status = 'cancelled', last_error = 'Cancelled: stale pre-dep job'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
AND job_type = 'package_run_integrity_check'
AND status = 'pending';

-- Also fix Elektroniker validate_exam_pool (same pattern)
UPDATE package_steps
SET last_error = NULL,
    meta = meta || '{"reseed_wait_cleared": true, "cleared_at": "2026-03-14T07:00:00Z"}'::jsonb
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
AND step_key = 'validate_exam_pool'
AND status = 'queued'
AND last_error ILIKE '%re-seed%';
