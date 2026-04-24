-- ════════════════════════════════════════════════════════════════════════════
-- Zombie Auto-Heal v1.1 — Bugfixes + erweiterter Retry-Guard
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Bugfix 1: ROW_COUNT auf Integer + Bugfix 2: Upstream-Guard via step_order
CREATE OR REPLACE FUNCTION public.admin_heal_zombie_locked_job(
  _job_id uuid,
  _reason text DEFAULT 'manual_admin_heal'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job record;
  _step_reset_count integer := 0;
  _result jsonb;
BEGIN
  SELECT * INTO _job FROM public.job_queue WHERE id = _job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;

  IF _job.status NOT IN ('processing', 'running') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_locked', 'status', _job.status);
  END IF;

  UPDATE public.job_queue
  SET status = 'cancelled',
      locked_by = NULL,
      locked_at = NULL,
      completed_at = now(),
      last_error = format('Auto-heal: %s (was locked %s min, attempts=%s)',
        _reason,
        EXTRACT(EPOCH FROM (now() - COALESCE(_job.locked_at, _job.created_at)))::int / 60,
        _job.attempts),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'auto_heal_reason', _reason,
        'auto_heal_at', now(),
        'auto_heal_was_status', _job.status,
        'auto_heal_was_locked_by', _job.locked_by
      )
  WHERE id = _job_id;

  -- Reset matching step (best-effort)
  IF _job.package_id IS NOT NULL AND _job.job_type LIKE 'package_%' THEN
    UPDATE public.package_steps
    SET status = 'queued',
        attempts = 0,
        last_error = format('reset_after_zombie_heal: %s', _reason),
        updated_at = now()
    WHERE package_id = _job.package_id
      AND step_key = REPLACE(_job.job_type, 'package_', '')
      AND status IN ('processing', 'running', 'failed');
    GET DIAGNOSTICS _step_reset_count = ROW_COUNT;
  END IF;

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids)
  VALUES (
    'auto_heal_zombie_locked_job',
    jsonb_build_object(
      'job_id', _job_id,
      'job_type', _job.job_type,
      'package_id', _job.package_id,
      'reason', _reason,
      'step_reset_count', _step_reset_count
    ),
    'job_queue',
    ARRAY[_job_id::text]
  );

  _result := jsonb_build_object(
    'ok', true,
    'job_id', _job_id,
    'step_reset', (_step_reset_count > 0),
    'step_reset_count', _step_reset_count
  );
  RETURN _result;
END;
$$;

-- ─── Bugfix 2: admin_safe_requeue_integrity_check
-- Upstream-Guard prüft NUR Steps mit step_order < run_integrity_check.step_order
CREATE OR REPLACE FUNCTION public.admin_safe_requeue_integrity_check(
  _package_id uuid,
  _reason text DEFAULT 'manual_admin_requeue'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _step record;
  _active_jobs int;
  _upstream_pending int;
  _new_job_id uuid;
  _ric_step_order int;
BEGIN
  -- 1) Step laden
  SELECT * INTO _step
  FROM public.package_steps
  WHERE package_id = _package_id AND step_key = 'run_integrity_check';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_not_found');
  END IF;

  IF _step.status <> 'queued' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'step_not_queued', 'status', _step.status);
  END IF;

  _ric_step_order := _step.step_order;

  -- 2) Aktive Integrity-Check Jobs verbieten
  SELECT count(*) INTO _active_jobs
  FROM public.job_queue
  WHERE package_id = _package_id
    AND job_type = 'package_run_integrity_check'
    AND status IN ('queued', 'processing', 'running');
  IF _active_jobs > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_job_exists', 'count', _active_jobs);
  END IF;

  -- 3) Upstream-Guard: NUR echte Vorgänger-Steps (step_order < ric_step_order)
  SELECT count(*) INTO _upstream_pending
  FROM public.package_steps
  WHERE package_id = _package_id
    AND step_key <> 'run_integrity_check'
    AND step_order < _ric_step_order
    AND status NOT IN ('done', 'skipped');
  IF _upstream_pending > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'upstream_steps_pending',
      'count', _upstream_pending,
      'note', 'Nur Steps mit step_order < run_integrity_check.step_order werden geprüft'
    );
  END IF;

  -- 4) Neuen Job einreihen
  INSERT INTO public.job_queue (job_type, package_id, status, priority, payload, meta)
  VALUES (
    'package_run_integrity_check',
    _package_id,
    'queued',
    100,
    jsonb_build_object('package_id', _package_id),
    jsonb_build_object('safe_requeue_reason', _reason, 'safe_requeue_at', now())
  )
  RETURNING id INTO _new_job_id;

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids)
  VALUES (
    'safe_requeue_integrity_check',
    jsonb_build_object('package_id', _package_id, 'new_job_id', _new_job_id, 'reason', _reason),
    'job_queue',
    ARRAY[_new_job_id::text]
  );

  RETURN jsonb_build_object('ok', true, 'job_id', _new_job_id);
END;
$$;

-- ─── Erweiterter Retry-Guard: bezieht meta.retry_count + letzte N attempts ein
-- Heuristik:
--   - meta.retry_count >= 5  → manual_review_required (Hard-Cap je Job)
--   - >= 4 cancelled/failed Jobs desselben (job_type, package_id) in Folge
--     mit identischem last_error-Prefix → manual_review_required
CREATE OR REPLACE FUNCTION public.admin_mark_requeue_loop_terminal(
  _job_id uuid,
  _reason text DEFAULT 'requeue_loop_manual_review'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _job record;
  _retry_count int;
  _recent_count int;
  _identical_error_count int;
  _decision text;
  _detail jsonb;
BEGIN
  SELECT * INTO _job FROM public.job_queue WHERE id = _job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;

  -- meta.retry_count
  _retry_count := COALESCE((_job.meta->>'retry_count')::int, 0);

  -- letzte 5 Jobs gleicher Art für gleiches Paket
  SELECT count(*) INTO _recent_count
  FROM (
    SELECT id, status, last_error
    FROM public.job_queue
    WHERE job_type = _job.job_type
      AND package_id = _job.package_id
      AND id <> _job_id
    ORDER BY created_at DESC
    LIMIT 5
  ) t
  WHERE status IN ('cancelled', 'failed');

  -- davon mit identischem error-prefix (erste 80 Zeichen)
  SELECT count(*) INTO _identical_error_count
  FROM (
    SELECT left(COALESCE(last_error, ''), 80) AS e
    FROM public.job_queue
    WHERE job_type = _job.job_type
      AND package_id = _job.package_id
      AND id <> _job_id
      AND status IN ('cancelled', 'failed')
    ORDER BY created_at DESC
    LIMIT 5
  ) t
  WHERE e = left(COALESCE(_job.last_error, ''), 80) AND e <> '';

  -- Entscheidung
  IF _retry_count >= 5
     OR _recent_count >= 4
     OR _identical_error_count >= 3 THEN
    _decision := 'manual_review_required';
  ELSE
    _decision := 'mark_terminal_only';
  END IF;

  _detail := jsonb_build_object(
    'retry_count', _retry_count,
    'recent_failed_count', _recent_count,
    'identical_error_count', _identical_error_count,
    'decision', _decision,
    'reason', _reason
  );

  UPDATE public.job_queue
  SET status = 'cancelled',
      locked_by = NULL,
      locked_at = NULL,
      completed_at = now(),
      last_error = format('REQUEUE_LOOP_KILLED → %s: %s', _decision, _reason),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'requeue_loop_terminal', true,
        'requeue_loop_decision', _decision,
        'requeue_loop_detail', _detail,
        'requeue_loop_at', now()
      )
  WHERE id = _job_id;

  -- Bei manual_review_required: zugehörigen Step parken
  IF _decision = 'manual_review_required'
     AND _job.package_id IS NOT NULL
     AND _job.job_type LIKE 'package_%' THEN
    UPDATE public.package_steps
    SET status = 'manual_review_required',
        last_error = format('Auto-park nach REQUEUE-Loop: %s', _reason),
        updated_at = now()
    WHERE package_id = _job.package_id
      AND step_key = REPLACE(_job.job_type, 'package_', '')
      AND status NOT IN ('done', 'skipped');
  END IF;

  INSERT INTO public.admin_actions (action, payload, scope, affected_ids)
  VALUES (
    'mark_requeue_loop_terminal',
    jsonb_build_object('job_id', _job_id, 'detail', _detail),
    'job_queue',
    ARRAY[_job_id::text]
  );

  RETURN jsonb_build_object('ok', true, 'decision', _decision, 'detail', _detail);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_heal_zombie_locked_job(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_safe_requeue_integrity_check(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_requeue_loop_terminal(uuid, text) TO authenticated;