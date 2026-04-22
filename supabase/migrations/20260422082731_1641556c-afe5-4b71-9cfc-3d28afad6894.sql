-- ═══════════════════════════════════════════════════════════════
-- WAVE-3 HARDENING: Auto-Retry, Admin-Actions, Decision-Trace, Rate-Limit
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Audit-Trigger erweitern: status, last_error, error ──────
DROP TRIGGER IF EXISTS trg_log_job_status_transition ON public.job_queue;

CREATE OR REPLACE FUNCTION public.fn_log_job_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _src text;
  _changed_status   boolean := COALESCE(NEW.status,'') IS DISTINCT FROM COALESCE(OLD.status,'');
  _changed_error    boolean := COALESCE(NEW.last_error,'') IS DISTINCT FROM COALESCE(OLD.last_error,'')
                            OR COALESCE(NEW.error,'')      IS DISTINCT FROM COALESCE(OLD.error,'');
  _change_kind text;
BEGIN
  -- Honest source: explicit set_config wins, fallback trigger_unknown
  BEGIN
    _src := NULLIF(current_setting('app.transition_source', true), '');
  EXCEPTION WHEN OTHERS THEN
    _src := NULL;
  END;
  _src := COALESCE(_src, 'trigger_unknown');

  -- Only log when something relevant actually changed
  IF TG_OP = 'INSERT' THEN
    _change_kind := 'insert';
  ELSIF _changed_status AND _changed_error THEN
    _change_kind := 'status+error';
  ELSIF _changed_status THEN
    _change_kind := 'status';
  ELSIF _changed_error THEN
    _change_kind := 'error_only';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.job_status_transitions (
    job_id, job_type, package_id, old_status, new_status,
    error_class, last_error, reason, trigger_source, attempts,
    meta_diff, change_kind
  ) VALUES (
    NEW.id, NEW.job_type, NEW.package_id,
    CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    public.fn_classify_job_error(COALESCE(NEW.last_error, NEW.error)),
    LEFT(COALESCE(NEW.last_error, NEW.error, ''), 500),
    NULL,
    _src,
    NEW.attempts,
    jsonb_build_object(
      'old_last_error', LEFT(COALESCE(OLD.last_error,''), 200),
      'new_last_error', LEFT(COALESCE(NEW.last_error,''), 200),
      'old_error',      LEFT(COALESCE(OLD.error,''), 200),
      'new_error',      LEFT(COALESCE(NEW.error,''), 200),
      'old_meta',       COALESCE(OLD.meta,'{}'::jsonb),
      'new_meta',       COALESCE(NEW.meta,'{}'::jsonb)
    ),
    _change_kind
  );
  RETURN NEW;
END $$;

-- Add columns for diff & change kind if missing
ALTER TABLE public.job_status_transitions
  ADD COLUMN IF NOT EXISTS meta_diff jsonb,
  ADD COLUMN IF NOT EXISTS change_kind text,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE TRIGGER trg_log_job_status_transition
AFTER INSERT OR UPDATE OF status, last_error, error
ON public.job_queue
FOR EACH ROW EXECUTE FUNCTION public.fn_log_job_status_transition();

-- ── 2. Decision-Trace Storage ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_retry_decisions (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  decision text NOT NULL,           -- retry | skip_terminal | skip_duplicate | skip_obsolete | skip_admin_terminal | skip_no_package | skip_pkg_status | skip_max_retry
  error_class text,
  package_id uuid,
  package_status text,
  attempts int,
  cooldown_seconds int,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {has_package: true, pkg_status_ok: true, no_duplicate: true, no_newer_success: true, not_admin_terminal: true}
  reason text
);
CREATE INDEX IF NOT EXISTS idx_job_retry_decisions_job ON public.job_retry_decisions(job_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_retry_decisions_pkg ON public.job_retry_decisions(package_id, decided_at DESC);
ALTER TABLE public.job_retry_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_retry_dec_admin ON public.job_retry_decisions;
CREATE POLICY p_retry_dec_admin ON public.job_retry_decisions FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- ── 3. Auto-Retry härten: per-row exception, ASC, safe obsolete ─
CREATE OR REPLACE FUNCTION public.fn_auto_retry_failed_jobs(_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _row record;
  _retried int := 0;
  _skipped_terminal int := 0;
  _skipped_duplicate int := 0;
  _skipped_obsolete int := 0;
  _skipped_admin_terminal int := 0;
  _skipped_no_package int := 0;
  _skipped_pkg_status int := 0;
  _skipped_max_retry int := 0;
  _row_errors int := 0;
  _error_class text;
  _cooldown int;
  _max_retry int;
  _checks jsonb;
  _has_package boolean;
  _pkg_status_ok boolean;
  _no_duplicate boolean;
  _no_newer_success boolean;
  _not_admin_terminal boolean;
  _pkg_status text;
  _is_pkg_bound boolean;
  _last_at timestamptz;
  _decision text;
  _active_set text[] := public.fn_job_active_statuses();
  _allowed_pkg_status text[] := ARRAY['building','queued','blocked','pending','draft'];
BEGIN
  PERFORM set_config('app.transition_source', 'auto_retry_policy', true);

  -- Anti-Starvation: oldest first, run_after honored
  FOR _row IN
    SELECT *
    FROM public.job_queue
    WHERE status = 'failed'
      AND (run_after IS NULL OR run_after <= now())
    ORDER BY COALESCE(run_after, updated_at, created_at) ASC
    LIMIT _limit
  LOOP
    BEGIN
      _error_class := public.fn_classify_job_error(COALESCE(_row.last_error, _row.error));

      -- Admin-Terminal Marker hat absolute Priorität
      _not_admin_terminal := COALESCE(_row.meta->>'admin_terminal','false') <> 'true';
      IF NOT _not_admin_terminal THEN
        _skipped_admin_terminal := _skipped_admin_terminal + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_admin_terminal', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('not_admin_terminal', false), 'admin marked terminal');
        CONTINUE;
      END IF;

      -- Terminal classes: hard skip
      IF _error_class IN ('HARD_FAIL_NO_CURRICULUM','HARD_FAIL_NO_BLUEPRINTS',
                           'HARD_FAIL_REPAIR_EXHAUSTED','HARD_FAIL_BREAKER','REQUEUE_LOOP_KILLED') THEN
        _skipped_terminal := _skipped_terminal + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_terminal', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('terminal_class', true), _error_class);
        CONTINUE;
      END IF;

      -- Per error-class cooldown & cap
      CASE _error_class
        WHEN 'STALE_LOCK_LOOP_HARD_KILL' THEN _cooldown := 300; _max_retry := 8;
        WHEN 'TIMEOUT'                   THEN _cooldown := 90;  _max_retry := 6;
        WHEN 'QUALITY_THRESHOLD_NOT_MET' THEN _cooldown := 600; _max_retry := 4;
        WHEN 'OPS_GUARD_NON_BUILDING'    THEN _cooldown := 180; _max_retry := 5;
        WHEN 'NETWORK_ERROR'             THEN _cooldown := 60;  _max_retry := 8;
        ELSE _cooldown := 120; _max_retry := 5;
      END CASE;

      IF COALESCE(_row.attempts,0) >= _max_retry THEN
        _skipped_max_retry := _skipped_max_retry + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_max_retry', _error_class, _row.package_id, _row.attempts,
                jsonb_build_object('attempts_le_max', false), format('attempts %s >= cap %s', _row.attempts, _max_retry));
        CONTINUE;
      END IF;

      -- SSOT: package-bound jobs need package_id
      _is_pkg_bound := _row.job_type LIKE 'package_%';
      _has_package := (_row.package_id IS NOT NULL);
      IF _is_pkg_bound AND NOT _has_package THEN
        _skipped_no_package := _skipped_no_package + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
        VALUES (_row.id, 'skip_no_package', _error_class, NULL, _row.attempts,
                jsonb_build_object('has_package', false), 'package-bound job missing package_id');
        CONTINUE;
      END IF;

      -- Package status guard
      _pkg_status := NULL;
      _pkg_status_ok := true;
      IF _has_package THEN
        SELECT status INTO _pkg_status FROM public.course_packages WHERE id = _row.package_id;
        _pkg_status_ok := _pkg_status = ANY(_allowed_pkg_status);
        IF NOT _pkg_status_ok THEN
          _skipped_pkg_status := _skipped_pkg_status + 1;
          INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, package_status, attempts, checks, reason)
          VALUES (_row.id, 'skip_pkg_status', _error_class, _row.package_id, _pkg_status, _row.attempts,
                  jsonb_build_object('pkg_status_ok', false), format('package status %s not in allowlist', _pkg_status));
          CONTINUE;
        END IF;
      END IF;

      -- Duplicate guard via SSOT active set
      _no_duplicate := NOT EXISTS (
        SELECT 1 FROM public.job_queue q
        WHERE q.job_type = _row.job_type
          AND q.package_id IS NOT DISTINCT FROM _row.package_id
          AND q.status = ANY(_active_set)
          AND q.id <> _row.id
      );
      IF NOT _no_duplicate THEN
        _skipped_duplicate := _skipped_duplicate + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, package_status, attempts, checks, reason)
        VALUES (_row.id, 'skip_duplicate', _error_class, _row.package_id, _pkg_status, _row.attempts,
                jsonb_build_object('no_duplicate', false), 'active duplicate exists');
        CONTINUE;
      END IF;

      -- Newer successful materialization?
      _no_newer_success := NOT EXISTS (
        SELECT 1 FROM public.job_queue q
        WHERE q.job_type = _row.job_type
          AND q.package_id IS NOT DISTINCT FROM _row.package_id
          AND q.status = 'completed'
          AND q.updated_at > _row.updated_at
      );
      IF NOT _no_newer_success THEN
        _skipped_obsolete := _skipped_obsolete + 1;
        INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, package_status, attempts, checks, reason)
        VALUES (_row.id, 'skip_obsolete', _error_class, _row.package_id, _pkg_status, _row.attempts,
                jsonb_build_object('no_newer_success', false), 'newer completed job exists');
        CONTINUE;
      END IF;

      -- All checks pass → retry
      _checks := jsonb_build_object(
        'not_admin_terminal', true,
        'has_package', _has_package OR NOT _is_pkg_bound,
        'pkg_status_ok', _pkg_status_ok,
        'attempts_le_max', true,
        'no_duplicate', true,
        'no_newer_success', true
      );

      UPDATE public.job_queue SET
        status = 'pending',
        run_after = now() + (_cooldown || ' seconds')::interval,
        last_error = NULL,
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'auto_retry_at', now(),
          'auto_retry_class', _error_class,
          'auto_retry_cooldown', _cooldown
        )
      WHERE id = _row.id;

      INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, package_status, attempts, cooldown_seconds, checks, reason)
      VALUES (_row.id, 'retry', _error_class, _row.package_id, _pkg_status, _row.attempts, _cooldown, _checks, 'all guards passed');

      _retried := _retried + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Per-row isolation: log & continue
      _row_errors := _row_errors + 1;
      INSERT INTO public.job_retry_decisions(job_id, decision, error_class, package_id, attempts, checks, reason)
      VALUES (_row.id, 'skip_row_error', _error_class, _row.package_id, _row.attempts,
              jsonb_build_object('row_error', true), LEFT(SQLERRM, 300));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'retried', _retried,
    'skipped_terminal', _skipped_terminal,
    'skipped_duplicate', _skipped_duplicate,
    'skipped_obsolete', _skipped_obsolete,
    'skipped_admin_terminal', _skipped_admin_terminal,
    'skipped_no_package', _skipped_no_package,
    'skipped_pkg_status', _skipped_pkg_status,
    'skipped_max_retry', _skipped_max_retry,
    'row_errors', _row_errors,
    'ran_at', now()
  );
END $$;

-- ── 4. admin_job_action: Rate-Limit, force_pending Guards, mark_terminal Marker, Bulk
CREATE TABLE IF NOT EXISTS public.admin_action_throttle (
  user_id uuid NOT NULL,
  action_type text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT date_trunc('minute', now()),
  request_count int NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, action_type, window_start)
);
ALTER TABLE public.admin_action_throttle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_throttle_admin ON public.admin_action_throttle;
CREATE POLICY p_throttle_admin ON public.admin_action_throttle FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.admin_check_action_throttle(
  _user_id uuid, _action text, _max_per_min int DEFAULT 30
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _window timestamptz := date_trunc('minute', now());
  _cnt int;
BEGIN
  INSERT INTO public.admin_action_throttle(user_id, action_type, window_start, request_count)
  VALUES (_user_id, _action, _window, 1)
  ON CONFLICT (user_id, action_type, window_start)
  DO UPDATE SET request_count = admin_action_throttle.request_count + 1
  RETURNING request_count INTO _cnt;

  -- Cleanup old windows opportunistically
  DELETE FROM public.admin_action_throttle WHERE window_start < now() - interval '1 hour';

  RETURN _cnt <= _max_per_min;
END $$;

-- Drop old single-job action and replace with hardened version
DROP FUNCTION IF EXISTS public.admin_job_action(uuid, text, text);

CREATE OR REPLACE FUNCTION public.admin_job_action(
  _job_id uuid, _action text, _reason text DEFAULT NULL, _force boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.job_queue;
  _old_status text;
  _new_status text;
  _allowed boolean;
  _pkg_status text;
  _active_set text[] := public.fn_job_active_statuses();
  _has_dup boolean;
  _pkg_ok boolean;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid,'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF _action NOT IN ('force_pending','cancel','mark_terminal') THEN
    RAISE EXCEPTION 'invalid action: %', _action;
  END IF;

  -- Rate limit (30/min per admin per action_type)
  IF NOT public.admin_check_action_throttle(_uid, 'job_action_'||_action, 30) THEN
    INSERT INTO public.admin_actions(user_id, action, scope, payload)
    VALUES (_uid, 'admin_job_action_throttled', 'job_queue',
            jsonb_build_object('action', _action, 'job_id', _job_id, 'reason', _reason));
    RAISE EXCEPTION 'rate limit exceeded for action %: max 30/min', _action;
  END IF;

  SELECT * INTO _row FROM public.job_queue WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not found: %', _job_id; END IF;
  _old_status := _row.status;

  PERFORM set_config('app.transition_source',
    'admin_ui:'||_action||':'||COALESCE(_uid::text,'?'), true);

  IF _action = 'force_pending' THEN
    -- Apply same SSOT/causality guards unless _force=true (Unsafe Override)
    IF NOT _force THEN
      -- package-bound check
      IF _row.job_type LIKE 'package_%' AND _row.package_id IS NULL THEN
        RAISE EXCEPTION 'guard_violation: package-bound job missing package_id (use _force=true to override)';
      END IF;

      -- package status check
      IF _row.package_id IS NOT NULL THEN
        SELECT status INTO _pkg_status FROM public.course_packages WHERE id = _row.package_id;
        _pkg_ok := _pkg_status = ANY(ARRAY['building','queued','blocked','pending','draft']);
        IF NOT _pkg_ok THEN
          RAISE EXCEPTION 'guard_violation: package status % not in allowlist (use _force=true to override)', _pkg_status;
        END IF;
      END IF;

      -- Duplicate check
      _has_dup := EXISTS (
        SELECT 1 FROM public.job_queue q
        WHERE q.job_type = _row.job_type
          AND q.package_id IS NOT DISTINCT FROM _row.package_id
          AND q.status = ANY(_active_set)
          AND q.id <> _row.id
      );
      IF _has_dup THEN
        RAISE EXCEPTION 'guard_violation: active duplicate job exists (use _force=true to override)';
      END IF;

      -- Admin-terminal marker check
      IF COALESCE(_row.meta->>'admin_terminal','false') = 'true' THEN
        RAISE EXCEPTION 'guard_violation: job marked admin_terminal (use _force=true to override)';
      END IF;
    END IF;

    UPDATE public.job_queue SET
      status = 'pending',
      run_after = now() + interval '5 seconds',
      locked_by = NULL,
      locked_at = NULL,
      last_error = NULL,
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'admin_force_pending_at', now(),
        'admin_force_by', _uid,
        'admin_force_reason', COALESCE(_reason,'manual'),
        'admin_force_unsafe_override', _force
      ) - 'admin_terminal'
    WHERE id = _job_id;
    _new_status := 'pending';

  ELSIF _action = 'cancel' THEN
    UPDATE public.job_queue SET
      status = 'cancelled',
      last_error = 'admin_cancelled: '||COALESCE(_reason,'no reason'),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'admin_cancelled_at', now(),
        'admin_cancelled_by', _uid,
        'admin_cancelled_reason', COALESCE(_reason,'manual')
      )
    WHERE id = _job_id;
    _new_status := 'cancelled';

  ELSIF _action = 'mark_terminal' THEN
    UPDATE public.job_queue SET
      status = 'failed',
      attempts = GREATEST(COALESCE(attempts,0), COALESCE(max_attempts,99)),
      last_error = 'admin_terminal: '||COALESCE(_reason,'manual review'),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'admin_terminal', true,
        'admin_marked_terminal_at', now(),
        'admin_marked_terminal_by', _uid,
        'admin_terminal_reason', COALESCE(_reason,'manual')
      )
    WHERE id = _job_id;
    _new_status := 'failed';
  END IF;

  INSERT INTO public.admin_actions(user_id, action, scope, affected_ids, payload)
  VALUES (_uid, 'admin_job_action_'||_action, 'job_queue', ARRAY[_job_id::text],
          jsonb_build_object(
            'action', _action,
            'reason', _reason,
            'force', _force,
            'old_status', _old_status,
            'new_status', _new_status
          ));

  RETURN jsonb_build_object(
    'job_id', _job_id,
    'action', _action,
    'old_status', _old_status,
    'new_status', _new_status,
    'force', _force,
    'reason', _reason,
    'at', now()
  );
END $$;

-- ── 5. Bulk action: max 50 jobs per call, throttled
CREATE OR REPLACE FUNCTION public.admin_job_action_bulk(
  _job_ids uuid[], _action text, _reason text, _force boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _ok int := 0;
  _err int := 0;
  _errors jsonb := '[]'::jsonb;
  _result jsonb;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid,'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF array_length(_job_ids,1) IS NULL OR array_length(_job_ids,1) = 0 THEN
    RAISE EXCEPTION 'no job_ids provided';
  END IF;
  IF array_length(_job_ids,1) > 50 THEN
    RAISE EXCEPTION 'bulk limit exceeded: max 50 jobs per call (got %)', array_length(_job_ids,1);
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'reason required (min 3 chars) for bulk actions';
  END IF;

  -- Stricter rate limit for bulk (10/min)
  IF NOT public.admin_check_action_throttle(_uid, 'bulk_'||_action, 10) THEN
    RAISE EXCEPTION 'rate limit exceeded for bulk %: max 10/min', _action;
  END IF;

  FOREACH _id IN ARRAY _job_ids LOOP
    BEGIN
      _result := public.admin_job_action(_id, _action, _reason, _force);
      _ok := _ok + 1;
    EXCEPTION WHEN OTHERS THEN
      _err := _err + 1;
      _errors := _errors || jsonb_build_object('job_id', _id, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO public.admin_actions(user_id, action, scope, affected_ids, payload)
  VALUES (_uid, 'admin_job_action_bulk_'||_action, 'job_queue',
          ARRAY(SELECT unnest(_job_ids)::text),
          jsonb_build_object('action',_action,'reason',_reason,'force',_force,'ok',_ok,'err',_err));

  RETURN jsonb_build_object('ok',_ok,'err',_err,'errors',_errors,'total',array_length(_job_ids,1));
END $$;

-- ── 6. Job timeline aggregator (transitions + decisions + admin actions)
CREATE OR REPLACE FUNCTION public.admin_get_job_timeline(_job_id uuid DEFAULT NULL, _package_id uuid DEFAULT NULL, _limit int DEFAULT 200)
RETURNS TABLE(
  ts timestamptz, kind text, job_id uuid, job_type text, package_id uuid,
  old_status text, new_status text, error_class text, last_error text,
  trigger_source text, attempts int, decision text, reason text, payload jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _job_id IS NULL AND _package_id IS NULL THEN
    RAISE EXCEPTION 'job_id or package_id required';
  END IF;

  RETURN QUERY
  SELECT t.created_at AS ts, 'transition'::text AS kind,
         t.job_id, t.job_type, t.package_id,
         t.old_status, t.new_status, t.error_class, t.last_error,
         t.trigger_source, t.attempts, NULL::text AS decision, t.reason,
         jsonb_build_object('change_kind', t.change_kind, 'meta_diff', t.meta_diff) AS payload
  FROM public.job_status_transitions t
  WHERE (_job_id IS NULL OR t.job_id = _job_id)
    AND (_package_id IS NULL OR t.package_id = _package_id)
  UNION ALL
  SELECT d.decided_at AS ts, 'decision'::text AS kind,
         d.job_id, NULL::text AS job_type, d.package_id,
         NULL::text, NULL::text, d.error_class, NULL::text,
         'auto_retry_policy'::text, d.attempts, d.decision, d.reason,
         jsonb_build_object('checks', d.checks, 'cooldown', d.cooldown_seconds, 'pkg_status', d.package_status) AS payload
  FROM public.job_retry_decisions d
  WHERE (_job_id IS NULL OR d.job_id = _job_id)
    AND (_package_id IS NULL OR d.package_id = _package_id)
  UNION ALL
  SELECT a.created_at AS ts, 'admin_action'::text AS kind,
         CASE WHEN array_length(a.affected_ids,1) > 0 THEN a.affected_ids[1]::uuid ELSE NULL END AS job_id,
         NULL::text, NULL::uuid,
         (a.payload->>'old_status'), (a.payload->>'new_status'), NULL::text, NULL::text,
         'admin_actions'::text, NULL::int, a.action, (a.payload->>'reason'), a.payload
  FROM public.admin_actions a
  WHERE a.scope = 'job_queue'
    AND (_job_id IS NULL OR _job_id::text = ANY(a.affected_ids))
  ORDER BY ts DESC
  LIMIT _limit;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_job_timeline(uuid, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_job_timeline(uuid, uuid, int) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_job_action(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_job_action(uuid, text, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_job_action_bulk(uuid[], text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_job_action_bulk(uuid[], text, text, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_check_action_throttle(uuid, text, int) FROM PUBLIC, anon;