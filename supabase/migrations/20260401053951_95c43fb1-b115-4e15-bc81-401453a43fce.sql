-- ═══════════════════════════════════════════════════════════
-- FIX 1: WIP-Reduktion — Top 5 priorisieren, Rest pausieren
-- ═══════════════════════════════════════════════════════════

-- Top 5 by progress: set priority 1
UPDATE course_packages SET priority = 1 WHERE id IN (
  'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
  '570ccb3e-2937-4d81-b3d8-624b9be84737'
);
-- Unblock top-progress blocked packages
UPDATE course_packages SET priority = 1, status = 'queued', blocked_reason = NULL 
WHERE id IN (
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  '335decc8-9f68-4784-b318-a68f620bf77e'
);

-- Cancel ALL jobs for packages that will be paused BEFORE changing their status
-- This avoids idempotency conflicts
UPDATE job_queue
SET status = 'cancelled',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = 'CLEANUP: wip_reduction_pause'
WHERE status IN ('pending', 'processing', 'failed')
  AND package_id IN (
    SELECT id FROM course_packages 
    WHERE status = 'building' 
      AND id NOT IN (
        '9c1b3734-bb25-4986-baef-5bb1c20a212c',
        '11b697be-07a8-4164-ab1b-a8747ec49b03',
        '2e8da39f-60f8-44d9-8b70-e1176222ca55'
      )
  );

-- Now pause the low-progress building packages
UPDATE course_packages 
SET status = 'queued', priority = 99
WHERE status = 'building' 
  AND id NOT IN (
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    '11b697be-07a8-4164-ab1b-a8747ec49b03',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55'
  );

-- ═══════════════════════════════════════════════════════════
-- FIX 2: Queue-Stall — cancel hot-loop and reset focus jobs
-- ═══════════════════════════════════════════════════════════

-- Cancel remaining hot-loop integrity jobs for non-focus packages
UPDATE job_queue 
SET status = 'cancelled', completed_at = now(), locked_at = NULL, locked_by = NULL,
    last_error = 'CLEANUP: prereq_hot_loop'
WHERE job_type = 'package_run_integrity_check' 
  AND status IN ('pending', 'processing')
  AND package_id NOT IN (
    'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
    '570ccb3e-2937-4d81-b3d8-624b9be84737',
    'eff99cc4-785d-4f61-a3ef-12932d8043c3',
    '335decc8-9f68-4784-b318-a68f620bf77e',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    '11b697be-07a8-4164-ab1b-a8747ec49b03',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55'
  );

-- Cancel transient-loop oral_exam jobs for non-focus packages
UPDATE job_queue
SET status = 'cancelled', completed_at = now(), locked_at = NULL, locked_by = NULL,
    last_error = 'CLEANUP: transient_loop'
WHERE job_type = 'package_generate_oral_exam'
  AND status IN ('pending', 'processing')
  AND package_id NOT IN (
    'e0d10ecb-6dd2-4b75-9a31-b8d29a546aab',
    '570ccb3e-2937-4d81-b3d8-624b9be84737',
    'eff99cc4-785d-4f61-a3ef-12932d8043c3',
    '335decc8-9f68-4784-b318-a68f620bf77e',
    '9c1b3734-bb25-4986-baef-5bb1c20a212c',
    '11b697be-07a8-4164-ab1b-a8747ec49b03',
    '2e8da39f-60f8-44d9-8b70-e1176222ca55'
  );