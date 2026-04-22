-- =================================================================
-- WAVE-4: Bulk-Throttle Split, Newer-Success Guard, Timeline Pkg-Filter
-- =================================================================

-- 1) Decision Trace: job_type-Spalte für UI-friendly timeline
ALTER TABLE public.job_retry_decisions
  ADD COLUMN IF NOT EXISTS job_type text;

-- Backfill from job_queue
UPDATE public.job_retry_decisions d
SET job_type = q.job_type
FROM public.job_queue q
WHERE d.job_id = q.id AND d.job_type IS NULL;

-- 2) Internal action — NO throttle (used by bulk)
CREATE OR REPLACE FUNCTION public.admin_job_action_internal(
  _job_id uuid,
  _action text,
  _reason text DEFAULT NULL,
  _force boolean DEFAULT false,
  _uid uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.job_queue%ROWTYPE;
  _new_status text;
  _old_status text;
  _allowed_pkg_status text[] := ARRAY['building','queued','blocked','pending','draft'];
  _pkg_status text;
  _user uuid := COALESCE(_uid, auth.uid());
BEGIN
  IF _user IS NULL OR NOT public.has_role(_user, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF COALESCE(trim(_reason),'') = '' OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required: provide a meaningful reason (min 3 chars)';
  END IF;

  SELECT * INTO _row FROM public.job_queue WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: job % does not exist', _job_id;
  END IF;
  _old_status := _row.status;

  PERFORM set_config('app.transition_source',
    'admin_ui:'||_action||':'||COALESCE(_user::text,'unknown'), true);

  IF _action = 'force_pending' THEN
    IF NOT _force THEN
      -- Guard: package-bound jobs need a package_id
      IF _row.job_type LIKE 'package_%' AND _row.package_id IS NULL THEN
        RAISE EXCEPTION 'guard_violation: package-bound job has no package_id (use _force=true to override)';
      END IF;

      -- Guard: package status allowlist
      IF _row.package_id IS NOT NULL THEN
        SELECT status INTO _pkg_status FROM public.course_packages WHERE id = _row.package_id;
        IF _pkg_status IS NOT NULL AND NOT (_pkg_status = ANY(_allowed_pkg_status)) THEN
          RAISE EXCEPTION 'guard_violation: package status % not allowed (use _force=true to override)', _pkg_status;
        END IF;
      END IF;

      -- Guard: no active duplicate
      IF EXISTS (
        SELECT 1 FROM public.job_queue q
        WHERE q.job_type = _row.job_type
          AND q.package_id IS NOT DISTINCT FROM _row.package_id
          AND q.status = ANY(public.fn_job_active_statuses())
          AND q.id <> _row.id
      ) THEN
        RAISE EXCEPTION 'guard_violation: active duplicate exists (use _force=true to override)';
      END IF;

      -- Guard: admin-marked terminal
      IF (_row.meta->>'admin_terminal') = 'true' THEN
        RAISE EXCEPTION 'guard_violation: job is admin_terminal (use _force=true to override)';
      END IF;

      -- NEW Wave-4 Guard: newer completed job exists
      IF EXISTS (
        SELECT 1 FROM public.job_queue q
        WHERE q.job_type = _row.job_type
          AND q.package_id IS NOT DISTINCT FROM _row.package_id
          AND q.status = 'completed'
          AND q.updated_at > _row.updated_at
          AND q.id <> _row.id
      ) THEN
        RAISE EXCEPTION 'guard_violation: newer completed job exists for same (job_type, package_id) — likely obsolete (use _force=true to override)';
      END IF;
    END IF;

    UPDATE public.job_queue SET
      status = 'pending',
      run_after = now() + interval '5 seconds',
      last_error = NULL,
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'admin_force_pending_at', now(),
        'admin_force_pending_by', _user,
        'admin_reason', trim(_reason),
        'admin_force_unsafe', _force
      ),
      updated_at = now()
    WHERE id = _job_id;
    _new_status := 'pending';

  ELSIF _action = 'cancel' THEN
    UPDATE public.job_queue SET
      status = 'cancelled',
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'admin_cancelled_at', now(),
        'admin_cancelled_by', _user,
        'admin_reason', trim(_reason)
      ),
      updated_at = now()
    WHERE id = _job_id;
    _new_status := 'cancelled';

  ELSIF _action = 'mark_terminal' THEN
    UPDATE public.job_queue SET
      status = 'failed',
      attempts = GREATEST(COALESCE(attempts,0), COALESCE(max_attempts,99)),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'admin_terminal', true,
        'admin_marked_terminal_at', now(),
        'admin_marked_terminal_by', _user,
        'admin_reason', trim(_reason)
      ),
      updated_at = now()
    WHERE id = _job_id;
    _new_status := 'failed';

  ELSE
    RAISE EXCEPTION 'unknown_action: %', _action;
  END IF;

  -- Audit log (also includes package_id in payload for timeline filter)
  INSERT INTO public.admin_actions(user_id, action, scope, affected_ids, payload, before_state, after_state)
  VALUES (
    _user,
    'job_action:'||_action,
    'job_queue',
    ARRAY[_job_id::text],
    jsonb_build_object(
      'reason', trim(_reason),
      'force', _force,
      'job_type', _row.job_type,
      'package_id', _row.package_id
    ),
    jsonb_build_object('status', _old_status),
    jsonb_build_object('status', _new_status)
  );

  RETURN jsonb_build_object(
    'ok', true, 'job_id', _job_id,
    'old_status', _old_status, 'new_status', _new_status,
    'action', _action, 'force', _force
  );
END;
$$;

-- 3) Public wrapper — WITH throttle (single calls)
CREATE OR REPLACE FUNCTION public.admin_job_action(
  _job_id uuid,
  _action text,
  _reason text DEFAULT NULL,
  _force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
BEGIN
  IF _user IS NULL OR NOT public.has_role(_user, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF NOT public.admin_check_action_throttle(_user, 'job_action_'||_action, 30) THEN
    RAISE EXCEPTION 'rate_limited: max 30 actions/min for %', _action;
  END IF;
  RETURN public.admin_job_action_internal(_job_id, _action, _reason, _force, _user);
END;
$$;

-- 4) Bulk — uses internal (skips per-job throttle), keeps own 10/min cap, returns next_offset
CREATE OR REPLACE FUNCTION public.admin_job_action_bulk(
  _job_ids uuid[],
  _action text,
  _reason text DEFAULT NULL,
  _force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _ok int := 0;
  _err int := 0;
  _errors jsonb := '[]'::jsonb;
  _job uuid;
  _res jsonb;
BEGIN
  IF _user IS NULL OR NOT public.has_role(_user, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF array_length(_job_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'empty: no job ids provided';
  END IF;
  IF array_length(_job_ids, 1) > 50 THEN
    RAISE EXCEPTION 'too_many: max 50 jobs per bulk call (use pagination)';
  END IF;
  IF NOT public.admin_check_action_throttle(_user, 'bulk_'||_action, 10) THEN
    RAISE EXCEPTION 'rate_limited: max 10 bulk actions/min for %', _action;
  END IF;

  FOREACH _job IN ARRAY _job_ids LOOP
    BEGIN
      _res := public.admin_job_action_internal(_job, _action, _reason, _force, _user);
      _ok := _ok + 1;
    EXCEPTION WHEN OTHERS THEN
      _err := _err + 1;
      _errors := _errors || jsonb_build_object('job_id', _job, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO public.admin_actions(user_id, action, scope, affected_ids, payload)
  VALUES (
    _user, 'job_action_bulk:'||_action, 'job_queue',
    array(SELECT id::text FROM unnest(_job_ids) AS id),
    jsonb_build_object('reason', _reason, 'force', _force, 'ok', _ok, 'err', _err, 'errors', _errors)
  );

  RETURN jsonb_build_object(
    'ok', _ok, 'err', _err, 'total', array_length(_job_ids, 1),
    'errors', _errors
  );
END;
$$;

-- 5) Timeline — package_id filter now joins admin_actions via job_queue
CREATE OR REPLACE FUNCTION public.admin_get_job_timeline(
  _job_id uuid DEFAULT NULL,
  _package_id uuid DEFAULT NULL,
  _limit int DEFAULT 200
)
RETURNS TABLE(
  ts timestamptz,
  kind text,
  job_id uuid,
  job_type text,
  package_id uuid,
  old_status text,
  new_status text,
  error_class text,
  last_error text,
  trigger_source text,
  attempts int,
  decision text,
  reason text,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
BEGIN
  IF _user IS NULL OR NOT public.has_role(_user, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF _job_id IS NULL AND _package_id IS NULL THEN
    RAISE EXCEPTION 'missing_filter: provide _job_id or _package_id';
  END IF;

  RETURN QUERY
  WITH transitions AS (
    SELECT
      t.created_at AS ts,
      'transition'::text AS kind,
      t.job_id, t.job_type, t.package_id,
      t.old_status, t.new_status, t.error_class, t.last_error,
      t.trigger_source, t.attempts,
      NULL::text AS decision, t.reason,
      jsonb_build_object('meta_diff', t.meta_diff, 'change_kind', t.change_kind) AS payload
    FROM public.job_status_transitions t
    WHERE (_job_id IS NULL OR t.job_id = _job_id)
      AND (_package_id IS NULL OR t.package_id = _package_id)
  ),
  decisions AS (
    SELECT
      d.decided_at AS ts,
      'decision'::text AS kind,
      d.job_id,
      COALESCE(d.job_type, q.job_type) AS job_type,
      q.package_id,
      NULL::text AS old_status, NULL::text AS new_status,
      d.error_class, NULL::text AS last_error,
      'auto_retry_policy'::text AS trigger_source,
      d.attempts,
      d.decision, d.reason,
      jsonb_build_object('checks', d.checks, 'cooldown', d.cooldown_seconds, 'pkg_status', d.package_status) AS payload
    FROM public.job_retry_decisions d
    LEFT JOIN public.job_queue q ON q.id = d.job_id
    WHERE (_job_id IS NULL OR d.job_id = _job_id)
      AND (_package_id IS NULL OR q.package_id = _package_id)
  ),
  admin_acts AS (
    SELECT DISTINCT
      a.created_at AS ts,
      'admin_action'::text AS kind,
      jq.id AS job_id,
      jq.job_type, jq.package_id,
      (a.before_state->>'status')::text AS old_status,
      (a.after_state->>'status')::text AS new_status,
      NULL::text AS error_class, NULL::text AS last_error,
      ('admin_ui:'||a.action)::text AS trigger_source,
      NULL::int AS attempts,
      a.action AS decision,
      (a.payload->>'reason')::text AS reason,
      a.payload
    FROM public.admin_actions a
    JOIN public.job_queue jq ON jq.id::text = ANY(a.affected_ids)
    WHERE a.scope = 'job_queue'
      AND (_job_id IS NULL OR jq.id = _job_id)
      AND (_package_id IS NULL OR jq.package_id = _package_id)
  )
  SELECT * FROM transitions
  UNION ALL SELECT * FROM decisions
  UNION ALL SELECT * FROM admin_acts
  ORDER BY ts DESC
  LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_job_action_internal(uuid, text, text, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_action(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_job_action_bulk(uuid[], text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_job_timeline(uuid, uuid, int) TO authenticated;