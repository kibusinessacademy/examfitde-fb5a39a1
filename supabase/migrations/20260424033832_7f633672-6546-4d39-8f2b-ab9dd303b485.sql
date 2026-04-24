
-- ============================================================
-- 1. Detection: zombie-locked jobs (never started or stale heartbeat)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_detect_zombie_locked_jobs(
  _age_min integer DEFAULT 15
)
RETURNS TABLE (
  job_id uuid,
  job_type text,
  package_id uuid,
  status text,
  attempts integer,
  locked_at timestamptz,
  started_at timestamptz,
  last_heartbeat_at timestamptz,
  locked_by text,
  age_minutes numeric,
  zombie_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.id AS job_id,
    q.job_type,
    q.package_id,
    q.status::text,
    q.attempts,
    q.locked_at,
    q.started_at,
    q.last_heartbeat_at,
    q.locked_by,
    EXTRACT(EPOCH FROM (now() - q.locked_at)) / 60.0 AS age_minutes,
    CASE
      WHEN q.started_at IS NULL THEN 'locked_never_started'
      WHEN q.started_at = q.locked_at AND q.last_heartbeat_at IS NULL THEN 'no_heartbeat_since_lock'
      WHEN q.last_heartbeat_at IS NOT NULL
           AND q.last_heartbeat_at < now() - make_interval(mins => _age_min) THEN 'heartbeat_stale'
      ELSE 'locked_stale'
    END AS zombie_reason
  FROM public.job_queue q
  WHERE q.status IN ('processing', 'running')
    AND q.locked_at IS NOT NULL
    AND q.locked_at < now() - make_interval(mins => _age_min)
    AND (
      q.last_heartbeat_at IS NULL
      OR q.last_heartbeat_at < now() - make_interval(mins => _age_min)
    )
  ORDER BY q.locked_at ASC;
$$;

REVOKE ALL ON FUNCTION public.admin_detect_zombie_locked_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_detect_zombie_locked_jobs(integer) TO authenticated;

-- ============================================================
-- 2. Heal one zombie-locked job (cancel + reset step + audit)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_heal_zombie_locked_job(
  _job_id uuid,
  _reason text DEFAULT 'zombie_locked_auto_heal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.job_queue%ROWTYPE;
  _step_key text;
  _pkg uuid;
  _step_reset boolean := false;
  _uid uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _row FROM public.job_queue WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;

  IF _row.status NOT IN ('processing', 'running') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_in_processing', 'status', _row.status);
  END IF;

  _pkg := _row.package_id;
  _step_key := COALESCE(_row.meta->>'step_key', NULL);

  -- Cancel the zombie job
  UPDATE public.job_queue
  SET status = 'cancelled',
      locked_at = NULL,
      locked_by = NULL,
      completed_at = now(),
      last_error = COALESCE(_reason, 'zombie_locked_auto_heal') || ' (was: ' || COALESCE(last_error, '') || ')',
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'admin_cancel_reason', _reason,
        'admin_cancel_source', 'admin_heal_zombie_locked_job',
        'admin_cancel_at', now()
      )
  WHERE id = _job_id;

  -- Reset matching step → queued so reconciler picks it up
  IF _pkg IS NOT NULL AND _step_key IS NOT NULL THEN
    UPDATE public.package_steps
    SET status = 'queued',
        started_at = NULL,
        last_heartbeat_at = NULL,
        runner_id = NULL,
        job_id = NULL,
        updated_at = now(),
        last_error = 'zombie_locked_auto_heal: step reset for re-enqueue'
    WHERE package_id = _pkg
      AND step_key = _step_key
      AND status IN ('running', 'enqueued', 'processing');
    GET DIAGNOSTICS _step_reset = ROW_COUNT;
  END IF;

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids, user_id)
  VALUES (
    'heal_zombie_locked_job',
    jsonb_build_object(
      'job_id', _job_id,
      'package_id', _pkg,
      'step_key', _step_key,
      'reason', _reason,
      'attempts', _row.attempts,
      'locked_at', _row.locked_at,
      'started_at', _row.started_at,
      'last_heartbeat_at', _row.last_heartbeat_at,
      'locked_by', _row.locked_by,
      'step_reset', _step_reset
    ),
    'job_queue',
    ARRAY[_job_id::text],
    _uid
  );

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', _job_id,
    'package_id', _pkg,
    'step_key', _step_key,
    'step_reset', _step_reset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_zombie_locked_job(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_zombie_locked_job(uuid, text) TO authenticated;

-- ============================================================
-- 3. Safe requeue for run_integrity_check (with guards)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_safe_requeue_integrity_check(
  _package_id uuid,
  _reason text DEFAULT 'manual_safe_requeue'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _active_count integer;
  _step_status text;
  _upstream_blocking integer;
  _new_job_id uuid;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required' USING ERRCODE = '42501';
  END IF;

  -- Guard 1: no active package_run_integrity_check
  SELECT COUNT(*) INTO _active_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND job_type = 'package_run_integrity_check'
    AND status IN ('pending', 'queued', 'processing', 'running');
  IF _active_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_job_exists', 'count', _active_count);
  END IF;

  -- Guard 2: step run_integrity_check must be queued
  SELECT status::text INTO _step_status
  FROM public.package_steps
  WHERE package_id = _package_id AND step_key = 'run_integrity_check'
  LIMIT 1;
  IF _step_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_not_found');
  END IF;
  IF _step_status NOT IN ('queued', 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_not_queued', 'status', _step_status);
  END IF;

  -- Guard 3: all upstream steps for this package must be done/skipped
  SELECT COUNT(*) INTO _upstream_blocking
  FROM public.package_steps
  WHERE package_id = _package_id
    AND step_key <> 'run_integrity_check'
    AND status NOT IN ('done', 'skipped', 'completed');
  -- Allow some lenience: only block if more than the integrity step itself remains
  -- (We treat anything not done/skipped as blocking.)
  IF _upstream_blocking > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'upstream_not_done',
      'blocking_steps', _upstream_blocking
    );
  END IF;

  -- Insert new job
  INSERT INTO public.job_queue (
    job_type, status, package_id, payload, meta, run_after, priority
  )
  VALUES (
    'package_run_integrity_check',
    'pending',
    _package_id,
    jsonb_build_object('package_id', _package_id),
    jsonb_build_object(
      'source', 'admin_safe_requeue_integrity_check',
      'admin_reason', _reason,
      'admin_user', _uid,
      'step_key', 'run_integrity_check'
    ),
    now(),
    2
  )
  RETURNING id INTO _new_job_id;

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids, user_id)
  VALUES (
    'safe_requeue_integrity_check',
    jsonb_build_object(
      'package_id', _package_id,
      'new_job_id', _new_job_id,
      'reason', _reason
    ),
    'job_queue',
    ARRAY[_new_job_id::text],
    _uid
  );

  RETURN jsonb_build_object('ok', true, 'job_id', _new_job_id, 'package_id', _package_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_safe_requeue_integrity_check(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_safe_requeue_integrity_check(uuid, text) TO authenticated;

-- ============================================================
-- 4. Mark REQUEUE-loop jobs as terminal (manual_review_required)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_mark_requeue_loop_terminal(
  _job_id uuid,
  _reason text DEFAULT 'requeue_loop_manual_review'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _row public.job_queue%ROWTYPE;
BEGIN
  _uid := auth.uid();
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _row FROM public.job_queue WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;

  UPDATE public.job_queue
  SET status = 'failed',
      locked_at = NULL,
      locked_by = NULL,
      completed_at = COALESCE(completed_at, now()),
      last_error = 'MANUAL_REVIEW_REQUIRED: ' || COALESCE(_reason, 'requeue_loop')
                   || ' (was: ' || COALESCE(last_error, '') || ')',
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'manual_review_required', true,
        'retry_path_terminal', true,
        'admin_terminal_reason', _reason,
        'admin_terminal_at', now()
      )
  WHERE id = _job_id;

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids, user_id)
  VALUES (
    'mark_requeue_loop_terminal',
    jsonb_build_object(
      'job_id', _job_id,
      'package_id', _row.package_id,
      'job_type', _row.job_type,
      'attempts', _row.attempts,
      'reason', _reason
    ),
    'job_queue',
    ARRAY[_job_id::text],
    _uid
  );

  RETURN jsonb_build_object('ok', true, 'job_id', _job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_mark_requeue_loop_terminal(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_requeue_loop_terminal(uuid, text) TO authenticated;

-- ============================================================
-- 5. Audit summary for cancelled jobs (used by admin UI)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_job_cancel_audit_summary(
  _job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job public.job_queue%ROWTYPE;
  _step record;
  _actions jsonb;
  _reconciler jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _job FROM public.job_queue WHERE id = _job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;

  SELECT step_key, status::text AS status, started_at, last_heartbeat_at, runner_id, last_error
    INTO _step
  FROM public.package_steps
  WHERE package_id = _job.package_id
    AND step_key = COALESCE(_job.meta->>'step_key', '')
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'action', a.action,
    'reason', a.payload->>'reason',
    'created_at', a.created_at,
    'payload', a.payload
  ) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO _actions
  FROM public.admin_actions a
  WHERE _job_id::text = ANY(a.affected_ids)
     OR a.payload->>'job_id' = _job_id::text;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'action', a.action,
    'created_at', a.created_at,
    'payload', a.payload
  ) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO _reconciler
  FROM public.admin_actions a
  WHERE a.action ILIKE '%reconcil%'
    AND (
      a.payload->>'package_id' = _job.package_id::text
      OR _job.package_id::text = ANY(a.affected_ids)
    );

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', _job_id,
    'job_type', _job.job_type,
    'status', _job.status,
    'package_id', _job.package_id,
    'attempts', _job.attempts,
    'reason_code', COALESCE(
      _job.meta->>'admin_cancel_reason',
      _job.meta->>'admin_terminal_reason',
      _job.last_error_code
    ),
    'last_error', _job.last_error,
    'step_key', COALESCE(_step.step_key, _job.meta->>'step_key'),
    'step_status', _step.status,
    'started_at', _job.started_at,
    'last_heartbeat_at', _job.last_heartbeat_at,
    'locked_at', _job.locked_at,
    'locked_by', _job.locked_by,
    'completed_at', _job.completed_at,
    'admin_actions', _actions,
    'reconciler_actions', _reconciler
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_job_cancel_audit_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_job_cancel_audit_summary(uuid) TO authenticated;

-- ============================================================
-- 6. Runbook for run_integrity_check (likely causes + heal options)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_run_integrity_runbook(
  _package_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _step record;
  _job record;
  _causes jsonb := '[]'::jsonb;
  _zombie_count integer := 0;
  _stale_lock boolean := false;
  _orphan boolean := false;
  _ghost_finalization boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT step_key, status::text AS status, started_at, last_heartbeat_at, runner_id, job_id, updated_at
    INTO _step
  FROM public.package_steps
  WHERE package_id = _package_id AND step_key = 'run_integrity_check'
  LIMIT 1;

  SELECT id, status::text AS status, attempts, locked_at, started_at, last_heartbeat_at, locked_by, last_error, created_at
    INTO _job
  FROM public.job_queue
  WHERE package_id = _package_id
    AND job_type = 'package_run_integrity_check'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Cause 1: Zombie lock (locked but never started or no heartbeat)
  IF _job.id IS NOT NULL
     AND _job.status IN ('processing', 'running')
     AND _job.locked_at < now() - interval '10 minutes'
     AND (_job.last_heartbeat_at IS NULL OR _job.last_heartbeat_at < now() - interval '10 minutes')
  THEN
    _stale_lock := true;
    _causes := _causes || jsonb_build_object(
      'kind', 'stale_lock',
      'severity', 'high',
      'title', 'Stale lock / Zombie',
      'detail', 'Job ist seit ' || EXTRACT(EPOCH FROM (now() - _job.locked_at))/60 || ' Min gelockt ohne Heartbeat.',
      'heal_action', 'heal_zombie_locked_job',
      'heal_target', _job.id
    );
  END IF;

  -- Cause 2: Ghost-Finalization (step running but never started)
  IF _step.status IN ('running', 'enqueued')
     AND _step.started_at IS NULL
     AND _step.updated_at < now() - interval '15 minutes'
  THEN
    _ghost_finalization := true;
    _causes := _causes || jsonb_build_object(
      'kind', 'ghost_finalization',
      'severity', 'high',
      'title', 'Ghost-Finalization',
      'detail', 'Step ist ' || _step.status || ' aber started_at = NULL.',
      'heal_action', 'safe_requeue_integrity_check',
      'heal_target', _package_id
    );
  END IF;

  -- Cause 3: Orphan (step queued but no active job)
  IF _step.status IN ('queued', 'pending')
     AND (_job.id IS NULL OR _job.status NOT IN ('pending', 'queued', 'processing', 'running'))
     AND _step.updated_at < now() - interval '15 minutes'
  THEN
    _orphan := true;
    _causes := _causes || jsonb_build_object(
      'kind', 'orphan_no_job',
      'severity', 'medium',
      'title', 'Orphan Reconciler säumig',
      'detail', 'Step queued seit ' || _step.updated_at || ', aber kein aktiver Job.',
      'heal_action', 'safe_requeue_integrity_check',
      'heal_target', _package_id
    );
  END IF;

  -- Cause 4: REQUEUE loop
  SELECT COUNT(*) INTO _zombie_count
  FROM public.job_queue
  WHERE package_id = _package_id
    AND job_type = 'package_run_integrity_check'
    AND last_error ILIKE '%REQUEUE_LOOP_KILLED%'
    AND created_at > now() - interval '6 hours';
  IF _zombie_count > 0 THEN
    _causes := _causes || jsonb_build_object(
      'kind', 'requeue_loop',
      'severity', 'high',
      'title', 'REQUEUE-Loop terminal markiert',
      'detail', _zombie_count || ' Loop-terminale Jobs in den letzten 6h.',
      'heal_action', 'mark_requeue_loop_terminal',
      'heal_target', _job.id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', _package_id,
    'step', to_jsonb(_step),
    'last_job', to_jsonb(_job),
    'causes', _causes,
    'flags', jsonb_build_object(
      'stale_lock', _stale_lock,
      'ghost_finalization', _ghost_finalization,
      'orphan_no_job', _orphan,
      'requeue_loop', _zombie_count > 0
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_run_integrity_runbook(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_run_integrity_runbook(uuid) TO authenticated;

-- ============================================================
-- 7. Cron auto-heal: marks zombie-locked jobs every 10 min
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_auto_heal_zombie_locked_jobs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _healed integer := 0;
  _row record;
BEGIN
  FOR _row IN
    SELECT q.id, q.package_id, q.meta->>'step_key' AS step_key, q.locked_at, q.last_heartbeat_at, q.last_error
    FROM public.job_queue q
    WHERE q.status IN ('processing', 'running')
      AND q.locked_at IS NOT NULL
      AND q.locked_at < now() - interval '15 minutes'
      AND (q.last_heartbeat_at IS NULL
           OR q.last_heartbeat_at < now() - interval '15 minutes')
      AND COALESCE((q.meta->>'admin_terminal')::boolean, false) = false
      AND COALESCE((q.meta->>'manual_review_required')::boolean, false) = false
    LIMIT 50
  LOOP
    UPDATE public.job_queue
    SET status = 'cancelled',
        locked_at = NULL,
        locked_by = NULL,
        completed_at = now(),
        last_error = 'ZOMBIE_LOCKED_AUTO_HEAL: cancelled after 15min stale lock (was: '
                     || COALESCE(_row.last_error, '') || ')',
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'admin_cancel_reason', 'zombie_locked_auto_heal_cron',
          'admin_cancel_source', 'fn_auto_heal_zombie_locked_jobs',
          'admin_cancel_at', now()
        )
    WHERE id = _row.id;

    -- Reset step
    IF _row.package_id IS NOT NULL AND _row.step_key IS NOT NULL THEN
      UPDATE public.package_steps
      SET status = 'queued',
          started_at = NULL,
          last_heartbeat_at = NULL,
          runner_id = NULL,
          job_id = NULL,
          updated_at = now(),
          last_error = 'zombie_locked_auto_heal: step reset by cron'
      WHERE package_id = _row.package_id
        AND step_key = _row.step_key
        AND status IN ('running', 'enqueued', 'processing');
    END IF;

    INSERT INTO public.admin_actions (action, payload, scope, affected_ids)
    VALUES (
      'auto_heal_zombie_locked_job',
      jsonb_build_object(
        'job_id', _row.id,
        'package_id', _row.package_id,
        'step_key', _row.step_key,
        'locked_at', _row.locked_at,
        'last_heartbeat_at', _row.last_heartbeat_at,
        'source', 'cron'
      ),
      'job_queue',
      ARRAY[_row.id::text]
    );

    _healed := _healed + 1;
  END LOOP;

  RETURN jsonb_build_object('healed', _healed, 'ts', now());
END;
$$;

-- Schedule cron (every 10 min)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('auto-heal-zombie-locked-jobs')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-heal-zombie-locked-jobs');
    PERFORM cron.schedule(
      'auto-heal-zombie-locked-jobs',
      '*/10 * * * *',
      $cron$ SELECT public.fn_auto_heal_zombie_locked_jobs(); $cron$
    );
  END IF;
END $$;
