-- ============================================================
-- 1) JOB STATUS TRANSITIONS AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS public.job_status_transitions (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL,
  job_type TEXT,
  package_id UUID,
  old_status TEXT,
  new_status TEXT NOT NULL,
  error_class TEXT,
  reason TEXT,
  trigger_source TEXT NOT NULL DEFAULT 'unknown',
  attempts INTEGER,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jst_job_id ON public.job_status_transitions(job_id);
CREATE INDEX IF NOT EXISTS idx_jst_created_at ON public.job_status_transitions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jst_package_id ON public.job_status_transitions(package_id) WHERE package_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jst_error_class ON public.job_status_transitions(error_class) WHERE error_class IS NOT NULL;

ALTER TABLE public.job_status_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read job transitions" ON public.job_status_transitions;
CREATE POLICY "admins read job transitions"
  ON public.job_status_transitions
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.job_status_transitions FROM anon, PUBLIC;
GRANT SELECT ON public.job_status_transitions TO authenticated;

-- ============================================================
-- 2) ERROR CLASSIFIER
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_classify_job_error(_err TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _err IS NULL OR _err = '' THEN NULL
    WHEN _err ~ 'STALE_LOCK_LOOP_HARD_KILL' THEN 'STALE_LOCK_LOOP_HARD_KILL'
    WHEN _err ~ 'HARD_FAIL_NO_CURRICULUM|HARD_FAIL_NO_CURR' THEN 'HARD_FAIL_NO_CURRICULUM'
    WHEN _err ~ 'HARD_FAIL_NO_BLUEPRINTS|HARD_FAIL_NO_BLUE' THEN 'HARD_FAIL_NO_BLUEPRINTS'
    WHEN _err ~ 'REPAIR_COMPETENCY_COVERAGE|REPAIR_COMPETENCY' THEN 'REPAIR_COMPETENCY_COVERAGE'
    WHEN _err ~ 'HARD_FAIL_REPAIR_EXHAUSTED' THEN 'HARD_FAIL_REPAIR_EXHAUSTED'
    WHEN _err ~ 'REQUEUE_LOOP_KILLED' THEN 'REQUEUE_LOOP_KILLED'
    WHEN _err ~ 'QUALITY_THRESHOLD_NOT_MET' THEN 'QUALITY_THRESHOLD_NOT_MET'
    WHEN _err ~ 'OPS_GUARD:NON_BUILDING_PACKAGE|NON_BUILDING_PACKAGE' THEN 'NON_BUILDING_PACKAGE'
    WHEN _err ~ 'HARD_FAIL_BREAKER' THEN 'HARD_FAIL_BREAKER'
    WHEN _err ~ 'Watchdog' THEN 'WATCHDOG_RECOVERY'
    WHEN _err ~ 'timeout|timed out' THEN 'TIMEOUT'
    WHEN _err ~ 'rate.?limit' THEN 'RATE_LIMIT'
    ELSE 'OTHER'
  END
$$;

-- ============================================================
-- 3) AUDIT TRIGGER ON job_queue
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_log_job_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _src := COALESCE(
    current_setting('app.transition_source', true),
    CASE
      WHEN current_user = 'service_role' THEN 'service_role'
      WHEN current_user = 'authenticated' THEN 'admin_ui'
      ELSE current_user
    END
  );

  INSERT INTO public.job_status_transitions(
    job_id, job_type, package_id, old_status, new_status,
    error_class, reason, trigger_source, attempts, meta
  ) VALUES (
    NEW.id,
    NEW.job_type,
    NEW.package_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    public.fn_classify_job_error(COALESCE(NEW.last_error, NEW.error)),
    LEFT(COALESCE(NEW.last_error, NEW.error, ''), 500),
    _src,
    NEW.attempts,
    jsonb_build_object(
      'lane', NEW.lane,
      'priority', NEW.priority,
      'run_after', NEW.run_after
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_job_status_transition ON public.job_queue;
CREATE TRIGGER trg_log_job_status_transition
  AFTER INSERT OR UPDATE OF status
  ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_log_job_status_transition();

-- ============================================================
-- 4) ROOT-CAUSE DASHBOARD VIEW
-- ============================================================
DROP VIEW IF EXISTS public.v_failed_jobs_root_causes;
CREATE VIEW public.v_failed_jobs_root_causes
WITH (security_invoker = true)
AS
SELECT
  COALESCE(public.fn_classify_job_error(COALESCE(last_error, error)), 'UNCLASSIFIED') AS error_class,
  job_type,
  COUNT(*)::int AS failed_jobs,
  COUNT(DISTINCT package_id)::int AS affected_packages,
  MAX(updated_at) AS last_run_at,
  MIN(updated_at) AS first_seen_at,
  AVG(attempts)::numeric(10,2) AS avg_attempts,
  MAX(attempts) AS max_attempts_seen,
  array_agg(DISTINCT package_id) FILTER (WHERE package_id IS NOT NULL) AS package_ids,
  (array_agg(LEFT(COALESCE(last_error, error, ''), 200) ORDER BY updated_at DESC))[1] AS sample_error
FROM public.job_queue
WHERE status = 'failed'
GROUP BY error_class, job_type
ORDER BY failed_jobs DESC;

REVOKE ALL ON public.v_failed_jobs_root_causes FROM anon, PUBLIC;
GRANT SELECT ON public.v_failed_jobs_root_causes TO authenticated;

-- ============================================================
-- 5) AUTO-RETRY POLICY FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_auto_retry_failed_jobs(_limit INTEGER DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _retried INT := 0;
  _skipped_terminal INT := 0;
  _skipped_dup INT := 0;
  _by_class JSONB := '{}'::jsonb;
  _row RECORD;
  _class TEXT;
  _cooldown_sec INT;
  _max_retry INT;
BEGIN
  PERFORM set_config('app.transition_source', 'auto_retry_policy', true);

  FOR _row IN
    SELECT id, job_type, package_id, attempts, last_error, error, lane, priority, payload, meta
    FROM public.job_queue
    WHERE status = 'failed'
    ORDER BY updated_at DESC
    LIMIT _limit
  LOOP
    _class := public.fn_classify_job_error(COALESCE(_row.last_error, _row.error));

    -- Policy table: cooldown_sec, max_retry
    CASE _class
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN _cooldown_sec := 300; _max_retry := 8;
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN _cooldown_sec := 180; _max_retry := 6;
      WHEN 'NON_BUILDING_PACKAGE' THEN _cooldown_sec := 30; _max_retry := 5;
      WHEN 'WATCHDOG_RECOVERY' THEN _cooldown_sec := 60; _max_retry := 5;
      WHEN 'TIMEOUT' THEN _cooldown_sec := 90; _max_retry := 6;
      WHEN 'RATE_LIMIT' THEN _cooldown_sec := 240; _max_retry := 10;
      WHEN 'QUALITY_THRESHOLD_NOT_MET' THEN _cooldown_sec := 600; _max_retry := 4;
      -- Terminal classes: skip
      WHEN 'HARD_FAIL_NO_CURRICULUM' THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE;
      WHEN 'HARD_FAIL_NO_BLUEPRINTS' THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE;
      WHEN 'HARD_FAIL_REPAIR_EXHAUSTED' THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE;
      WHEN 'HARD_FAIL_BREAKER' THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE;
      WHEN 'REQUEUE_LOOP_KILLED' THEN
        IF _row.attempts >= 2 THEN
          _skipped_terminal := _skipped_terminal + 1; CONTINUE;
        END IF;
        _cooldown_sec := 600; _max_retry := 3;
      ELSE _cooldown_sec := 120; _max_retry := 5;
    END CASE;

    -- Respect per-class max
    IF _row.attempts >= _max_retry THEN
      _skipped_terminal := _skipped_terminal + 1;
      CONTINUE;
    END IF;

    -- Skip if duplicate active job exists for same package_id+job_type
    IF _row.package_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.job_queue
      WHERE package_id = _row.package_id
        AND job_type = _row.job_type
        AND status IN ('pending', 'processing')
    ) THEN
      -- Cancel the failed duplicate
      UPDATE public.job_queue
        SET status = 'cancelled',
            updated_at = now(),
            last_error = COALESCE(last_error, error) || ' [auto_retry: superseded by active job]'
        WHERE id = _row.id;
      _skipped_dup := _skipped_dup + 1;
      CONTINUE;
    END IF;

    -- Transition failed -> pending with cooldown
    UPDATE public.job_queue
      SET status = 'pending',
          run_after = now() + (_cooldown_sec || ' seconds')::interval,
          locked_at = NULL,
          locked_by = NULL,
          started_at = NULL,
          completed_at = NULL,
          last_heartbeat_at = NULL,
          liveness_status = NULL,
          updated_at = now(),
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'auto_retry_at', now(),
            'auto_retry_class', _class,
            'auto_retry_attempt', COALESCE(_row.attempts, 0) + 1
          )
      WHERE id = _row.id
        AND status = 'failed';

    _retried := _retried + 1;
    _by_class := jsonb_set(
      _by_class,
      ARRAY[COALESCE(_class, 'OTHER')],
      to_jsonb(COALESCE((_by_class ->> COALESCE(_class, 'OTHER'))::int, 0) + 1)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'retried', _retried,
    'skipped_terminal', _skipped_terminal,
    'skipped_duplicate', _skipped_dup,
    'by_class', _by_class,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_retry_failed_jobs(INTEGER) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auto_retry_failed_jobs(INTEGER) TO authenticated, service_role;

-- ============================================================
-- 6) QUEUE HEALTH ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.queue_health_snapshots (
  id BIGSERIAL PRIMARY KEY,
  failed_count INT NOT NULL,
  pending_count INT NOT NULL,
  processing_count INT NOT NULL,
  requeue_loop_count INT NOT NULL DEFAULT 0,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qhs_taken_at ON public.queue_health_snapshots(taken_at DESC);

ALTER TABLE public.queue_health_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read queue snapshots" ON public.queue_health_snapshots;
CREATE POLICY "admins read queue snapshots"
  ON public.queue_health_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
REVOKE ALL ON public.queue_health_snapshots FROM anon, PUBLIC;
GRANT SELECT ON public.queue_health_snapshots TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_check_queue_health_alerts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _failed INT;
  _pending INT;
  _processing INT;
  _requeue_loop INT;
  _prev RECORD;
  _alerts INT := 0;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE status = 'failed'),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'processing'),
    COUNT(*) FILTER (WHERE status = 'failed' AND COALESCE(last_error, error) ~ 'REQUEUE_LOOP_KILLED')
  INTO _failed, _pending, _processing, _requeue_loop
  FROM public.job_queue;

  -- Alert: REQUEUE_LOOP_KILLED cluster (>=3)
  IF _requeue_loop >= 3 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_notifications
      WHERE category = 'queue_health'
        AND title LIKE 'REQUEUE_LOOP_KILLED cluster%'
        AND created_at > now() - interval '1 hour'
    ) THEN
      INSERT INTO public.admin_notifications(category, severity, title, body, metadata)
      VALUES (
        'queue_health',
        'critical',
        'REQUEUE_LOOP_KILLED cluster (' || _requeue_loop || ' jobs)',
        'Deterministische Retry-Loops erkannt. Manuelles Review erforderlich (auto-retry blockiert diese Klasse nach 2 Versuchen).',
        jsonb_build_object('requeue_loop_count', _requeue_loop, 'failed_total', _failed)
      );
      _alerts := _alerts + 1;
    END IF;
  END IF;

  -- Alert: failed-queue stagnation (≥30 min, not decreasing, ≥10 jobs)
  SELECT * INTO _prev
  FROM public.queue_health_snapshots
  WHERE taken_at < now() - interval '30 minutes'
  ORDER BY taken_at DESC
  LIMIT 1;

  IF _prev.failed_count IS NOT NULL
     AND _failed >= 10
     AND _failed >= _prev.failed_count THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_notifications
      WHERE category = 'queue_health'
        AND title LIKE 'Failed-Queue stagniert%'
        AND created_at > now() - interval '1 hour'
    ) THEN
      INSERT INTO public.admin_notifications(category, severity, title, body, metadata)
      VALUES (
        'queue_health',
        'high',
        'Failed-Queue stagniert (' || _failed || ' Jobs, vor 30 Min: ' || _prev.failed_count || ')',
        'Die Failed-Queue baut sich nicht ab. Auto-Retry läuft, aber Jobs bleiben hängen — wahrscheinlich terminale Fehlerklassen oder neuer Inflow.',
        jsonb_build_object('failed_now', _failed, 'failed_30min_ago', _prev.failed_count, 'pending', _pending)
      );
      _alerts := _alerts + 1;
    END IF;
  END IF;

  -- Snapshot
  INSERT INTO public.queue_health_snapshots(failed_count, pending_count, processing_count, requeue_loop_count)
  VALUES (_failed, _pending, _processing, _requeue_loop);

  -- Cleanup old snapshots (keep 7d)
  DELETE FROM public.queue_health_snapshots WHERE taken_at < now() - interval '7 days';

  RETURN jsonb_build_object(
    'failed', _failed,
    'pending', _pending,
    'processing', _processing,
    'requeue_loop', _requeue_loop,
    'alerts_raised', _alerts,
    'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_queue_health_alerts() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_queue_health_alerts() TO authenticated, service_role;

-- ============================================================
-- 7) CRON SCHEDULES
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('auto_retry_failed_jobs');
    PERFORM cron.unschedule('check_queue_health_alerts');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'auto_retry_failed_jobs',
      '*/2 * * * *',
      $cron$ SELECT public.fn_auto_retry_failed_jobs(100); $cron$
    );
    PERFORM cron.schedule(
      'check_queue_health_alerts',
      '*/5 * * * *',
      $cron$ SELECT public.fn_check_queue_health_alerts(); $cron$
    );
  END IF;
END $$;