
-- ═══════════════════════════════════════════════════════════════════
-- FORENSIC FIX: Break starvation loop for Verkäufer package
-- Root cause chain proven via logs + DB:
--   1. Scaffold migration added 50 placeholder lessons (K04)
--   2. package_generate_learning_content ran ONCE, set build_progress=100
--      (calculated before K04 scaffolds were visible to its query window)
--   3. Only 1 competency bundle dispatched (LF01-K04)
--   4. Minicheck job 54bc713a stuck on Anthropic ops_empty_response (8/25 transients)
--   5. content-runner holds lease via auto-heal renewal → pipeline-runner CANNOT claim
--   6. STARVATION: 14 free slots, 0 claims, every minute for 12+ minutes
-- ═══════════════════════════════════════════════════════════════════

-- 1) Cancel the stuck minicheck job (will be re-created properly)
UPDATE job_queue
SET status = 'cancelled',
    last_error = 'forensic_fix: anthropic_tool_mode_empty_response_loop — will re-dispatch'
WHERE id = '54bc713a-dc27-4df2-acc7-7414d4469226'
  AND status IN ('pending', 'processing');

-- 2) Release the stale lease so pipeline-runner can claim
DELETE FROM package_leases
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04';

-- 3) Fix build_progress to reflect actual artifact truth
-- 200 total lessons, 46 hollow = 77% real content
UPDATE course_packages
SET build_progress = 77,
    integrity_passed = false,
    updated_at = now()
WHERE id = '59b6e214-e181-4c2b-986e-1ce544984d04';

-- 4) Reset generate_learning_content step to allow fresh dispatch
UPDATE package_steps
SET status = 'queued',
    attempts = 0,
    last_error = NULL,
    meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb),
      '{forensic_reset}',
      '"starvation_loop_fix_2026-03-10T19:30"'
    )
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_learning_content';
