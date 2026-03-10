
-- ═══════════════════════════════════════════════════════════════════
-- FORENSIC FIX #2: Kill zombie job 54bc713a (still processing)
-- Evidence: Job stuck on Anthropic ops_empty_response since 19:17
-- Previous cancel attempt failed because job transitioned to processing
-- before migration executed. Now force-cancel + release lease.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Force-cancel the zombie job regardless of current status
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'forensic_fix_v2: zombie_processing_anthropic_loop — force_cancel'
WHERE id = '54bc713a-dc27-4df2-acc7-7414d4469226';

-- 2) Release the lease so pipeline-runner can re-claim
DELETE FROM package_leases
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04';

-- 3) Ensure step is queued for fresh dispatch
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb),
      '{forensic_fix_v2}',
      '"zombie_job_kill_2026-03-10T20:52"'
    )
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_learning_content';
