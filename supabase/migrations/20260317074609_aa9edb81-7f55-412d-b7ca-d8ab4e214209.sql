
-- Chirurgische Reparatur: Elektroniker für Betriebstechnik (fd1d8192)
-- Problem: generate_exam_pool Step blockiert durch loop_guard + stale batch requests

-- Step 1: Cancel all failed/pending exam_pool jobs (stale OPS_GUARD jobs)
UPDATE job_queue 
SET status = 'cancelled', error = 'SURGICAL_REPAIR: stale exam_pool jobs cleared', completed_at = now(), updated_at = now()
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
AND job_type = 'package_generate_exam_pool'
AND status IN ('pending','processing','failed');

-- Step 2: Reset the blocked generate_exam_pool step to queued
UPDATE package_steps 
SET status = 'queued', attempts = 0, last_error = null, started_at = null, finished_at = null,
    runner_id = null, job_id = null, last_heartbeat_at = null,
    meta = jsonb_build_object('note', 'surgical_repair_exam_pool', 'reset_at', now()::text, 'previous_block', 'loop_guard_generate_exam_pool'),
    updated_at = now()
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
AND step_key = 'generate_exam_pool';

-- Step 3: Reset package status from blocked to queued
UPDATE course_packages 
SET status = 'queued', blocked_reason = null, updated_at = now()
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a';

-- Step 4: Log the action
INSERT INTO auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
VALUES ('surgical_repair', 'course_package', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'admin_manual', 'success', 
        'Surgical repair: exam_pool step reset, stale jobs cancelled', 
        '{"reason":"batch_runner_drift_stale_processing_ops_guard_loop","step":"generate_exam_pool"}'::jsonb);
