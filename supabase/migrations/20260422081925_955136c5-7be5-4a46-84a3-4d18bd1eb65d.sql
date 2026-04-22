-- ============================================================
-- 1) Active-status set helper (single source of truth)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_job_active_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['pending','queued','processing','running','batch_pending']::text[]
$$;

-- ============================================================
-- 2) Hardened audit trigger
--    - fires on status, last_error, error changes
--    - logs only when something relevant changed
--    - trigger_source defaults to 'trigger_unknown' (no role-based lie)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_log_job_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src TEXT;
  _status_changed BOOLEAN;
  _error_changed BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    _status_changed := OLD.status IS DISTINCT FROM NEW.status;
    _error_changed := (OLD.last_error IS DISTINCT FROM NEW.last_error)
                   OR (OLD.error IS DISTINCT FROM NEW.error);
    IF NOT _status_changed AND NOT _error_changed THEN
      RETURN NEW;
    END IF;
  ELSE
    _status_changed := TRUE;
    _error_changed := FALSE;
  END IF;

  -- Honest source: only trust explicit set_config
  _src := COALESCE(
    NULLIF(current_setting('app.transition_source', true), ''),
    'trigger_unknown'
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
      'run_after', NEW.run_after,
      'status_changed', _status_changed,
      'error_changed', _error_changed
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_job_status_transition ON public.job_queue;
CREATE TRIGGER trg_log_job_status_transition
  AFTER INSERT OR UPDATE OF status, last_error, error
  ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_log_job_status_transition();

-- ============================================================
-- 3) Hardened auto-retry: SSOT/causality + active-guard + anti-starvation
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
  _skipped_obsolete INT := 0;
  _skipped_no_package INT := 0;
  _skipped_pkg_status INT := 0;
  _by_class JSONB := '{}'::jsonb;
  _row RECORD;
  _class TEXT;
  _cooldown_sec INT;
  _max_retry INT;
  _pkg_status TEXT;
  _active text[] := public.fn_job_active_statuses();
  _allowed_pkg_status text[] := ARRAY['building','queued','blocked','pending','draft']::text[];
BEGIN
  PERFORM set_config('app.transition_source', 'auto_retry_policy', true);

  FOR _row IN
    SELECT id, job_type, package_id, attempts, last_error, error, lane, priority, payload, meta
    FROM public.job_queue
    WHERE status = 'failed'
    ORDER BY COALESCE(run_after, updated_at) ASC, updated_at ASC  -- anti-starvation
    LIMIT _limit
  LOOP
    _class := public.fn_classify_job_error(COALESCE(_row.last_error, _row.error));

    -- Class-based policy
    CASE _class
      WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN _cooldown_sec := 300; _max_retry := 8;
      WHEN 'REPAIR_COMPETENCY_COVERAGE' THEN _cooldown_sec := 180; _max_retry := 6;
      WHEN 'NON_BUILDING_PACKAGE' THEN _cooldown_sec := 30; _max_retry := 5;
      WHEN 'WATCHDOG_RECOVERY' THEN _cooldown_sec := 60; _max_retry := 5;
      WHEN 'TIMEOUT' THEN _cooldown_sec := 90; _max_retry := 6;
      WHEN 'RATE_LIMIT' THEN _cooldown_sec := 240; _max_retry := 10;
      WHEN 'QUALITY_THRESHOLD_NOT_MET' THEN _cooldown_sec := 600; _max_retry := 4;
      WHEN 'HARD_FAIL_NO_CURRICULUM' THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE;
      WHEN 'HARD_FAIL_NO_BLUEPRINTS' THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE;
      WHEN 'HARD_FAIL_REPAIR_EXHAUSTED' THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE;
      WHEN 'HARD_FAIL_BREAKER' THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE;
      WHEN 'REQUEUE_LOOP_KILLED' THEN
        IF _row.attempts >= 2 THEN _skipped_terminal := _skipped_terminal + 1; CONTINUE; END IF;
        _cooldown_sec := 600; _max_retry := 3;
      ELSE _cooldown_sec := 120; _max_retry := 5;
    END CASE;

    IF _row.attempts >= _max_retry THEN
      _skipped_terminal := _skipped_terminal + 1; CONTINUE;
    END IF;

    -- SSOT Guard A: package-bound jobs need a package
    IF _row.package_id IS NULL AND _row.job_type LIKE 'package_%' THEN
      _skipped_no_package := _skipped_no_package + 1; CONTINUE;
    END IF;

    -- SSOT Guard B: package status must allow build work
    IF _row.package_id IS NOT NULL THEN
      SELECT status INTO _pkg_status FROM public.course_packages WHERE id = _row.package_id;
      IF _pkg_status IS NULL OR NOT (_pkg_status = ANY(_allowed_pkg_status)) THEN
        _skipped_pkg_status := _skipped_pkg_status + 1; CONTINUE;
      END IF;

      -- SSOT Guard C: duplicate / active job already running (broad active set)
      IF EXISTS (
        SELECT 1 FROM public.job_queue
        WHERE package_id = _row.package_id
          AND job_type = _row.job_type
          AND status = ANY(_active)
      ) THEN
        UPDATE public.job_queue
          SET status = 'cancelled',
              updated_at = now(),
              last_error = COALESCE(last_error, error, '') || ' [auto_retry: superseded by active]'
          WHERE id = _row.id;
        _skipped_dup := _skipped_dup + 1; CONTINUE;
      END IF;

      -- SSOT Guard D: newer successful materialization already exists
      IF EXISTS (
        SELECT 1 FROM public.job_queue
        WHERE package_id = _row.package_id
          AND job_type = _row.job_type
          AND status = 'completed'
          AND COALESCE(completed_at, updated_at) > COALESCE(_row.meta->>'auto_retry_at', _row.error)::timestamptz
        LIMIT 1
      ) THEN
        UPDATE public.job_queue
          SET status = 'cancelled',
              updated_at = now(),
              last_error = COALESCE(last_error, error, '') || ' [auto_retry: obsolete, newer success exists]'
          WHERE id = _row.id;
        _skipped_obsolete := _skipped_obsolete + 1; CONTINUE;
      END IF;
    END IF;

    -- Transition failed → pending with cooldown
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
    'skipped_obsolete', _skipped_obsolete,
    'skipped_no_package', _skipped_no_package,
    'skipped_pkg_status', _skipped_pkg_status,
    'by_class', _by_class,
    'ran_at', now()
  );
EXCEPTION WHEN OTHERS THEN
  -- Robust against missing course_packages join; downgrade to terminal-skip
  RETURN jsonb_build_object('error', SQLERRM, 'retried', _retried);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_retry_failed_jobs(INTEGER) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auto_retry_failed_jobs(INTEGER) TO authenticated, service_role;

-- ============================================================
-- 4) Stagnations-Alert mit Snapshot-Overlap
-- ============================================================
CREATE TABLE IF NOT EXISTS public.queue_health_failed_snapshot (
  snapshot_id BIGINT NOT NULL,
  job_id UUID NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_qhfs_taken_at ON public.queue_health_failed_snapshot(taken_at DESC);
ALTER TABLE public.queue_health_failed_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read failed snapshot" ON public.queue_health_failed_snapshot;
CREATE POLICY "admins read failed snapshot" ON public.queue_health_failed_snapshot
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
REVOKE ALL ON public.queue_health_failed_snapshot FROM anon, PUBLIC;
GRANT SELECT ON public.queue_health_failed_snapshot TO authenticated;

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
  _stale_failed INT;
  _overlap INT := 0;
  _prev_snapshot_id BIGINT;
  _new_snapshot_id BIGINT;
  _alerts INT := 0;
  _loop_meta JSONB;
BEGIN
  PERFORM set_config('app.transition_source', 'health_check', true);

  SELECT
    COUNT(*) FILTER (WHERE status = 'failed'),
    COUNT(*) FILTER (WHERE status = 'pending'),
    COUNT(*) FILTER (WHERE status = 'processing'),
    COUNT(*) FILTER (WHERE status = 'failed' AND COALESCE(last_error, error) ~ 'REQUEUE_LOOP_KILLED'),
    COUNT(*) FILTER (WHERE status = 'failed' AND updated_at < now() - interval '30 minutes')
  INTO _failed, _pending, _processing, _requeue_loop, _stale_failed
  FROM public.job_queue;

  -- REQUEUE_LOOP_KILLED enriched alert
  IF _requeue_loop >= 3 THEN
    SELECT jsonb_build_object(
      'requeue_loop_count', _requeue_loop,
      'failed_total', _failed,
      'job_types', (SELECT array_agg(DISTINCT job_type) FROM public.job_queue
                    WHERE status='failed' AND COALESCE(last_error,error) ~ 'REQUEUE_LOOP_KILLED'),
      'package_ids', (SELECT array_agg(DISTINCT package_id) FROM public.job_queue
                      WHERE status='failed' AND COALESCE(last_error,error) ~ 'REQUEUE_LOOP_KILLED'
                        AND package_id IS NOT NULL),
      'sample_errors', (SELECT array_agg(DISTINCT LEFT(COALESCE(last_error,error),120))
                        FROM public.job_queue
                        WHERE status='failed' AND COALESCE(last_error,error) ~ 'REQUEUE_LOOP_KILLED')
    ) INTO _loop_meta;

    IF NOT EXISTS (
      SELECT 1 FROM public.admin_notifications
      WHERE category = 'queue_health' AND title LIKE 'REQUEUE_LOOP_KILLED cluster%'
        AND created_at > now() - interval '1 hour'
    ) THEN
      INSERT INTO public.admin_notifications(category, severity, title, body, metadata)
      VALUES ('queue_health','critical',
        'REQUEUE_LOOP_KILLED cluster (' || _requeue_loop || ' jobs)',
        'Deterministische Retry-Loops erkannt. Manuelles Review erforderlich.',
        _loop_meta);
      _alerts := _alerts + 1;
    END IF;
  END IF;

  -- Take new snapshot
  INSERT INTO public.queue_health_snapshots(failed_count, pending_count, processing_count, requeue_loop_count)
  VALUES (_failed, _pending, _processing, _requeue_loop)
  RETURNING id INTO _new_snapshot_id;

  INSERT INTO public.queue_health_failed_snapshot(snapshot_id, job_id)
  SELECT _new_snapshot_id, id FROM public.job_queue WHERE status='failed';

  -- Find prev snapshot ≥30 min old
  SELECT id INTO _prev_snapshot_id
  FROM public.queue_health_snapshots
  WHERE taken_at < now() - interval '30 minutes' AND id <> _new_snapshot_id
  ORDER BY taken_at DESC LIMIT 1;

  IF _prev_snapshot_id IS NOT NULL THEN
    SELECT COUNT(*) INTO _overlap
    FROM public.queue_health_failed_snapshot a
    JOIN public.queue_health_failed_snapshot b
      ON a.job_id = b.job_id
    WHERE a.snapshot_id = _prev_snapshot_id AND b.snapshot_id = _new_snapshot_id;

    -- Echte Stagnation: ≥10 alte Failed-Jobs UND ≥10 Job-IDs identisch
    IF _stale_failed >= 10 AND _overlap >= 10 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.admin_notifications
        WHERE category='queue_health' AND title LIKE 'Failed-Queue echte Stagnation%'
          AND created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.admin_notifications(category, severity, title, body, metadata)
        VALUES ('queue_health','high',
          'Failed-Queue echte Stagnation (' || _overlap || ' identische Jobs ≥30 Min)',
          _overlap || ' Failed-Jobs sind seit ≥30 Min unverändert hängen geblieben (gleiche job_ids im Snapshot-Vergleich).',
          jsonb_build_object(
            'overlap', _overlap,
            'stale_failed', _stale_failed,
            'failed_now', _failed,
            'prev_snapshot_id', _prev_snapshot_id,
            'new_snapshot_id', _new_snapshot_id
          ));
        _alerts := _alerts + 1;
      END IF;
    END IF;
  END IF;

  -- Cleanup
  DELETE FROM public.queue_health_snapshots WHERE taken_at < now() - interval '7 days';
  DELETE FROM public.queue_health_failed_snapshot WHERE taken_at < now() - interval '7 days';

  RETURN jsonb_build_object(
    'failed', _failed, 'pending', _pending, 'processing', _processing,
    'requeue_loop', _requeue_loop, 'stale_failed', _stale_failed,
    'snapshot_overlap', _overlap, 'alerts_raised', _alerts, 'ran_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_check_queue_health_alerts() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_queue_health_alerts() TO authenticated, service_role;

-- ============================================================
-- 5) Lockdown root-cause view; expose only via admin RPC
-- ============================================================
REVOKE ALL ON public.v_failed_jobs_root_causes FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.v_failed_jobs_root_causes TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_failed_root_causes()
RETURNS SETOF public.v_failed_jobs_root_causes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.v_failed_jobs_root_causes;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_failed_root_causes() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_failed_root_causes() TO authenticated, service_role;

-- ============================================================
-- 6) Admin single-job action RPC (force pending / cancel / mark terminal)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_job_action(
  _job_id UUID,
  _action TEXT,
  _reason TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job RECORD;
  _new_status TEXT;
  _terminal_marker TEXT := '🛑 ADMIN_TERMINAL: ';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _action NOT IN ('force_pending','cancel','mark_terminal') THEN
    RAISE EXCEPTION 'invalid action: %', _action;
  END IF;

  SELECT * INTO _job FROM public.job_queue WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  PERFORM set_config('app.transition_source',
    'admin_ui:' || _action || ':' || COALESCE(auth.uid()::text,'unknown'), true);

  CASE _action
    WHEN 'force_pending' THEN
      UPDATE public.job_queue SET
        status = 'pending',
        run_after = now() + interval '5 seconds',
        locked_at = NULL, locked_by = NULL,
        started_at = NULL, completed_at = NULL,
        last_heartbeat_at = NULL, liveness_status = NULL,
        updated_at = now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'admin_force_pending_at', now(),
          'admin_reason', COALESCE(_reason,'manual'))
      WHERE id = _job_id;
      _new_status := 'pending';

    WHEN 'cancel' THEN
      UPDATE public.job_queue SET
        status = 'cancelled',
        updated_at = now(),
        last_error = COALESCE(last_error, error, '') ||
          ' [admin_cancel: ' || COALESCE(_reason,'no reason') || ']'
      WHERE id = _job_id;
      _new_status := 'cancelled';

    WHEN 'mark_terminal' THEN
      UPDATE public.job_queue SET
        status = 'failed',
        attempts = GREATEST(COALESCE(attempts,0), COALESCE(max_attempts,99)),
        updated_at = now(),
        last_error = _terminal_marker || COALESCE(_reason,'manual review required'),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'admin_marked_terminal_at', now(),
          'admin_reason', COALESCE(_reason,'manual'))
      WHERE id = _job_id;
      _new_status := 'failed';
  END CASE;

  INSERT INTO public.admin_actions(action, scope, affected_ids, payload, user_id)
  VALUES (
    'job_action_' || _action,
    'job_queue',
    ARRAY[_job_id::text],
    jsonb_build_object('reason', _reason, 'old_status', _job.status, 'new_status', _new_status),
    auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'job_id', _job_id,
    'old_status', _job.status, 'new_status', _new_status, 'action', _action);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_job_action(UUID,TEXT,TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_job_action(UUID,TEXT,TEXT) TO authenticated, service_role;