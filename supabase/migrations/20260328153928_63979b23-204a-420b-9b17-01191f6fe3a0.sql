-- ══════════════════════════════════════════════════════════════
-- FIX 1: ops_processing_stale RLS leak — REVOKE anon/authenticated
-- ══════════════════════════════════════════════════════════════
REVOKE ALL ON public.ops_processing_stale FROM anon;
REVOKE ALL ON public.ops_processing_stale FROM authenticated;

-- Also lock down other sensitive ops views that may have the same leak
REVOKE ALL ON public.ops_prereq_guard_cancelled FROM anon;
REVOKE ALL ON public.ops_prereq_guard_cancelled FROM authenticated;

-- ══════════════════════════════════════════════════════════════
-- FIX 2: Clean up the false-cancelled prereq job
-- Update from cancelled → failed so auto-heal can retry it properly
-- ══════════════════════════════════════════════════════════════
UPDATE public.job_queue
SET status = 'failed',
    error = 'PREREQ_NOT_MET:elite_harden (cleaned from cancelled→failed for auto-heal)',
    updated_at = now()
WHERE id = 'e43b2226-4451-4ab9-b7f8-e6d243cf0678'
  AND status = 'cancelled';

-- ══════════════════════════════════════════════════════════════
-- PREVENTION: Update auto_heal_prereq_retry_cap_failures to use
-- 'failed' instead of implicitly leaving jobs in cancelled state.
-- The RPC already sets status='pending', so this is just defensive.
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.auto_heal_prereq_retry_cap_failures(p_limit int DEFAULT 50)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH candidates AS (
    SELECT j.id
    FROM public.job_queue j
    WHERE j.status IN ('failed', 'cancelled')
      AND j.error ILIKE '%PREREQ%'
      AND (j.payload ? 'package_id')
    ORDER BY j.updated_at DESC
    LIMIT p_limit
  )
  UPDATE public.job_queue j
  SET status = 'pending',
      attempts = 0,
      locked_at = NULL,
      locked_by = NULL,
      run_after = now() + interval '2 minutes',
      error = COALESCE(j.error, '') || ' | AUTO_HEALED_FROM_PREREQ',
      updated_at = now()
  FROM candidates c
  WHERE j.id = c.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;