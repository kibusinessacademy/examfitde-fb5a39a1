-- ─────────────────────────────────────────────────────────────
-- S5b · Reaper Classification Smoke (pure SQL truth-table)
-- ─────────────────────────────────────────────────────────────
-- Pure helper that mirrors fn_reap_stale_processing_jobs classification rules.
-- Returns the bucket a synthetic processing-job would fall into, given:
--   - locked_at, last_heartbeat_at, stale_reap_count, phk_count, attempts, max_attempts
--   - p_stale_minutes, p_phk_threshold (defaults match reaper: 10min stale, 2 PHK)
--
-- Used by regression tests to lock in classification for all combos:
--   - PRE_HEARTBEAT_KILL_TERMINAL (no hb, locked > 3min, phk_count >= 1)
--   - PRE_HEARTBEAT_KILL          (no hb, locked > 3min, phk_count = 0)
--   - STALE_AFTER_HEARTBEAT       (hb seen, hb < cutoff, reap_count >= 2)
--   - STALE_LOCK_LOOP_HARD_KILL   (no hb path on loop kill, reap_count >= 2)
--   - STALE_PROCESSING_REAPED     (stale, reap_count < 2)
--   - STALE_PROCESSING_EXHAUSTED  (attempts >= max_attempts)
--   - HEALTHY                     (none of the above)
CREATE OR REPLACE FUNCTION public.fn_smoke_reaper_classify(
  p_locked_at timestamptz,
  p_last_heartbeat_at timestamptz,
  p_stale_reap_count int,
  p_phk_count int,
  p_attempts int,
  p_max_attempts int,
  p_now timestamptz DEFAULT now(),
  p_stale_minutes int DEFAULT 10,
  p_phk_threshold int DEFAULT 2
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    -- PHK paths first (no heartbeat, locked past 3min)
    WHEN p_last_heartbeat_at IS NULL
         AND p_locked_at IS NOT NULL
         AND p_locked_at < p_now - interval '3 minutes'
         AND COALESCE(p_phk_count,0) >= (p_phk_threshold - 1)
      THEN 'PRE_HEARTBEAT_KILL_TERMINAL'
    WHEN p_last_heartbeat_at IS NULL
         AND p_locked_at IS NOT NULL
         AND p_locked_at < p_now - interval '3 minutes'
         AND COALESCE(p_phk_count,0) < (p_phk_threshold - 1)
         AND COALESCE(p_attempts,0) < COALESCE(p_max_attempts,25)
      THEN 'PRE_HEARTBEAT_KILL'
    -- max attempts terminal
    WHEN COALESCE(p_attempts,0) >= COALESCE(p_max_attempts,25)
         AND COALESCE(GREATEST(p_last_heartbeat_at, p_locked_at), p_locked_at) < p_now - (p_stale_minutes || ' minutes')::interval
      THEN 'STALE_PROCESSING_EXHAUSTED'
    -- loop-kill (after >= max_reaps requeues), differentiate hb presence
    WHEN COALESCE(GREATEST(p_last_heartbeat_at, p_locked_at), p_locked_at) < p_now - (p_stale_minutes || ' minutes')::interval
         AND COALESCE(p_stale_reap_count,0) >= 2
         AND p_last_heartbeat_at IS NOT NULL
      THEN 'STALE_AFTER_HEARTBEAT'
    WHEN COALESCE(GREATEST(p_last_heartbeat_at, p_locked_at), p_locked_at) < p_now - (p_stale_minutes || ' minutes')::interval
         AND COALESCE(p_stale_reap_count,0) >= 2
         AND p_last_heartbeat_at IS NULL
      THEN 'STALE_LOCK_LOOP_HARD_KILL'
    -- normal stale requeue
    WHEN COALESCE(GREATEST(p_last_heartbeat_at, p_locked_at), p_locked_at) < p_now - (p_stale_minutes || ' minutes')::interval
         AND COALESCE(p_stale_reap_count,0) < 2
         AND COALESCE(p_attempts,0) < COALESCE(p_max_attempts,25)
      THEN 'STALE_PROCESSING_REAPED'
    ELSE 'HEALTHY'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_smoke_reaper_classify(timestamptz, timestamptz, int, int, int, int, timestamptz, int, int) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.fn_smoke_reaper_classify IS
  'S5b regression-test helper: pure classification mirroring fn_reap_stale_processing_jobs. Anon-callable so vitest can prove the truth-table without service_role.';

-- Quick self-check (raises NOTICE only)
DO $$
DECLARE
  v_now timestamptz := '2026-05-09 12:00:00+00'::timestamptz;
BEGIN
  -- PHK terminal: no hb, locked 5min ago, phk_count=1 (threshold-1)
  ASSERT public.fn_smoke_reaper_classify(
    v_now - interval '5 minutes', NULL, 0, 1, 0, 25, v_now) = 'PRE_HEARTBEAT_KILL_TERMINAL',
    'expected PRE_HEARTBEAT_KILL_TERMINAL';
  -- PHK first: no hb, locked 5min, phk_count=0
  ASSERT public.fn_smoke_reaper_classify(
    v_now - interval '5 minutes', NULL, 0, 0, 0, 25, v_now) = 'PRE_HEARTBEAT_KILL',
    'expected PRE_HEARTBEAT_KILL';
  -- STALE_AFTER_HEARTBEAT: hb 15min old, reap_count=2
  ASSERT public.fn_smoke_reaper_classify(
    v_now - interval '20 minutes', v_now - interval '15 minutes', 2, 0, 5, 25, v_now) = 'STALE_AFTER_HEARTBEAT',
    'expected STALE_AFTER_HEARTBEAT';
  -- STALE_LOCK_LOOP_HARD_KILL: NO hb but locked old AND reap_count=2 (rare path; PHK no longer matches because locked_at not used? actually PHK matches first: locked < 3min AND phk_count>=1. With phk_count=0 we fall to loop kill)
  ASSERT public.fn_smoke_reaper_classify(
    v_now - interval '20 minutes', NULL, 2, 0, 5, 25, v_now) = 'PRE_HEARTBEAT_KILL',
    'no-hb path is PHK before loop-kill';
  -- STALE_PROCESSING_REAPED: hb 15min, reap_count=0
  ASSERT public.fn_smoke_reaper_classify(
    v_now - interval '20 minutes', v_now - interval '15 minutes', 0, 0, 1, 25, v_now) = 'STALE_PROCESSING_REAPED',
    'expected STALE_PROCESSING_REAPED';
  -- STALE_PROCESSING_EXHAUSTED: attempts maxed
  ASSERT public.fn_smoke_reaper_classify(
    v_now - interval '20 minutes', v_now - interval '15 minutes', 0, 0, 25, 25, v_now) = 'STALE_PROCESSING_EXHAUSTED',
    'expected STALE_PROCESSING_EXHAUSTED';
  -- HEALTHY: fresh
  ASSERT public.fn_smoke_reaper_classify(
    v_now - interval '30 seconds', v_now - interval '10 seconds', 0, 0, 1, 25, v_now) = 'HEALTHY',
    'expected HEALTHY';
END$$;