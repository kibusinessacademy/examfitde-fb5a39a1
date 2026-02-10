
-- =============================================================
-- Production Gate 1: Hard Seal Constraints
-- =============================================================

-- Prevent any mutation on sealed courses (lessons, modules)
CREATE OR REPLACE FUNCTION public.guard_sealed_course()
RETURNS TRIGGER AS $$
DECLARE
  v_course_status text;
  v_autopilot_status text;
BEGIN
  -- For lessons, check via module → course
  IF TG_TABLE_NAME = 'lessons' THEN
    SELECT c.status, c.autopilot_status 
    INTO v_course_status, v_autopilot_status
    FROM courses c
    JOIN modules m ON m.course_id = c.id
    WHERE m.id = COALESCE(NEW.module_id, OLD.module_id);
  -- For modules, check via course directly
  ELSIF TG_TABLE_NAME = 'modules' THEN
    SELECT c.status, c.autopilot_status
    INTO v_course_status, v_autopilot_status
    FROM courses c
    WHERE c.id = COALESCE(NEW.course_id, OLD.course_id);
  END IF;

  IF v_autopilot_status = 'sealed' THEN
    RAISE EXCEPTION 'SEALED_COURSE: Kurs ist versiegelt. Keine Änderungen erlaubt. Bitte erstellen Sie eine neue Version.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Apply guard to lessons
DROP TRIGGER IF EXISTS guard_sealed_lessons ON public.lessons;
CREATE TRIGGER guard_sealed_lessons
  BEFORE UPDATE OR DELETE ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_course();

-- Apply guard to modules
DROP TRIGGER IF EXISTS guard_sealed_modules ON public.modules;
CREATE TRIGGER guard_sealed_modules
  BEFORE UPDATE OR DELETE ON public.modules
  FOR EACH ROW EXECUTE FUNCTION public.guard_sealed_course();

-- Prevent re-finalization: course can only be sealed once
CREATE OR REPLACE FUNCTION public.guard_course_reseal()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.autopilot_status = 'sealed' AND NEW.autopilot_status IS DISTINCT FROM 'sealed' THEN
    RAISE EXCEPTION 'SEALED_COURSE: Ein versiegelter Kurs kann nicht zurückgesetzt werden.';
  END IF;
  
  -- Prevent parallel AutoPilot starts
  IF NEW.autopilot_status = 'generating' AND OLD.autopilot_status = 'generating' THEN
    RAISE EXCEPTION 'PARALLEL_AUTOPILOT: AutoPilot läuft bereits für diesen Kurs.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS guard_course_reseal ON public.courses;
CREATE TRIGGER guard_course_reseal
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.guard_course_reseal();

-- Prevent publish/SEO actions on non-sealed courses
CREATE OR REPLACE FUNCTION public.guard_publish_requires_seal()
RETURNS TRIGGER AS $$
DECLARE
  v_autopilot_status text;
BEGIN
  IF NEW.status = 'published' AND (OLD.status IS DISTINCT FROM 'published') THEN
    SELECT autopilot_status INTO v_autopilot_status
    FROM courses WHERE id = NEW.id;
    
    IF v_autopilot_status IS NULL OR v_autopilot_status != 'sealed' THEN
      RAISE EXCEPTION 'PUBLISH_GATE: Kurs muss vor Veröffentlichung versiegelt (sealed) sein.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS guard_publish_requires_seal ON public.courses;
CREATE TRIGGER guard_publish_requires_seal
  BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.guard_publish_requires_seal();

-- =============================================================
-- Production Gate 2: Recovery Worker - enhanced job_maintenance
-- =============================================================

-- Enhanced job recovery function with safe-state detection
CREATE OR REPLACE FUNCTION public.job_recovery_worker()
RETURNS jsonb AS $$
DECLARE
  v_recovered int := 0;
  v_abandoned int := 0;
  v_stuck_jobs record;
  v_backoff_seconds int;
  v_error_class text;
BEGIN
  -- 1) Recover stuck processing jobs (locked > 10 min without progress)
  FOR v_stuck_jobs IN
    SELECT id, job_type, attempts, max_attempts, last_error, locked_at
    FROM job_queue
    WHERE status = 'processing'
      AND locked_at < (now() - interval '10 minutes')
  LOOP
    -- Classify the error
    IF v_stuck_jobs.last_error IS NOT NULL AND (
      v_stuck_jobs.last_error ILIKE '%SSOT%' OR
      v_stuck_jobs.last_error ILIKE '%not found%' OR
      v_stuck_jobs.last_error ILIKE '%INVALID_PAYLOAD%'
    ) THEN
      v_error_class := 'logical';
    ELSE
      v_error_class := 'technical';
    END IF;

    IF v_error_class = 'logical' OR v_stuck_jobs.attempts >= v_stuck_jobs.max_attempts THEN
      -- Permanent failure - move to failed
      UPDATE job_queue SET
        status = 'failed',
        error = COALESCE(last_error, 'Stuck job abandoned after ' || v_stuck_jobs.attempts || ' attempts'),
        completed_at = now(),
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
      WHERE id = v_stuck_jobs.id;
      v_abandoned := v_abandoned + 1;
    ELSE
      -- Technical error - retry with backoff
      v_backoff_seconds := 60 * power(2, v_stuck_jobs.attempts);
      UPDATE job_queue SET
        status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        run_after = now() + (v_backoff_seconds || ' seconds')::interval,
        last_error = 'Auto-recovered by recovery worker. Previous: ' || COALESCE(v_stuck_jobs.last_error, 'timeout'),
        updated_at = now()
      WHERE id = v_stuck_jobs.id;
      v_recovered := v_recovered + 1;
    END IF;
  END LOOP;

  -- 2) Clean up orphaned pipeline jobs (pipeline peer completed but this one stuck)
  UPDATE job_queue SET
    status = 'cancelled',
    error = 'Pipeline peer failed - cascade cancel',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now()
  WHERE status = 'pending'
    AND payload->>'pipeline_order' IS NOT NULL
    AND (payload->>'curriculum_id') IN (
      SELECT payload->>'curriculum_id' 
      FROM job_queue 
      WHERE status = 'failed' 
        AND payload->>'pipeline_order' IS NOT NULL
        AND created_at > now() - interval '24 hours'
    );

  RETURN jsonb_build_object(
    'recovered', v_recovered,
    'abandoned', v_abandoned,
    'run_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Schedule recovery worker every 5 minutes via pg_cron (if available)
-- Note: pg_cron scheduling is handled externally

-- =============================================================
-- Production Gate 3: Ops Dashboard support views
-- =============================================================

-- View for operations monitoring
CREATE OR REPLACE VIEW public.ops_job_summary AS
SELECT 
  status,
  count(*) as job_count,
  avg(EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - created_at))) as avg_duration_seconds,
  max(created_at) as latest_created,
  count(*) FILTER (WHERE created_at > now() - interval '1 hour') as last_hour,
  count(*) FILTER (WHERE created_at > now() - interval '24 hours') as last_24h
FROM job_queue
GROUP BY status;

-- View for cost tracking
CREATE OR REPLACE VIEW public.ops_cost_summary AS
SELECT 
  date_trunc('day', created_at)::date as day,
  job_type,
  sum(cost_eur) as total_cost,
  sum(tokens_used) as total_tokens,
  count(*) as runs,
  sum(errors) as errors
FROM ai_worker_usage_daily
WHERE date >= (current_date - interval '30 days')
GROUP BY date_trunc('day', created_at)::date, job_type
ORDER BY day DESC;
