
-- Priority Gate: Prevents low-priority packages from being claimed
-- when higher-priority packages are still pending/queued/building

-- 1. Function that the pipeline-runner checks before claiming
CREATE OR REPLACE FUNCTION public.get_priority_ceiling()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_active_prio integer;
  v_has_prio_work boolean;
BEGIN
  -- Find the lowest priority tier that still has unfinished work
  SELECT MIN(priority) INTO v_min_active_prio
  FROM course_packages
  WHERE status IN ('queued', 'building', 'blocked')
    AND priority <= 20;

  -- If there are priority packages pending, cap at their tier + buffer
  IF v_min_active_prio IS NOT NULL THEN
    -- Allow the current tier + one tier above (e.g. if Prio 8 exists, allow up to 20)
    RETURN LEAST(v_min_active_prio * 2 + 5, 25);
  END IF;

  -- No priority work left → open the floodgates
  RETURN 9999;
END;
$$;

-- 2. Guard function called by auto_ops_cycle to prevent low-prio claims
CREATE OR REPLACE FUNCTION public.enforce_priority_gate()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ceiling integer;
  v_demoted integer := 0;
BEGIN
  v_ceiling := get_priority_ceiling();
  
  -- If ceiling is restrictive, pause low-priority building packages
  IF v_ceiling < 100 THEN
    UPDATE course_packages
    SET status = 'queued', current_step = 0
    WHERE status = 'building'
      AND priority > v_ceiling
      AND build_progress < 10;  -- Don't interrupt packages with real progress
    
    GET DIAGNOSTICS v_demoted = ROW_COUNT;
    
    -- Cancel their pending jobs
    IF v_demoted > 0 THEN
      UPDATE job_queue
      SET status = 'cancelled', error = 'PRIORITY_GATE: ceiling=' || v_ceiling
      WHERE status IN ('pending', 'enqueued')
        AND priority > v_ceiling;
      
      INSERT INTO escalation_log (action_type, target, detail, level)
      VALUES ('priority_gate', 'pipeline', 
              'Demoted ' || v_demoted || ' packages, ceiling=' || v_ceiling, 1);
    END IF;
  END IF;
END;
$$;

-- 3. Integrate into auto_ops_cycle
CREATE OR REPLACE FUNCTION public.auto_ops_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retried integer := 0;
  v_recovered integer := 0;
  v_orphans integer := 0;
  v_cleaned integer := 0;
  v_priority_ceiling integer;
BEGIN
  -- ── Priority Gate (NEW) ──
  PERFORM enforce_priority_gate();
  v_priority_ceiling := get_priority_ceiling();

  -- ── Retry failed jobs (max_attempts not exhausted) ──
  UPDATE job_queue
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      error = COALESCE(error, '') || ' | AUTO_RETRY',
      run_after = now() + interval '30 seconds'
  WHERE status = 'failed'
    AND attempts < max_attempts
    AND priority <= v_priority_ceiling
    AND updated_at < now() - interval '2 minutes';
  GET DIAGNOSTICS v_retried = ROW_COUNT;

  -- ── Recover stuck processing jobs (>10 min) ──
  UPDATE job_queue
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      error = COALESCE(error, '') || ' | STUCK_RECOVER',
      run_after = now() + interval '1 minute'
  WHERE status = 'processing'
    AND locked_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_recovered = ROW_COUNT;

  -- ── Orphan package recovery ──
  UPDATE course_packages
  SET status = 'queued', current_step = 0
  WHERE status = 'building'
    AND updated_at < now() - interval '30 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.status IN ('pending', 'processing', 'enqueued')
        AND jq.payload::text LIKE '%' || course_packages.id::text || '%'
    );
  GET DIAGNOSTICS v_orphans = ROW_COUNT;

  -- ── Cleanup old completed jobs (>7 days) ──
  DELETE FROM job_queue
  WHERE status IN ('completed', 'cancelled')
    AND completed_at < now() - interval '7 days';
  GET DIAGNOSTICS v_cleaned = ROW_COUNT;

  -- ── Auto-unblock packages with valid curricula ──
  UPDATE course_packages cp
  SET status = 'queued'
  WHERE cp.status = 'blocked'
    AND cp.priority <= v_priority_ceiling
    AND EXISTS (
      SELECT 1 FROM curricula c
      WHERE c.id = cp.curriculum_id
        AND c.status = 'frozen'
        AND EXISTS (SELECT 1 FROM learning_fields lf WHERE lf.curriculum_id = c.id)
    );

  RETURN jsonb_build_object(
    'retried', v_retried,
    'recovered', v_recovered,
    'orphans', v_orphans,
    'cleaned', v_cleaned,
    'priority_ceiling', v_priority_ceiling,
    'ts', now()
  );
END;
$$;
